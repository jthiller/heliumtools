import { updateOrderStatus, triggerProcess } from "../services/orders.js";
import { recordEvent } from "../services/events.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

/**
 * Parse the X-Hook0-Signature header.
 * Format: t=<timestamp>,h=<headers>,v1=<signature>
 */
function parseSignatureHeader(header) {
  if (!header) return null;

  const parts = {};
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key && value) {
      parts[key] = value;
    }
  }
  return parts;
}

/**
 * Verify Coinbase webhook signature using HMAC-SHA256.
 * See: https://docs.cdp.coinbase.com/onramp/docs/webhooks/
 * 
 * @param {Request} request - The incoming request
 * @param {string} rawBody - Raw request body string
 * @param {object} env - Environment bindings
 * @returns {Promise<boolean>} True if signature is valid
 */
async function verifySignature(request, rawBody, env) {
  const secret = env.COINBASE_ONRAMP_WEBHOOK_SECRET;

  // If no secret configured, reject all webhooks in production
  // In development, you might set COINBASE_ONRAMP_WEBHOOK_SECRET="" to skip
  if (!secret) {
    console.warn("COINBASE_ONRAMP_WEBHOOK_SECRET not configured - rejecting webhook");
    return false;
  }

  // Get signature header (Coinbase Onramp uses X-Hook0-Signature)
  const signatureHeader = request.headers.get("X-Hook0-Signature") ||
    request.headers.get("Coinbase-Signature") ||
    request.headers.get("X-Coinbase-Signature");

  if (!signatureHeader) {
    console.warn("No signature header found in webhook request");
    return false;
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed || !parsed.t || !parsed.v1) {
    console.warn("Invalid signature header format:", signatureHeader);
    return false;
  }

  const timestamp = parsed.t;
  const providedSignature = parsed.v1;

  // Check timestamp is within 5 minutes to prevent replay attacks
  const timestampMs = parseInt(timestamp, 10) * 1000;
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  if (Math.abs(now - timestampMs) > fiveMinutes) {
    console.warn(`Webhook timestamp too old: ${timestamp} (now: ${Math.floor(now / 1000)})`);
    return false;
  }

  // Construct signed payload: timestamp.body
  const signedPayload = `${timestamp}.${rawBody}`;

  // Compute HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedPayload)
  );

  // Convert to hex string
  const computedSignature = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Timing-safe comparison
  if (computedSignature.length !== providedSignature.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < computedSignature.length; i++) {
    mismatch |= computedSignature.charCodeAt(i) ^ providedSignature.charCodeAt(i);
  }

  if (mismatch !== 0) {
    console.warn("Webhook signature mismatch");
    return false;
  }

  return true;
}

export async function handleCoinbaseWebhook(request, env, ctx) {
  // Read raw body for signature verification
  const rawBody = await request.text();

  // Verify HMAC signature
  if (!await verifySignature(request, rawBody, env)) {
    return json({ error: "invalid signature" }, 401);
  }

  // Parse the JSON payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return json({ error: "invalid JSON" }, 400);
  }

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
