import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { readCachedOnboardedAt } from "../../../lib/helium-solana.js";
import { ONBOARDED_RATE_LIMIT, ONBOARDED_BATCH_SIZE } from "../config.js";
import { isValidEntityKey } from "../../hotspot-claimer/utils.js";
import { infoAccountsOf, resolveMissing, earliestOnboardDates } from "../services/onboarded.js";

/**
 * POST /onboarded { hotspots: [{ entityKey, networks }] }
 *
 * On-chain onboard dates for a batch (≤ ONBOARDED_BATCH_SIZE) of Hotspots —
 * see services/onboarded.js. The client fans the fleet out to this in batches.
 * Cache-first per info account, and a fully cached batch doesn't spend a
 * rate-limit token, so reloads are free.
 * Returns { results: { [entityKey]: iso | null }, cached }.
 */
export async function handleOnboarded(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // Drop malformed entries rather than 400-ing the batch (mirrors /rewards),
  // and dedupe by entityKey so a repeated Hotspot isn't looked up twice.
  const hotspots = [
    ...new Map(
      (Array.isArray(body?.hotspots) ? body.hotspots : [])
        .filter((h) => h && isValidEntityKey(h.entityKey))
        .map((h) => [h.entityKey, { entityKey: h.entityKey, networks: Array.isArray(h.networks) ? h.networks : [] }]),
    ).values(),
  ];
  if (hotspots.length === 0) return jsonResponse({ results: {}, cached: false });
  if (hotspots.length > ONBOARDED_BATCH_SIZE) {
    return jsonResponse({ error: `Too many Hotspots (max ${ONBOARDED_BATCH_SIZE})` }, 400);
  }

  const accounts = infoAccountsOf(hotspots);
  const addresses = [...new Set(accounts.flatMap((a) => a.addresses))];
  const dates = await readCachedOnboardedAt(env, addresses);
  const misses = addresses.filter((a) => !(a in dates));
  if (misses.length > 0) {
    const limited = await checkIpRateLimit(env, request, ONBOARDED_RATE_LIMIT);
    if (limited) return limited;
    Object.assign(dates, await resolveMissing(env, misses));
  }
  return jsonResponse({ results: earliestOnboardDates(accounts, dates), cached: misses.length === 0 });
}
