import { jsonResponse } from "../../../lib/response.js";
import { kvGetJson } from "../../../lib/kv.js";
import { MAX_BODY_BYTES, MAX_FUTURE_SKEW_MS, NOMINATIONS_CACHE_KEY, META_KEY } from "../config.js";
import { validatePayload } from "../services/validate.js";
import { getStoredIds, upsertMessages, softRemoveStale } from "../services/store.js";

/**
 * POST /council/ingest — admin-gated snapshot push from the local Discord scraper.
 * No IP rate limit: the bearer token is the gate. Full flow: auth → size guard →
 * JSON parse → whole-payload validation → replay guard → upsert → (complete)
 * soft-remove → invalidate cache + stamp meta → counts response.
 */
export async function handleIngest(request, env) {
  // Admin-token gate (same contract as the OUI-notifier admin route). Prefer the
  // council-specific COUNCIL_INGEST_TOKEN; fall back to the shared ADMIN_TOKEN so
  // local dev and any legacy config keep working. Both unset → endpoint disabled
  // (503); a mismatch on the resolved token → unauthorized (401).
  const token = env.COUNCIL_INGEST_TOKEN || env.ADMIN_TOKEN;
  if (!token) {
    return new Response("Service unavailable", { status: 503 });
  }
  if (request.headers.get("Authorization") !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // A missing D1 binding is a deploy/dev misconfig, not a client error. Fail loudly
  // rather than no-op the writes and report a false success (honest-labels rule).
  if (!env.DB) {
    return jsonResponse({ error: "Database unavailable" }, 503);
  }

  // Size guard: reject on the declared Content-Length when present, then again on
  // the decoded byte length (an absent or lying header can't smuggle a huge body).
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Payload too large" }, 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Payload too large" }, 413);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const validated = validatePayload(payload);
  if (validated.error) {
    const body = { error: validated.error };
    if (validated.messageIndex !== undefined) body.messageIndex = validated.messageIndex;
    return jsonResponse(body, 400);
  }
  const { channelId, guildId, scrapedAt, complete, messages } = validated.value;

  // Reject a far-future scrapedAt (a seconds-vs-ms or microsecond scraper bug):
  // stamping meta with it would 409 every later legitimate push forever.
  if (scrapedAt > Date.now() + MAX_FUTURE_SKEW_MS) {
    return jsonResponse({ error: "scrapedAt is too far in the future" }, 400);
  }

  // Replay guard: an out-of-order (older) snapshot must not overwrite a newer one.
  // Equal scrapedAt is allowed so an idempotent re-push refreshes in place.
  const meta = await kvGetJson(env, META_KEY);
  if (meta && Number.isFinite(meta.scrapedAt) && scrapedAt < meta.scrapedAt) {
    return jsonResponse({ error: "Stale snapshot", storedScrapedAt: meta.scrapedAt }, 409);
  }

  // inserted vs updated is decided against the ids already stored for the channel.
  const storedIds = await getStoredIds(env, channelId);
  let inserted = 0;
  for (const m of messages) {
    if (!storedIds.has(m.id)) inserted++;
  }
  const updated = messages.length - inserted;

  await upsertMessages(env, channelId, guildId, scrapedAt, messages);

  // Only a complete-channel scrape may soft-remove rows this snapshot didn't carry
  // (deleted in Discord). A partial/degraded scrape (complete:false) must not.
  let removed = 0;
  if (complete) {
    removed = await softRemoveStale(env, channelId, scrapedAt);
  }

  // Invalidate the public read cache and stamp the replay-guard meta (no TTL).
  // Best-effort: a KV hiccup here must not fail an ingest whose D1 write succeeded.
  try {
    if (env.KV) {
      await env.KV.delete(NOMINATIONS_CACHE_KEY);
      await env.KV.put(
        META_KEY,
        JSON.stringify({ scrapedAt, channelId, guildId, updatedAt: Date.now() }),
      );
    }
  } catch {
    // best-effort
  }

  return jsonResponse({
    ok: true,
    received: messages.length,
    inserted,
    updated,
    removed,
    scrapedAt,
  });
}
