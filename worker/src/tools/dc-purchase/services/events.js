// Cloudflare Workers provides crypto.randomUUID() natively

function nowIso() {
  return new Date().toISOString();
}

export async function recordEvent(env, orderId, type, payload = {}) {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO dc_purchase_events (id, order_id, created_at, type, payload)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, orderId, createdAt, type, JSON.stringify(payload || {}))
    .run();
}
