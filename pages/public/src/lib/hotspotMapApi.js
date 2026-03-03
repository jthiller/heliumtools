import { parseJson } from "./api.js";

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
 * Fetch onboarding dates from the Helium Entity API.
 * Returns { iot: "ISO string", mobile: "ISO string" } or subset.
 */
const entityDatesCache = new Map();
const DATES_CACHE_MAX = 500;

export async function fetchEntityDates(entityKey) {
  if (entityDatesCache.has(entityKey)) return entityDatesCache.get(entityKey);

  const res = await fetch(`https://entities.nft.helium.io/${entityKey}`);
  if (!res.ok) return null;

  const data = await res.json();
  const dates = {};
  if (data.hotspot_infos?.iot?.created_at) dates.iot = data.hotspot_infos.iot.created_at;
  if (data.hotspot_infos?.mobile?.created_at) dates.mobile = data.hotspot_infos.mobile.created_at;

  if (entityDatesCache.size >= DATES_CACHE_MAX) {
    entityDatesCache.delete(entityDatesCache.keys().next().value);
  }
  entityDatesCache.set(entityKey, dates);
  return dates;
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
