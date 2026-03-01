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
