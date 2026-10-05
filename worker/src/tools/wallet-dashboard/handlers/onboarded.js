import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { hotspotInfoAccounts, onboardedAtFor } from "../../../lib/helium-solana.js";
import { ONBOARDED_RATE_LIMIT, ONBOARDED_BATCH_SIZE } from "../config.js";
import { isValidEntityKey } from "../../hotspot-claimer/utils.js";

/**
 * POST /onboarded { hotspots: [{ entityKey, networks }] }
 *
 * On-chain onboard dates for a batch (≤ ONBOARDED_BATCH_SIZE) of Hotspots, per
 * network — via lib `onboardedAtFor` (what the date means, the shared cache,
 * the existence check). The client fans the fleet out to this in batches. The
 * info accounts are derived from each entity key, never taken from the client.
 * A fully cached batch doesn't spend a rate-limit token, so reloads are free.
 * Returns { results: { [entityKey]: { [network]: iso | null } }, cached } —
 * null for a network whose date is unknown (not settled, not on chain, or a
 * transient failure; failures aren't cached).
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
        .map((h) => [h.entityKey, Array.isArray(h.networks) ? h.networks : []]),
    ),
  ];
  if (hotspots.length === 0) return jsonResponse({ results: {}, cached: false });
  if (hotspots.length > ONBOARDED_BATCH_SIZE) {
    return jsonResponse({ error: `Too many Hotspots (max ${ONBOARDED_BATCH_SIZE})` }, 400);
  }

  const accounts = hotspots.map(([entityKey, networks]) => {
    try {
      return [entityKey, hotspotInfoAccounts(entityKey, networks)];
    } catch {
      return [entityKey, []]; // a key that won't derive has no accounts
    }
  });
  const addresses = [...new Set(accounts.flatMap(([, accts]) => accts.map(([, address]) => address)))];
  const { dates, cached, stop } = await onboardedAtFor(env, addresses, {
    beforeMiss: () => checkIpRateLimit(env, request, ONBOARDED_RATE_LIMIT),
  });
  if (stop) return stop;

  const results = Object.fromEntries(
    accounts.map(([entityKey, accts]) => [
      entityKey,
      Object.fromEntries(accts.map(([network, address]) => [network, dates[address] ?? null])),
    ]),
  );
  return jsonResponse({ results, cached });
}
