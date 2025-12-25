import { updateOrderStatus, getOrder } from "./orders.js";
import { recordEvent } from "./events.js";

async function simulateDelay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enqueueProcess(env, orderId) {
  // In lieu of a queue, immediately process with waitUntil outside caller
  await processOrder(env, orderId);
}

export async function processOrder(env, orderId) {
  const order = await getOrder(env, orderId);
  if (!order) return;

  try {
    if (order.status === "payment_confirmed") {
      await updateOrderStatus(env, orderId, "usdc_verified", { usdc_amount_received: order.usdc_amount_received || order.usd_requested });
      await recordEvent(env, orderId, "ONCHAIN_EVENT", { stage: "usdc_verified" });
      await simulateDelay(50);
      return processOrder(env, orderId);
    }

    if (order.status === "usdc_verified") {
      await updateOrderStatus(env, orderId, "swapping", { hnt_amount_received: order.hnt_amount_received || null });
      await recordEvent(env, orderId, "ONCHAIN_EVENT", { stage: "swapping" });
      await simulateDelay(50);
      return processOrder(env, orderId);
    }

    if (order.status === "swapping") {
      await updateOrderStatus(env, orderId, "minting_dc", { swap_tx_sig: order.swap_tx_sig || null });
      await simulateDelay(50);
      return processOrder(env, orderId);
    }

    if (order.status === "minting_dc") {
      await updateOrderStatus(env, orderId, "delegating", { mint_tx_sigs: order.mint_tx_sigs || JSON.stringify([]) });
      await simulateDelay(50);
      return processOrder(env, orderId);
    }

    if (order.status === "delegating") {
      const delegated = order.dc_delegated || "0";
      await updateOrderStatus(env, orderId, "complete", { dc_delegated: delegated, delegate_tx_sig: order.delegate_tx_sig || null });
      await recordEvent(env, orderId, "STATUS_CHANGE", { status: "complete" });
    }
  } catch (err) {
    await updateOrderStatus(env, orderId, order.status, {
      error_code: "processing_error",
      error_message: err?.message || String(err),
    });
    await recordEvent(env, orderId, "ERROR", { message: err?.message || String(err) });
  }
}
