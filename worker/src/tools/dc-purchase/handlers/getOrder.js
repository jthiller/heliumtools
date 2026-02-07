import { getOrder } from "../services/orders.js";
import { jsonResponse } from "../../../lib/response.js";

export async function handleGetOrder(orderId, env) {
  const order = await getOrder(env, orderId);
  if (!order) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const mintSigs = order.mint_tx_sigs ? JSON.parse(order.mint_tx_sigs) : [];

  return jsonResponse({
    orderId: order.id,
    status: order.status,
    oui: order.oui,
    payer: order.payer,
    escrow: order.escrow,
    usdRequested: order.usd_requested,
    usdcAmountReceived: order.usdc_amount_received,
    hntAmountReceived: order.hnt_amount_received,
    dcDelegated: order.dc_delegated,
    coinbaseTransactionId: order.coinbase_transaction_id,
    txs: {
      usdcSig: order.usdc_signature,
      swapSig: order.swap_tx_sig,
      mintSigs,
      delegateSig: order.delegate_tx_sig,
    },
    errorCode: order.error_code || null,
    errorMessage: order.error_message || null,
    updatedAt: order.updated_at,
  });
}
