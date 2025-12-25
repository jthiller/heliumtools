import { getOrder } from "../services/orders.js";

export async function handleGetOrder(orderId, env) {
  const order = await getOrder(env, orderId);
  if (!order) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const mintSigs = order.mint_tx_sigs ? JSON.parse(order.mint_tx_sigs) : [];

  return new Response(
    JSON.stringify({
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
      error: order.error_code ? { code: order.error_code, message: order.error_message } : null,
      updatedAt: order.updated_at,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }
  );
}
