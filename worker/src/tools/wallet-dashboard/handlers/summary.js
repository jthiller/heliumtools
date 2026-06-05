import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { RATE_LIMIT, CACHE_TTL } from "../config.js";
import { isValidWalletAddress, kvGetJson, kvPutJson } from "../utils.js";
import { fetchBalances } from "../services/balances.js";
import { fetchPrices } from "../services/prices.js";
import { fetchFleet } from "../services/fleet.js";

/**
 * GET /summary?wallet=<addr>
 * Fast aggregate: token balances + USD prices + portfolio value + fleet stats.
 * Excludes the per-Hotspot list (see /fleet) and governance/rewards (separate,
 * client-driven). KV-cached briefly so repeated loads are cheap.
 */
export async function handleSummary(url, env, request) {
  const wallet = url.searchParams.get("wallet");
  if (!isValidWalletAddress(wallet)) {
    return jsonResponse({ error: "Invalid wallet address" }, 400);
  }

  // Serve cache hits without spending a rate-limit token — the limiter exists to
  // protect upstreams, and a cached response never touches them.
  const cacheKey = `wd:summary:${wallet}`;
  const cached = await kvGetJson(env, cacheKey);
  if (cached) return jsonResponse(cached);

  const limited = await checkIpRateLimit(env, request, RATE_LIMIT);
  if (limited) return limited;

  let balances, priceData, fleet;
  try {
    [balances, priceData, fleet] = await Promise.all([
      fetchBalances(env, wallet),
      fetchPrices(env),
      fetchFleet(env, wallet),
    ]);
  } catch (err) {
    return jsonResponse({ error: `Failed to load wallet summary: ${err.message}` }, 502);
  }

  // Per-token USD value + portfolio total.
  const usd = priceData.usd || {};
  let totalUsd = 0;
  const tokens = {};
  for (const [key, bal] of Object.entries(balances)) {
    const price = usd[key] ?? null;
    const value = price != null ? bal.uiAmount * price : null;
    if (value != null) totalUsd += value;
    tokens[key] = { ...bal, priceUsd: price, valueUsd: value };
  }

  const result = {
    wallet,
    tokens,
    totalUsd,
    prices: usd,
    pricesFetchedAt: priceData.fetchedAt ?? null,
    fleet: { count: fleet.count, ...fleet.stats },
    // NOTE: we deliberately do NOT expose a wallet-level "operating since" — that
    // would require a full transaction/ownership lookback we don't do. The fleet's
    // oldest Hotspot onboard date (fleet.oldestCreatedAt) is the honest stat.
    generatedAt: Date.now(),
  };

  await kvPutJson(env, cacheKey, result, CACHE_TTL.summary);
  return jsonResponse(result);
}
