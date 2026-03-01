import { jsonResponse } from "../../../lib/response.js";
import { resolveEntityKey } from "../services/entity.js";
import { getPendingRewards } from "../services/oracle.js";
import { claimRewardsForToken } from "../services/transaction.js";
import { checkIpRateLimit } from "../services/rateLimit.js";
import {
  MAX_CLAIMS_PER_HOTSPOT_HOURS,
  MAX_CLAIMS_PER_DAY_GLOBAL,
  MAX_RECIPIENT_INITS_PER_DAY,
  MAX_CLAIMS_PER_IP_HOUR,
} from "../config.js";
import { isValidEntityKey, todayUTC } from "../utils.js";

/**
 * Check and enforce rate limits. Returns null if OK, or an error response if limited.
 */
async function checkRateLimits(env, entityKey) {
  // Check per-hotspot limit
  const hotspotKey = `claim:hotspot:${entityKey}`;
  const lastClaim = await env.KV.get(hotspotKey);
  if (lastClaim) {
    return jsonResponse(
      {
        error: "This hotspot was already claimed recently. Try again later.",
        rateLimited: true,
        type: "hotspot",
      },
      429
    );
  }

  // Check global daily limit
  const dailyKey = `claims:daily:${todayUTC()}`;
  const dailyCount = parseInt((await env.KV.get(dailyKey)) || "0", 10);
  if (dailyCount >= MAX_CLAIMS_PER_DAY_GLOBAL) {
    return jsonResponse(
      {
        error:
          "Daily claim limit reached. The allotment of claims for today has been used up. Try again tomorrow.",
        rateLimited: true,
        type: "global",
      },
      429
    );
  }

  return null;
}

/**
 * Record a successful claim in rate-limit KV.
 * Stores the claim results so they can be shown when the hotspot is looked up.
 */
async function recordClaim(env, entityKey, claims) {
  const ttl = MAX_CLAIMS_PER_HOTSPOT_HOURS * 3600;
  const hotspotKey = `claim:hotspot:${entityKey}`;
  await env.KV.put(
    hotspotKey,
    JSON.stringify({ claimedAt: new Date().toISOString(), claims }),
    { expirationTtl: ttl }
  );

  // Global daily: increment counter, expires at end of day
  const dailyKey = `claims:daily:${todayUTC()}`;
  const currentCount = parseInt((await env.KV.get(dailyKey)) || "0", 10);
  await env.KV.put(dailyKey, String(currentCount + 1), {
    expirationTtl: 86400,
  });
}

/**
 * POST /claim
 * Body: { entityKey: "<base58>" }
 *
 * Claims pending rewards for a hotspot. Builds, signs, and broadcasts
 * claim transactions funded by the treasury wallet.
 */
export async function handleClaim(request, env) {
  // IP-based rate limit
  const ipRateLimitError = await checkIpRateLimit(env, request, {
    prefix: "rl:claim",
    maxRequests: MAX_CLAIMS_PER_IP_HOUR,
    windowSeconds: 3600,
  });
  if (ipRateLimitError) return ipRateLimitError;

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const { entityKey } = body;
  if (!isValidEntityKey(entityKey)) {
    return jsonResponse(
      { error: "Invalid entity key. Must be a base58-encoded hotspot key." },
      400
    );
  }

  // Check rate limits
  const rateLimitError = await checkRateLimits(env, entityKey);
  if (rateLimitError) return rateLimitError;

  // Verify payer wallet is configured
  if (!env.HOTSPOT_CLAIM_PAYER_WALLET_PRIVATE_KEY) {
    return jsonResponse(
      { error: "Claim service is not configured. Contact the administrator." },
      503
    );
  }

  try {
    // Resolve hotspot
    const hotspot = await resolveEntityKey(env, entityKey);
    if (!hotspot) {
      return jsonResponse(
        { error: "Hotspot not found for the given entity key." },
        404
      );
    }

    // Get pending rewards
    const rewards = await getPendingRewards(
      env,
      hotspot.assetId,
      hotspot.owner
    );

    // Find claimable tokens
    const claimableTokens = Object.entries(rewards).filter(
      ([, r]) => r.claimable && r.pending !== "0"
    );

    if (claimableTokens.length === 0) {
      return jsonResponse({
        success: false,
        error: "No claimable rewards found for this hotspot.",
        claims: [],
      });
    }

    // Check recipient init budget
    const initKey = `claims:inits:${todayUTC()}`;
    let initsToday = parseInt((await env.KV.get(initKey)) || "0", 10);

    // Claim each token
    const claims = [];
    for (const [tokenKey, rewardData] of claimableTokens) {
      try {
        // If recipient needs init, check daily limit
        const needsInit = rewardData.recipientExists === false;
        if (needsInit && initsToday >= MAX_RECIPIENT_INITS_PER_DAY) {
          claims.push({
            token: rewardData.label || tokenKey.toUpperCase(),
            error:
              "Recipient account initialization limit reached for today. Try again tomorrow, or claim via the Helium wallet app.",
          });
          continue;
        }

        const result = await claimRewardsForToken(
          env,
          tokenKey,
          hotspot.assetId,
          hotspot.owner,
          hotspot.keyToAssetKey,
          rewardData.oracleRewards,
          rewardData.destination,
          rewardData.recipientExists !== false
        );

        // Track successful init
        if (needsInit) {
          initsToday++;
          await env.KV.put(initKey, String(initsToday), {
            expirationTtl: 86400,
          });
        }

        claims.push({
          token: result.token,
          amount: rewardData.pending,
          decimals: result.decimals,
          recipient: rewardData.destination || hotspot.owner,
          txSignature: result.txSignature,
          explorerUrl: `https://solscan.io/tx/${result.txSignature}`,
        });
      } catch (err) {
        console.error(`Claim failed for ${tokenKey}:`, err.message, err.stack);
        claims.push({
          token: rewardData.label || tokenKey.toUpperCase(),
          error: err.message,
        });
      }
    }

    // Record the claim for rate limiting (even partial success)
    const anySuccess = claims.some((c) => c.txSignature);
    if (anySuccess) {
      await recordClaim(env, entityKey, claims);
    }

    console.log(JSON.stringify({
      event: "claim",
      entityKey,
      owner: hotspot.owner,
      network: hotspot.network,
      name: hotspot.name,
      success: anySuccess,
      tokens: claims.map((c) => ({
        token: c.token,
        amount: c.amount || null,
        tx: c.txSignature || null,
        error: c.error || null,
      })),
    }));

    return jsonResponse({
      success: anySuccess,
      claims,
    });
  } catch (err) {
    console.error("Claim error:", err.message, err.stack);
    return jsonResponse({ error: "Failed to process claim." }, 500);
  }
}
