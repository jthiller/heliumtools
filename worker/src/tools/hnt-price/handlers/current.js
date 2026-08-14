/**
 * GET /current — the cheap surface. Served from the cached KV snapshot.
 *
 * Stale-while-revalidate: a stale snapshot is still returned immediately and the
 * refresh happens behind the response, so no caller ever pays for the chain read
 * except the very first one after a cold start. The policy itself lives in
 * `services/price.js` (`getSnapshotSwr`) because dc-mint's `/price` is the same
 * read of the same key and the two must not drift apart.
 */
import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { getSnapshotSwr } from "../services/price.js";

// What we tell the public. Upstream failure messages can name RPC hosts and
// client internals, and this is a keyless public API, so the detail goes to the
// log and the caller gets a constant. Documented verbatim in README.md.
const PUBLIC_ERROR = "HNT price temporarily unavailable";

export async function handleCurrent(request, env, ctx) {
  const limited = await checkIpRateLimit(env, request, {
    prefix: "rl:hntprice",
    maxRequests: 60,
    windowSeconds: 60,
  });
  if (limited) return limited;

  try {
    return jsonResponse(await getSnapshotSwr(env, ctx));
  } catch (err) {
    // Only reachable on a cold cache whose inline build also failed.
    console.error("hnt-price /current failed", err?.message);
    return jsonResponse({ error: PUBLIC_ERROR }, 500);
  }
}
