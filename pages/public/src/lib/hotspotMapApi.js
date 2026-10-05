import { parseJson } from "./api.js";
import { dedupeAsync } from "./requestDedupe.js";

export const API_BASE = import.meta.env.DEV
  ? "/api/hotspot-map"
  : "https://api.heliumtools.org/hotspot-map";

/**
 * POST /resolve — batch resolve entity keys to on-chain locations.
 */
export async function resolveLocations(entityKeys) {
  const res = await fetch(`${API_BASE}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityKeys }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(data?.error || "Failed to resolve hotspot locations");
  }
  return data;
}

/**
 * GET /onboarded — on-chain onboard date per network for one Hotspot, read
 * from chain by the worker. (Not the Entity API's `created_at`: that's an
 * indexer re-index time, 2025-08-05 for most IoT Hotspots.) Hotspots from
 * before Helium's April 2023 move to Solana carry their migration date.
 * Returns { iot?: iso | null, mobile?: iso | null } for the requested
 * networks, or null if the lookup failed.
 */
const onboardDatesCache = new Map();
const DATES_CACHE_MAX = 500;

// Deduped: the detail card mounts twice per selection (desktop sidebar +
// mobile sheet), and a cold lookup costs the worker RPC calls.
const requestOnboardDates = dedupeAsync(async (entityKey, networksCsv) => {
  const query = new URLSearchParams({ entityKey, networks: networksCsv });
  const res = await fetch(`${API_BASE}/onboarded?${query.toString()}`);
  const data = await parseJson(res);
  return res.ok && data?.onboarded ? data.onboarded : null;
});

export async function fetchOnboardDates(entityKey, networks) {
  const networksCsv = networks.join(",");
  const cacheKey = `${entityKey}|${networksCsv}`;
  if (onboardDatesCache.has(cacheKey)) return onboardDatesCache.get(cacheKey);

  const onboarded = await requestOnboardDates(entityKey, networksCsv);
  if (!onboarded) return null;

  if (onboardDatesCache.size >= DATES_CACHE_MAX) {
    onboardDatesCache.delete(onboardDatesCache.keys().next().value);
  }
  onboardDatesCache.set(cacheKey, onboarded);
  return onboarded;
}

/**
 * GET /wallet — fetch entity keys for a wallet address.
 */
export async function fetchWalletHotspots(address) {
  const query = new URLSearchParams({ address });
  const res = await fetch(`${API_BASE}/wallet?${query.toString()}`);
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(data?.error || "Failed to look up wallet");
  }
  return data;
}
