import { kvGetJson, kvPutJson } from "./kv.js";
import { jsonResponse } from "./response.js";

/**
 * Get client IP from request headers.
 * CF-Connecting-IP in production, fallback for local dev.
 */
function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "127.0.0.1"
  );
}

/**
 * Read the stored window record for a key.
 *
 * Returns `{ n, ts }` or null when there is nothing usable. Legacy values are a
 * plain counter string (the pre-window format) — those parse to a non-object and
 * are treated as "no window", so a deploy over warm keys starts everyone fresh
 * instead of throwing. KV read failures fail open the same way (`kvGetJson`
 * already answers null on them).
 */
async function readWindow(env, key) {
  const raw = await kvGetJson(env, key);
  if (!raw || typeof raw !== "object") return null;
  const n = Number(raw.n);
  const ts = Number(raw.ts);
  if (!Number.isFinite(n) || !Number.isFinite(ts)) return null;
  return { n, ts };
}

/**
 * Check IP-based rate limit using KV.
 * Returns null if under limit, or a 429 Response if over limit.
 *
 * The counter is a *window-anchored* record — `{ n, ts }` where `ts` is the
 * epoch-second start of the current window. Anchoring matters: if the TTL alone
 * defined the window, every request would refresh it, so a client polling faster
 * than `windowSeconds` (e.g. the 15-30s cadence the HNT price API recommends)
 * would keep the key alive forever and creep to the cap, 429ing a compliant
 * caller. With an anchor the window ends `windowSeconds` after its first
 * request no matter how often the key is written.
 *
 * Non-atomic by design (unchanged from the previous implementation): concurrent
 * requests read-modify-write the same key and can undercount. Accepted — this is
 * abuse damping, not a quota, and KV has no atomic increment.
 */
export async function checkIpRateLimit(
  env,
  request,
  { prefix, maxRequests, windowSeconds }
) {
  const ip = getClientIp(request);
  const key = `${prefix}:${ip}`;
  const now = Math.floor(Date.now() / 1000);

  const stored = await readWindow(env, key);
  const expired = !stored || now - stored.ts >= windowSeconds;
  const next = expired ? { n: 1, ts: now } : { n: stored.n + 1, ts: stored.ts };

  if (!expired && stored.n >= maxRequests) {
    // Report the time left in *this* window rather than the full window length —
    // more useful to the caller and still an honest upper bound.
    const remaining = Math.max(1, stored.ts + windowSeconds - now);
    return jsonResponse(
      {
        error: "Too many requests. Please try again later.",
        rateLimited: true,
        retryAfterSeconds: remaining,
      },
      429
    );
  }

  // `kvPutJson` swallows write failures, which is the posture we want: a
  // rate-limit accounting failure (KV's 1-write/sec/key ceiling, a transient
  // error) must never turn a good request into a 500.
  //
  // Cloudflare KV enforces a 60-second minimum expirationTtl, so short windows
  // have to floor at 60. Doubling the window gives the anchor room to expire the
  // window on its own terms (the record is what closes a window now; the TTL is
  // only garbage collection for idle IPs).
  await kvPutJson(env, key, next, Math.max(60, windowSeconds * 2));

  return null;
}
