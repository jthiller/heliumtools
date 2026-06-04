import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { RATE_LIMIT, CACHE_TTL, REWARDS_BATCH_SIZE } from "../config.js";
import { isValidWalletAddress, kvGetJson, kvPutJson } from "../utils.js";
import { getBulkPendingRewards } from "../../hotspot-claimer/services/oracle.js";

/**
 * Stable per-batch cache key: hash of owner + the sorted entity keys, so the
 * same set of Hotspots maps to the same key regardless of request ordering.
 */
async function batchCacheKey(owner, entityKeys) {
  const payload = `${owner}:${[...entityKeys].sort().join(",")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `wd:rw:${hex.slice(0, 40)}`;
}

/**
 * POST /rewards { owner, hotspots: [{ entityKey, assetId }] }
 *
 * The dashboard's own batched + cached pending/lifetime rewards. Reuses the
 * claimer's bulk oracle logic but, unlike the shared claimer endpoint, caches
 * results (rewards distribute ~daily) and is hit far less often thanks to a
 * larger batch size. Cache hits don't consume the rate limit, so reloads are free.
 * Returns { results: { [entityKey]: { rewards, error } }, cached }.
 */
export async function handleRewards(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const owner = body?.owner;
  if (!isValidWalletAddress(owner)) {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  const hotspots = (Array.isArray(body?.hotspots) ? body.hotspots : [])
    .filter((h) => h && h.entityKey && h.assetId)
    .map((h) => ({ entityKey: h.entityKey, assetId: h.assetId }));

  if (hotspots.length === 0) return jsonResponse({ results: {}, cached: false });
  if (hotspots.length > REWARDS_BATCH_SIZE) {
    return jsonResponse({ error: `Too many Hotspots (max ${REWARDS_BATCH_SIZE})` }, 400);
  }

  // Cache-first: a warm batch returns instantly without spending a rate-limit token.
  const cacheKey = await batchCacheKey(owner, hotspots.map((h) => h.entityKey));
  const cached = await kvGetJson(env, cacheKey);
  if (cached) return jsonResponse({ results: cached, cached: true });

  const limited = await checkIpRateLimit(env, request, RATE_LIMIT);
  if (limited) return limited;

  let results;
  try {
    results = await getBulkPendingRewards(env, hotspots, owner);
  } catch (err) {
    return jsonResponse({ error: `Failed to load rewards: ${err.message}` }, 502);
  }

  await kvPutJson(env, cacheKey, results, CACHE_TTL.rewards);
  return jsonResponse({ results, cached: false });
}
