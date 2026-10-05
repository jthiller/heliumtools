import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { ONBOARDED_RATE_LIMIT, ONBOARDED_BATCH_SIZE } from "../config.js";
import { isValidWalletAddress } from "../utils.js";
import { isValidEntityKey } from "../../hotspot-claimer/utils.js";
import { fetchFleet } from "../services/fleet.js";
import { readCachedOnboardDates, resolveOnboardDates } from "../services/onboarded.js";

/**
 * POST /onboarded { wallet, entityKeys: [...] }
 *
 * On-chain onboard dates for a batch (≤ ONBOARDED_BATCH_SIZE) of the wallet's
 * Hotspots — see services/onboarded.js for what the date means and why it isn't
 * the Entity API's `created_at`. The client fans the fleet out to this in
 * batches. Cache-first per Hotspot, and a fully cached batch doesn't spend a
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

  const wallet = body?.wallet;
  if (!isValidWalletAddress(wallet)) {
    return jsonResponse({ error: "Invalid wallet address" }, 400);
  }

  // Drop malformed keys rather than 400-ing the batch (mirrors /rewards), and
  // dedupe so a repeated key isn't looked up twice.
  const entityKeys = [
    ...new Set((Array.isArray(body?.entityKeys) ? body.entityKeys : []).filter(isValidEntityKey)),
  ];
  if (entityKeys.length === 0) return jsonResponse({ results: {}, cached: false });
  if (entityKeys.length > ONBOARDED_BATCH_SIZE) {
    return jsonResponse({ error: `Too many Hotspots (max ${ONBOARDED_BATCH_SIZE})` }, 400);
  }

  const results = await readCachedOnboardDates(env, entityKeys);
  const misses = entityKeys.filter((k) => !(k in results));
  if (misses.length === 0) return jsonResponse({ results, cached: true });

  const limited = await checkIpRateLimit(env, request, ONBOARDED_RATE_LIMIT);
  if (limited) return limited;

  try {
    const fleet = await fetchFleet(env, wallet);
    Object.assign(results, await resolveOnboardDates(env, fleet, misses));
  } catch (err) {
    return jsonResponse({ error: `Failed to load onboard dates: ${err.message}` }, 502);
  }
  return jsonResponse({ results, cached: false });
}
