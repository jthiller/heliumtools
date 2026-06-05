import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { RATE_LIMIT } from "../config.js";
import { isValidWalletAddress } from "../utils.js";
import { fetchFleet } from "../services/fleet.js";

/**
 * GET /fleet?wallet=<addr>
 * Full per-Hotspot list (for the map, exportable table, geo, timeline) plus the
 * derived fleet stats. Coordinates are decoded from each row's H3 `location` on
 * the client.
 */
export async function handleFleet(url, env, request) {
  const wallet = url.searchParams.get("wallet");
  if (!isValidWalletAddress(wallet)) {
    return jsonResponse({ error: "Invalid wallet address" }, 400);
  }

  const limited = await checkIpRateLimit(env, request, RATE_LIMIT);
  if (limited) return limited;

  try {
    const fleet = await fetchFleet(env, wallet);
    return jsonResponse({
      wallet,
      count: fleet.count,
      hotspots: fleet.hotspots,
      stats: fleet.stats,
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to load fleet: ${err.message}` }, 502);
  }
}
