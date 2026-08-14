/**
 * GET /instant — the live surface. Reads the chain and Jupiter on every call.
 *
 * Deliberately `buildSnapshot` and not `refreshSnapshot`: the lock in the latter
 * answers a contended caller with the STORED snapshot, which would quietly turn a
 * documented live read into a cache hit. Every /instant call does the work.
 *
 * Use it for a one-off display and for sizing a `mint_data_credits_v0`
 * transaction: the `oracle` block is decoded from the exact account the DC mint
 * program is pinned to. Note that "instant" means "read right now", not
 * "posted right now" — the oracle crank runs roughly every 5 minutes, so
 * `oracle` can only ever be as fresh as its last crank. `spot` carries the
 * fresh market price.
 *
 * The read also write-through-freshens the KV snapshot, so an /instant caller
 * warms /current for everyone else.
 */
import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { buildSnapshot, PriceUnavailableError } from "../services/price.js";

// Constant public body — upstream messages can carry RPC endpoint detail, and
// this is a keyless public API. Detail stays in the log. See README.md.
const PUBLIC_ERROR = "HNT price temporarily unavailable";

export async function handleInstant(request, env) {
  const limited = await checkIpRateLimit(env, request, {
    prefix: "rl:hntprice-instant",
    maxRequests: 15,
    windowSeconds: 60,
  });
  if (limited) return limited;

  try {
    return jsonResponse(await buildSnapshot(env));
  } catch (err) {
    // Both upstreams down is a 502 (they're broken); anything else is ours.
    const status = err instanceof PriceUnavailableError ? 502 : 500;
    console.error("hnt-price /instant failed", err?.message);
    return jsonResponse({ error: PUBLIC_ERROR }, status);
  }
}
