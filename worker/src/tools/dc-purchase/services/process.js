import { updateOrderStatus, getOrder } from "./orders.js";
import { recordEvent } from "./events.js";

// Note: setTimeout IS supported in Cloudflare Workers runtime
const PROCESSING_DELAY_MS = 50;

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enqueueProcess(env, orderId) {
  // In lieu of a queue, immediately process with waitUntil outside caller
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

export async function processOrder(env, orderId) {
  // Use iteration instead of recursion to avoid stack overflow
  let iterations = 0;
  const MAX_ITERATIONS = 10; // Safety limit

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
        // Terminal state (complete) or unknown status
        if (currentStatus !== "complete" && currentStatus !== "created" && currentStatus !== "onramp_started") {
          console.warn(`processOrder: unexpected status '${currentStatus}' for orderId=${orderId}`);
        }
        return;
      }

      // Build update payload based on transition
      const updatePayload = {};
      if (currentStatus === "payment_confirmed") {
        updatePayload.usdc_amount_received = order.usdc_amount_received || order.usd_requested;
        await recordEvent(env, orderId, "ONCHAIN_EVENT", { stage: "usdc_verified" });
      } else if (currentStatus === "usdc_verified") {
        updatePayload.hnt_amount_received = order.hnt_amount_received || null;
        await recordEvent(env, orderId, "ONCHAIN_EVENT", { stage: "swapping" });
      } else if (currentStatus === "swapping") {
        updatePayload.swap_tx_sig = order.swap_tx_sig || null;
      } else if (currentStatus === "minting_dc") {
        updatePayload.mint_tx_sigs = order.mint_tx_sigs || JSON.stringify([]);
      } else if (currentStatus === "delegating") {
        updatePayload.dc_delegated = order.dc_delegated || "0";
        updatePayload.delegate_tx_sig = order.delegate_tx_sig || null;
        await recordEvent(env, orderId, "STATUS_CHANGE", { status: "complete" });
      }

      await updateOrderStatus(env, orderId, nextStatus, updatePayload);

      // If we reached complete, we're done
      if (nextStatus === "complete") {
        return;
      }

      // Small delay between transitions
      await delay(PROCESSING_DELAY_MS);
    } catch (err) {
      await updateOrderStatus(env, orderId, order.status, {
        error_code: "processing_error",
        error_message: err?.message || String(err),
      });
      await recordEvent(env, orderId, "ERROR", { message: err?.message || String(err) });
      return;
    }
  }

  console.warn(`processOrder: max iterations reached for orderId=${orderId}`);
}
