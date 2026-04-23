import { ApiError, parseJson, throwIfApiError as throwIfError } from "./api.js";

export { ApiError };

export const API_BASE = import.meta.env.DEV
  ? "/api/hotspot-claimer"
  : "https://api.heliumtools.org/hotspot-claimer";

export async function lookupHotspot(entityKey) {
  const query = new URLSearchParams({ entityKey });
  const res = await fetch(`${API_BASE}/lookup?${query.toString()}`);
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}

export async function fetchRewards(entityKey) {
  const query = new URLSearchParams({ entityKey });
  const res = await fetch(`${API_BASE}/rewards?${query.toString()}`);
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}

export async function claimRewards(entityKey) {
  const res = await fetch(`${API_BASE}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityKey }),
  });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}

export async function fetchBulkRewards(owner, hotspots) {
  const res = await fetch(`${API_BASE}/wallet/rewards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, hotspots }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data.results;
}

export async function fetchWalletHotspots(address) {
  const query = new URLSearchParams({ address });
  const res = await fetch(`${API_BASE}/wallet?${query.toString()}`);
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}
