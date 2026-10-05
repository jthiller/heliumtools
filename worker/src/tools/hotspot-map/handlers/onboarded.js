import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../hotspot-claimer/services/rateLimit.js";
import { isValidEntityKey } from "../../hotspot-claimer/utils.js";
import { MAX_ONBOARDED_PER_MINUTE } from "../config.js";
import {
  ONBOARD_NETWORKS,
  infoAccountsFor,
  readCachedOnboardDates,
  resolveOnboardDates,
} from "../services/onboarded.js";

/**
 * GET /onboarded?entityKey=<key>&networks=iot,mobile
 * On-chain onboard date per network for one Hotspot (the detail card's
 * "Onboarded"). `networks` defaults to both; a network the Hotspot isn't on
 * resolves null. Cache-first — a fully cached lookup spends no rate-limit token.
 * Returns: { entityKey, onboarded: { [network]: iso | null }, cached }
 */
export async function handleOnboarded(url, env, request) {
  const entityKey = url.searchParams.get("entityKey");
  if (!isValidEntityKey(entityKey)) {
    return jsonResponse({ error: "Invalid or missing entityKey" }, 400);
  }

  const networksParam = url.searchParams.get("networks");
  const networks = networksParam
    ? [...new Set(networksParam.split(","))].filter((n) => ONBOARD_NETWORKS.includes(n))
    : ONBOARD_NETWORKS;
  if (networks.length === 0) {
    return jsonResponse({ error: `networks must be a comma-separated subset of ${ONBOARD_NETWORKS.join(", ")}` }, 400);
  }

  let accounts;
  try {
    accounts = await infoAccountsFor(entityKey, networks);
  } catch {
    return jsonResponse({ error: "Invalid entityKey" }, 400);
  }

  const onboarded = await readCachedOnboardDates(env, accounts);
  const misses = Object.fromEntries(Object.entries(accounts).filter(([net]) => !(net in onboarded)));
  if (Object.keys(misses).length === 0) {
    return jsonResponse({ entityKey, onboarded, cached: true });
  }

  const rateLimitError = await checkIpRateLimit(env, request, {
    prefix: "rl:hm:onb",
    maxRequests: MAX_ONBOARDED_PER_MINUTE,
    windowSeconds: 60,
  });
  if (rateLimitError) return rateLimitError;

  Object.assign(onboarded, await resolveOnboardDates(env, misses));
  return jsonResponse({ entityKey, onboarded, cached: false });
}
