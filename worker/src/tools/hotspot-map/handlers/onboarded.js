import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../hotspot-claimer/services/rateLimit.js";
import { isValidEntityKey } from "../../hotspot-claimer/utils.js";
import {
  HOTSPOT_NETWORKS,
  hotspotInfoKey,
  readCachedOnboardedAt,
  resolveOnboardedAt,
} from "../../../lib/helium-solana.js";
import { MAX_ONBOARDED_PER_MINUTE } from "../config.js";

/**
 * GET /onboarded?entityKey=<key>&networks=iot,mobile
 * On-chain onboard date per network for one Hotspot (the detail card's
 * "Onboarded") — see `hotspotInfoCreatedAt` in lib/helium-solana.js for what
 * the date means. `networks` defaults to both; a network the Hotspot isn't on
 * resolves null. The info accounts are derived from the entity key, never
 * taken from the client. Cache-first (the per-account cache shared with the
 * Wallet Dashboard) — a fully cached lookup spends no rate-limit token.
 * Returns: { entityKey, onboarded: { [network]: iso | null }, cached }
 */
export async function handleOnboarded(url, env, request) {
  const entityKey = url.searchParams.get("entityKey");
  if (!isValidEntityKey(entityKey)) {
    return jsonResponse({ error: "Invalid or missing entityKey" }, 400);
  }

  const networksParam = url.searchParams.get("networks");
  const networks = networksParam
    ? [...new Set(networksParam.split(","))].filter((n) => HOTSPOT_NETWORKS.includes(n))
    : HOTSPOT_NETWORKS;
  if (networks.length === 0) {
    return jsonResponse({ error: `networks must be a comma-separated subset of ${HOTSPOT_NETWORKS.join(", ")}` }, 400);
  }

  let accounts; // [network, address][]
  try {
    accounts = networks.map((net) => [net, hotspotInfoKey(net, entityKey).toBase58()]);
  } catch {
    return jsonResponse({ error: "Invalid entityKey" }, 400);
  }

  const dates = await readCachedOnboardedAt(env, accounts.map(([, address]) => address));
  const misses = accounts.filter(([, address]) => !(address in dates));
  if (misses.length > 0) {
    const rateLimitError = await checkIpRateLimit(env, request, {
      prefix: "rl:hm:onb",
      maxRequests: MAX_ONBOARDED_PER_MINUTE,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;
    // A failed lookup reads null here and stays uncached, so the next view retries it.
    await Promise.all(
      misses.map(async ([, address]) => {
        dates[address] = await resolveOnboardedAt(env, address).catch(() => null);
      }),
    );
  }
  const onboarded = Object.fromEntries(accounts.map(([net, address]) => [net, dates[address]]));
  return jsonResponse({ entityKey, onboarded, cached: misses.length === 0 });
}
