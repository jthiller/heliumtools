import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../hotspot-claimer/services/rateLimit.js";
import { isValidEntityKey } from "../../hotspot-claimer/utils.js";
import { HOTSPOT_NETWORKS, hotspotInfoAccounts, onboardedAtFor } from "../../../lib/helium-solana.js";
import { MAX_ONBOARDED_PER_MINUTE } from "../config.js";

/**
 * GET /onboarded?entityKey=<key>&networks=iot,mobile
 * On-chain onboard date per network for one Hotspot (the detail card's
 * "Onboarded") — via lib `onboardedAtFor` (what the date means, the cache
 * shared with the Wallet Dashboard, the existence check). `networks` defaults
 * to both; a network the Hotspot isn't on resolves null. The info accounts are
 * derived from the entity key, never taken from the client. A fully cached
 * lookup spends no rate-limit token.
 * Returns: { entityKey, onboarded: { [network]: iso | null }, cached }
 */
export async function handleOnboarded(url, env, request) {
  const entityKey = url.searchParams.get("entityKey");
  if (!isValidEntityKey(entityKey)) {
    return jsonResponse({ error: "Invalid or missing entityKey" }, 400);
  }

  const networksParam = url.searchParams.get("networks");
  const networks = networksParam ? networksParam.split(",") : HOTSPOT_NETWORKS;
  let accounts; // [network, address][]
  try {
    accounts = hotspotInfoAccounts(entityKey, networks);
  } catch {
    return jsonResponse({ error: "Invalid entityKey" }, 400);
  }
  if (accounts.length === 0) {
    return jsonResponse({ error: `networks must be a comma-separated subset of ${HOTSPOT_NETWORKS.join(", ")}` }, 400);
  }

  const { dates, cached, stop } = await onboardedAtFor(
    env,
    accounts.map(([, address]) => address),
    {
      beforeMiss: () =>
        checkIpRateLimit(env, request, { prefix: "rl:hm:onb", maxRequests: MAX_ONBOARDED_PER_MINUTE, windowSeconds: 60 }),
    },
  );
  if (stop) return stop;
  const onboarded = Object.fromEntries(accounts.map(([network, address]) => [network, dates[address] ?? null]));
  return jsonResponse({ entityKey, onboarded, cached });
}
