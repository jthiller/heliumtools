/**
 * Order processing pipeline.
 * Handles the state machine transitions:
 *   payment_confirmed → usdc_verified → swapping → minting_dc → delegating → complete
 */

import { updateOrderStatus, getOrder } from "./orders.js";
import { recordEvent } from "./events.js";
import { executeSwapWithRetry } from "./jupiter.js";
import { mintDataCredits, delegateDataCredits } from "./dataCredits.js";
import {
  getConnection,
  getTreasuryKeypair,
  getTokenBalance,
  getAssociatedTokenAddress
} from "./solana.js";
import { USDC_MINT, HNT_DECIMALS } from "../lib/constants.js";
import { PublicKey } from "@solana/web3.js";

const PROCESSING_DELAY_MS = 1000; // 1 second between state transitions

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enqueueProcess(env, orderId) {
  await processOrder(env, orderId);
}

// Status flow for order processing
const STATUS_TRANSITIONS = {
  payment_confirmed: "usdc_verified",
  usdc_verified: "swapping",
  swapping: "minting_dc",
  minting_dc: "delegating",
  delegating: "complete",
};

/**
 * Process an order through its state machine.
 * Each step performs actual on-chain operations and validates before proceeding.
 */
export async function processOrder(env, orderId) {
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const order = await getOrder(env, orderId);
    if (!order) {
      console.warn(`processOrder: order not found for orderId=${orderId}`);
      return;
    }

    try {
      const currentStatus = order.status;
      const nextStatus = STATUS_TRANSITIONS[currentStatus];

      if (!nextStatus) {
        if (currentStatus !== "complete" && currentStatus !== "created" && currentStatus !== "onramp_started") {
          console.warn(`processOrder: unexpected status '${currentStatus}' for orderId=${orderId}`);
        }
        return;
      }

      console.log(`Processing order ${orderId}: ${currentStatus} → ${nextStatus}`);
      const updatePayload = {};

      // ─────────────────────────────────────────────────────────────────
      // payment_confirmed → usdc_verified: Verify USDC deposit on-chain
      // ─────────────────────────────────────────────────────────────────
      if (currentStatus === "payment_confirmed") {
        // Coinbase webhook already confirmed payment
        // Optionally verify USDC balance in treasury
        const connection = getConnection(env);
        const keypair = getTreasuryKeypair(env);
        const usdcMint = new PublicKey(USDC_MINT);
        const usdcAta = await getAssociatedTokenAddress(keypair.publicKey, usdcMint);
        const usdcBalance = await getTokenBalance(connection, usdcAta);

        updatePayload.usdc_amount_received = order.usdc_amount_received || order.usd_requested;
        await recordEvent(env, orderId, "ONCHAIN_EVENT", {
          stage: "usdc_verified",
          treasuryUsdcBalance: usdcBalance.toString()
        });
      }

      // ─────────────────────────────────────────────────────────────────
      // usdc_verified → swapping: Execute Jupiter swap USDC → HNT
      // ─────────────────────────────────────────────────────────────────
      else if (currentStatus === "usdc_verified") {
        const usdcAmount = parseFloat(order.usdc_amount_received || order.usd_requested);

        if (!usdcAmount || usdcAmount <= 0) {
          throw new Error("Invalid USDC amount for swap");
        }

        await recordEvent(env, orderId, "ONCHAIN_EVENT", { stage: "swap_started", usdcAmount });

        const swapResult = await executeSwapWithRetry(env, usdcAmount, { maxRetries: 3 });

        updatePayload.swap_tx_sig = swapResult.signature;
        updatePayload.jupiter_quote_json = swapResult.quote;
        updatePayload.hnt_amount_received = swapResult.hntReceived.toString();

        await recordEvent(env, orderId, "ONCHAIN_EVENT", {
          stage: "swap_completed",
          signature: swapResult.signature,
          hntReceived: swapResult.hntReceived.toString()
        });
      }

      // ─────────────────────────────────────────────────────────────────
      // swapping → minting_dc: Mint DC by burning HNT
      // ─────────────────────────────────────────────────────────────────
      else if (currentStatus === "swapping") {
        const hntAmount = BigInt(order.hnt_amount_received || "0");

        if (hntAmount <= 0n) {
          throw new Error("No HNT available for minting DC");
        }

        await recordEvent(env, orderId, "ONCHAIN_EVENT", { stage: "mint_started", hntAmount: hntAmount.toString() });

        const mintResult = await mintDataCredits(env, hntAmount);

        updatePayload.mint_tx_sigs = JSON.stringify([mintResult.signature]);
        updatePayload.dc_delegated = mintResult.dcMinted.toString();

        await recordEvent(env, orderId, "ONCHAIN_EVENT", {
          stage: "mint_completed",
          signature: mintResult.signature,
          dcMinted: mintResult.dcMinted.toString()
        });
      }

      // ─────────────────────────────────────────────────────────────────
      // minting_dc → delegating: Delegate DC to OUI escrow
      // ─────────────────────────────────────────────────────────────────
      else if (currentStatus === "minting_dc") {
        // Use the stored DC amount from minting, or fall back to stored value
        const dcAmount = BigInt(order.dc_delegated || "0");
        const routerKey = order.payer; // OUI's payer key is used as router_key

        if (dcAmount <= 0n) {
          throw new Error("No DC available for delegation");
        }

        await recordEvent(env, orderId, "ONCHAIN_EVENT", {
          stage: "delegate_started",
          dcAmount: dcAmount.toString(),
          routerKey
        });

        const delegateResult = await delegateDataCredits(env, dcAmount, routerKey);

        updatePayload.delegate_tx_sig = delegateResult.signature;

        await recordEvent(env, orderId, "ONCHAIN_EVENT", {
          stage: "delegate_completed",
          signature: delegateResult.signature,
          escrowBalance: delegateResult.escrowBalance.toString()
        });
      }

      // ─────────────────────────────────────────────────────────────────
      // delegating → complete: Final state
      // ─────────────────────────────────────────────────────────────────
      else if (currentStatus === "delegating") {
        await recordEvent(env, orderId, "STATUS_CHANGE", { status: "complete" });
      }

      // Update order to next status
      await updateOrderStatus(env, orderId, nextStatus, updatePayload);

      if (nextStatus === "complete") {
        console.log(`Order ${orderId} completed successfully`);
        return;
      }

      await delay(PROCESSING_DELAY_MS);
    } catch (err) {
      console.error(`processOrder error for ${orderId}:`, err);

      await updateOrderStatus(env, orderId, order.status, {
        error_code: "processing_error",
        error_message: err?.message || String(err),
      });
      await recordEvent(env, orderId, "ERROR", {
        stage: order.status,
        message: err?.message || String(err),
        stack: err?.stack
      });
      return;
    }
  }

  console.warn(`processOrder: max iterations reached for orderId=${orderId}`);
}

/**
 * Resume processing for a specific order.
 * Can be called to retry after a failed step.
 */
export async function resumeOrder(env, orderId) {
  const order = await getOrder(env, orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  // Clear error state before resuming
  await updateOrderStatus(env, orderId, order.status, {
    error_code: null,
    error_message: null,
  });

  return processOrder(env, orderId);
}
