import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../hotspot-claimer/services/rateLimit.js";
import { isValidWalletAddress } from "../../hotspot-claimer/utils.js";
import { MAX_WALLET_LOOKUPS_PER_MINUTE } from "../config.js";
import { getWalletHotspots } from "../services/walletLookup.js";
import { resolveNetworks } from "../services/location.js";

/**
 * GET /wallet?address=<solana-address>
 * Returns: { owner, hotspots: [{ entityKey, name, network }], hotspots_count }
 */
export async function handleWallet(url, env, request) {
  // Rate limit
  const rateLimitError = await checkIpRateLimit(env, request, {
    prefix: "rl:hm:wallet",
    maxRequests: MAX_WALLET_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (rateLimitError) return rateLimitError;

  const address = url.searchParams.get("address");
  if (!isValidWalletAddress(address)) {
    return jsonResponse({ error: "Invalid or missing wallet address" }, 400);
  }

  try {
    const dasHotspots = await getWalletHotspots(env, address);

    // Resolve which networks each entity key is on (iot, mobile, or both)
    const entityKeys = dasHotspots.map((h) => h.entityKey);
    const networkMap = await resolveNetworks(env, entityKeys);

    // Expand: one entry per entity key per network
    const hotspots = [];
    for (const h of dasHotspots) {
      const networks = networkMap.get(h.entityKey) || [];
      if (networks.length === 0) {
        // No on-chain info found — still include so user sees it
        hotspots.push(h);
      } else {
        for (const network of networks) {
          hotspots.push({ ...h, network });
        }
      }
    }

    console.log(
      JSON.stringify({
        event: "hotspot_map_wallet",
        wallet: address,
        hotspots_count: hotspots.length,
      })
    );

    return jsonResponse({
      owner: address,
      hotspots,
      hotspots_count: hotspots.length,
    });
  } catch (err) {
    console.error("wallet lookup error:", err);
    return jsonResponse({ error: "Failed to look up wallet hotspots" }, 500);
  }
}
