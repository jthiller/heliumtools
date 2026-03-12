import { jsonResponse } from "../../../lib/response.js";
import { getPendingRewards } from "../services/oracle.js";
import { checkIpRateLimit } from "../services/rateLimit.js";
import { MAX_LOOKUPS_PER_MINUTE } from "../config.js";
import { isValidWalletAddress, isValidEntityKey } from "../utils.js";

const MAX_BULK_SIZE = 50;
const CONCURRENCY = 5;

/**
 * POST /wallet/rewards
 * Body: { owner: "<solana-address>", hotspots: [{ entityKey, assetId }, ...] }
 *
 * Fetches pending rewards for multiple Hotspots in a single request.
 * Oracle lookups are done server-side in parallel, bypassing per-request rate limits.
 * IP is still rate-limited (one check per bulk request).
 */
export async function handleBulkRewards(request, env) {
  // Rate limit: count as 1 request per bulk call
  const rateLimitError = await checkIpRateLimit(env, request, {
    prefix: "rl:rewards",
    maxRequests: MAX_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (rateLimitError) return rateLimitError;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Request body must be a JSON object." }, 400);
  }

  const { owner, hotspots } = body;

  if (!isValidWalletAddress(owner)) {
    return jsonResponse({ error: "Invalid owner address." }, 400);
  }

  if (!Array.isArray(hotspots) || hotspots.length === 0) {
    return jsonResponse({ error: "Hotspots must be a non-empty array." }, 400);
  }

  if (hotspots.length > MAX_BULK_SIZE) {
    return jsonResponse(
      { error: `Maximum ${MAX_BULK_SIZE} Hotspots per request.` },
      400
    );
  }

  // Validate each Hotspot has required fields
  for (const h of hotspots) {
    if (!h.assetId || !isValidEntityKey(h.entityKey)) {
      return jsonResponse(
        { error: "Each Hotspot must have a valid entityKey and assetId." },
        400
      );
    }
  }

  // Fetch rewards in parallel with bounded concurrency
  const results = Object.create(null);
  const queue = [...hotspots];

  async function processNext() {
    while (queue.length > 0) {
      const h = queue.shift();
      try {
        const rewards = await getPendingRewards(env, h.assetId, owner);
        results[h.entityKey] = { rewards, error: null };
      } catch (err) {
        results[h.entityKey] = {
          rewards: null,
          error: err.message || "Failed to fetch rewards",
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, hotspots.length) },
    () => processNext()
  );
  await Promise.all(workers);

  return jsonResponse({ results });
}
