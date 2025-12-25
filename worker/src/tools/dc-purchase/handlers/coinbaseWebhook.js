import { updateOrderStatus, triggerProcess } from "../services/orders.js";
import { recordEvent } from "../services/events.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function verifySignature(request, env) {
  const secret = env.COINBASE_ONRAMP_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = request.headers.get("Coinbase-Signature") || request.headers.get("X-Coinbase-Signature");
  return sig === secret;
}

export async function handleCoinbaseWebhook(request, env, ctx) {
  if (!verifySignature(request, env)) {
    return json({ error: "invalid signature" }, 401);
  }

  const payload = await request.json();
  const partnerRef = payload?.data?.partner_user_ref || payload?.partnerUserRef || payload?.partner_user_ref;
  const status = payload?.data?.status || payload?.status;
  const txId = payload?.data?.transaction_id || payload?.transaction_id;
  const usdcAmount = payload?.data?.crypto?.amount || payload?.crypto_amount;

  if (!partnerRef) {
    return json({ error: "missing ref" }, 400);
  }

  const order = await env.DB.prepare(
    `SELECT id FROM dc_purchase_orders WHERE coinbase_partner_user_ref = ? LIMIT 1`
  )
    .bind(partnerRef)
    .first();
  if (!order) {
    console.warn(`Coinbase webhook received for unknown partnerRef: ${partnerRef}`);
    return json({ error: "order not found" }, 404);
  }

  await recordEvent(env, order.id, "COINBASE_EVENT", payload);

  if (typeof status === "string" && status.toLowerCase() === "completed") {
    // Validate usdcAmount is a valid number before storing
    let validatedUsdcAmount = null;
    if (usdcAmount != null) {
      const parsed = Number(usdcAmount);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        validatedUsdcAmount = String(parsed);
      } else {
        console.warn(`Invalid usdcAmount received: ${usdcAmount}`);
      }
    }
    await updateOrderStatus(env, order.id, "payment_confirmed", {
      coinbase_transaction_id: txId || null,
      usdc_amount_received: validatedUsdcAmount,
    });
    await triggerProcess(env, ctx, order.id);
  }

  return json({ ok: true });
}
