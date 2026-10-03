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
 * The fixed source address Cloudflare stamps into CF-Connecting-IP on every
 * cross-zone Worker subrequest, in place of the real client IP. See
 * https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip-in-worker-subrequests
 */
const WORKERS_EGRESS_IP = "2a06:98c0:3600::103";

// Two or more dot-separated DNS labels (1-63 chars, alphanumeric at both ends),
// 253 chars total — every zone name has this shape. Bounds the KV key; anything
// else falls back to the shared egress-IP bucket.
const ZONE_NAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const WORKER_ID_PREFIX = "worker:";

// Must match `simple.period` on the WORKER_CALLER_CEILING binding in
// worker/wrangler.jsonc; the binding doesn't report time left, so a 429 from the
// ceiling reports the whole period.
const WORKER_CEILING_PERIOD_SECONDS = 60;

/**
 * Who a rate-limit window belongs to: the client IP, except for Workers on
 * other Cloudflare zones. Those all arrive with the same egress address above,
 * so keying on IP would put every Worker integrator in one shared bucket (a
 * handful polling /hnt-price/current at the documented cadence would 429 each
 * other). For them, key on `CF-Worker` instead — the zone that owns the calling
 * Worker (`<subdomain>.workers.dev` for workers.dev Workers), which Cloudflare
 * adds to every Worker `fetch()` subrequest.
 *
 * `CF-Worker` is only trusted when CF-Connecting-IP is the egress address, and
 * that header is read directly rather than through `getClientIp`'s local-dev
 * X-Forwarded-For fallback: a direct client can send any `CF-Worker` it likes
 * but cannot set CF-Connecting-IP, so browsers and scripts stay keyed per IP.
 * The `worker:` prefix keeps zone keys out of the IP key space.
 */
function getRateLimitIdentity(request) {
  const connectingIp = request.headers.get("CF-Connecting-IP")?.toLowerCase();
  if (connectingIp === WORKERS_EGRESS_IP) {
    const zone = request.headers.get("CF-Worker")?.trim().toLowerCase();
    if (zone && ZONE_NAME_RE.test(zone)) return `${WORKER_ID_PREFIX}${zone}`;
  }
  return getClientIp(request);
}

/**
 * Backstop for the per-zone keying: every Worker-zone caller under one
 * rate-limit prefix, combined, against one ceiling (the limit lives on the
 * binding in worker/wrangler.jsonc). A prefix is one endpoint for hnt-price, but
 * several handlers share one (`rl:wd`, `rl:rewards`) and so share its ceiling.
 * Cloudflare documents that it adds `CF-Worker`, not that a Worker can't
 * overwrite it; if one can, rotating values would otherwise mint a fresh window
 * per value — unbounded /hnt-price/instant chain reads, for one. Before per-zone
 * keying, the shared egress-IP bucket was this bound. The cost is the same as
 * that bucket's, only at a much higher threshold: whoever exhausts the ceiling
 * 429s every Worker caller of that prefix at that location for up to a minute.
 *
 * A Rate Limiting binding rather than a KV counter: one key written by every
 * Worker request would hit KV's 1-write/sec/key limit and stall near 60/min,
 * so it could never count up to a ceiling above that. The binding counts per
 * Cloudflare location and approximately, which is fine for a backstop.
 *
 * Fails open, like the KV window: no binding (an env that didn't declare it) or
 * a binding error allows the request.
 */
async function underWorkerCeiling(env, prefix) {
  if (!env.WORKER_CALLER_CEILING) return true;
  try {
    const { success } = await env.WORKER_CALLER_CEILING.limit({ key: prefix });
    return success;
  } catch {
    return true;
  }
}

function tooManyRequests(retryAfterSeconds) {
  return jsonResponse(
    {
      error: "Too many requests. Please try again later.",
      rateLimited: true,
      retryAfterSeconds,
    },
    429
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
 * Keyed `${prefix}:<ip>`, or `${prefix}:worker:<zone>` for cross-zone Worker
 * callers — see `getRateLimitIdentity`. Those callers also count against a
 * combined per-prefix ceiling — see `underWorkerCeiling`.
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
  const identity = getRateLimitIdentity(request);
  const key = `${prefix}:${identity}`;
  const now = Math.floor(Date.now() / 1000);

  const stored = await readWindow(env, key);
  const expired = !stored || now - stored.ts >= windowSeconds;
  const next = expired ? { n: 1, ts: now } : { n: stored.n + 1, ts: stored.ts };

  if (!expired && stored.n >= maxRequests) {
    // Report the time left in *this* window rather than the full window length —
    // more useful to the caller and still an honest upper bound.
    return tooManyRequests(Math.max(1, stored.ts + windowSeconds - now));
  }

  // Checked only once the caller's own window has room, so requests its window
  // already refused don't use up the shared ceiling.
  if (identity.startsWith(WORKER_ID_PREFIX) && !(await underWorkerCeiling(env, prefix))) {
    return tooManyRequests(WORKER_CEILING_PERIOD_SECONDS);
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
