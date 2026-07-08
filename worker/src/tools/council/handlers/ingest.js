import { jsonResponse } from "../../../lib/response.js";
import { kvGetJson } from "../../../lib/kv.js";
import { MAX_BODY_BYTES, MAX_FUTURE_SKEW_MS, META_KEY } from "../config.js";
import { validatePayload } from "../services/validate.js";
import { commitSnapshot } from "../services/commit.js";

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
  const { scrapedAt } = validated.value;

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

  const counts = await commitSnapshot(env, validated.value);
  return jsonResponse({ ok: true, ...counts });
}
