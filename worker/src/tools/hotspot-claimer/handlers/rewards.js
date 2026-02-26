import { jsonResponse } from "../../../lib/response.js";
import { resolveEntityKey } from "../services/entity.js";
import { getPendingRewards } from "../services/oracle.js";
import { checkIpRateLimit } from "../services/rateLimit.js";
import { MAX_LOOKUPS_PER_MINUTE, MAX_CLAIMS_PER_HOTSPOT_HOURS, MAX_RECIPIENT_INITS_PER_DAY } from "../config.js";
import { isValidEntityKey, todayUTC } from "../utils.js";

/**
 * GET /rewards?entityKey=<base58-encoded-entity-key>
 *
 * Returns pending rewards for IOT, MOBILE, and HNT,
 * along with hotspot metadata.
 */
export async function handleRewards(url, env, request) {
  // Rate limit check
  const rateLimitError = await checkIpRateLimit(env, request, {
    prefix: "rl:rewards",
    maxRequests: MAX_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (rateLimitError) return rateLimitError;

  const entityKey = url.searchParams.get("entityKey");

  if (!isValidEntityKey(entityKey)) {
    return jsonResponse(
      { error: "Invalid entity key. Must be a base58-encoded hotspot key." },
      400
    );
  }

  try {
    // Resolve entity key to hotspot metadata
    const hotspot = await resolveEntityKey(env, entityKey);
    if (!hotspot) {
      return jsonResponse(
        { error: "Hotspot not found for the given entity key." },
        404
      );
    }

    // Fetch pending rewards across all token types
    const rewards = await getPendingRewards(env, hotspot.assetId, hotspot.owner);

    // Check if recipient inits are available today
    const initKey = `claims:inits:${todayUTC()}`;
    const initsToday = parseInt((await env.KV.get(initKey)) || "0", 10);
    const initsAvailable = initsToday < MAX_RECIPIENT_INITS_PER_DAY;

    // Check for recent claim within cooldown
    const hotspotKey = `claim:hotspot:${entityKey}`;
    const lastClaimRaw = await env.KV.get(hotspotKey);
    let lastClaim = null;
    if (lastClaimRaw) {
      try {
        const parsed = JSON.parse(lastClaimRaw);
        lastClaim = {
          ...parsed,
          cooldownHours: MAX_CLAIMS_PER_HOTSPOT_HOURS,
        };
      } catch {
        // Legacy format (plain timestamp or date string) — normalize to ISO
        let claimedAt = lastClaimRaw;
        if (/^\d+$/.test(lastClaimRaw)) {
          const numeric = Number(lastClaimRaw);
          const ms = lastClaimRaw.length <= 10 ? numeric * 1000 : numeric;
          const date = new Date(ms);
          if (!Number.isNaN(date.getTime())) claimedAt = date.toISOString();
        }
        lastClaim = { claimedAt, claims: [], cooldownHours: MAX_CLAIMS_PER_HOTSPOT_HOURS };
      }
    }

    return jsonResponse({
      ...hotspot,
      rewards,
      initsAvailable,
      ...(lastClaim && { lastClaim }),
    });
  } catch (err) {
    console.error("Rewards error:", err.message, err.stack);
    return jsonResponse({ error: "Failed to fetch rewards." }, 500);
  }
}
