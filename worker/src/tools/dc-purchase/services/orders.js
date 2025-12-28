// Cloudflare Workers provides crypto.randomUUID() natively
import { getOuiByNumber } from "../../oui-notifier/services/ouis.js";
import { enqueueProcess } from "./process.js";
import { recordEvent } from "./events.js";

function nowIso() {
  return new Date().toISOString();
}

export async function resolveOui(env, ouiNumber) {
  const record = await getOuiByNumber(env, ouiNumber);
  if (!record) return null;
  return {
    oui: record.oui,
    payer: record.payer,
    escrow: record.escrow,
  };
}

export async function createOrder(env, { oui, payer, escrow, usd, email, partnerRef }) {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const status = "created";
  await env.DB.prepare(
    `INSERT INTO dc_purchase_orders (id, created_at, updated_at, oui, payer, escrow, usd_requested, email, status, coinbase_partner_user_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, createdAt, createdAt, oui, payer, escrow, usd, email || null, status, partnerRef)
    .run();
  await recordEvent(env, id, "STATUS_CHANGE", { status });
  return id;
}

// Whitelist of valid columns for dynamic UPDATE to prevent SQL injection
const ALLOWED_EXTRA_COLUMNS = new Set([
  "coinbase_transaction_id",
  "usdc_amount_received",
  "usdc_signature",
  "hnt_amount_received",
  "jupiter_quote_json",
  "swap_tx_sig",
  "mint_tx_sigs",
  "delegate_tx_sig",
  "dc_delegated",
  "error_code",
  "error_message",
]);

export async function updateOrderStatus(env, id, status, extra = {}) {
  const updatedAt = nowIso();
  const setParts = ["status = ?", "updated_at = ?"];
  const values = [status, updatedAt];

  Object.entries(extra).forEach(([key, val]) => {
    if (!ALLOWED_EXTRA_COLUMNS.has(key)) {
      console.warn(`updateOrderStatus: ignoring unknown column '${key}'`);
      return;
    }
    setParts.push(`${key} = ?`);
    values.push(val);
  });

  values.push(id);

  await env.DB.prepare(
    `UPDATE dc_purchase_orders SET ${setParts.join(", ")} WHERE id = ?`
  ).bind(...values).run();
  await recordEvent(env, id, "STATUS_CHANGE", { status, extra });
}

export async function getOrder(env, id) {
  return env.DB.prepare(
    `SELECT id, created_at, updated_at, oui, payer, escrow, usd_requested, email, status,
            coinbase_partner_user_ref, coinbase_transaction_id, usdc_amount_received, usdc_signature,
            hnt_amount_received, jupiter_quote_json, swap_tx_sig, mint_tx_sigs, delegate_tx_sig, dc_delegated,
            error_code, error_message
     FROM dc_purchase_orders WHERE id = ?`
  )
    .bind(id)
    .first();
}

export async function listPendingOrders(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, status FROM dc_purchase_orders WHERE status IN ('onramp_started', 'payment_confirmed', 'usdc_verified', 'swapping', 'minting_dc', 'delegating')`
  ).all();
  return results || [];
}

export async function triggerProcess(env, ctx, orderId) {
  if (ctx?.waitUntil) {
    ctx.waitUntil(enqueueProcess(env, orderId));
  } else {
    await enqueueProcess(env, orderId);
  }
}
