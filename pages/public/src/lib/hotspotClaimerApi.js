import { withTimeout } from "./abort.js";
import { ApiError, parseJson, throwIfApiError as throwIfError } from "./api.js";
import { dedupeAsync } from "./requestDedupe.js";

export { ApiError };

export const API_BASE = import.meta.env?.DEV
  ? "/api/hotspot-claimer"
  : "https://api.heliumtools.org/hotspot-claimer";

// lookupHotspot and fetchWalletHotspots are deduped: the WebMCP tools fetch
// and navigate the page, whose debounced effects would otherwise repeat the
// identical live lookups. Rewards and claims stay undeduped — a claim must
// be reflected by the very next rewards read.
export const lookupHotspot = dedupeAsync(async (entityKey, { signal } = {}) => {
  signal?.throwIfAborted();
  const query = new URLSearchParams({ entityKey });
  const res = await fetch(`${API_BASE}/lookup?${query.toString()}`, { signal: withTimeout(signal, 30_000) });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}, 3_000, { signalIndex: 1 });

export async function fetchRewards(entityKey, { signal } = {}) {
  signal?.throwIfAborted();
  const query = new URLSearchParams({ entityKey });
  const res = await fetch(`${API_BASE}/rewards?${query.toString()}`, { signal });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}

export async function claimRewards(entityKey, { signal } = {}) {
  signal?.throwIfAborted();
  const res = await fetch(`${API_BASE}/claim`, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityKey }),
  });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}

export async function fetchBulkRewards(owner, hotspots, { signal } = {}) {
  signal?.throwIfAborted();
  const res = await fetch(`${API_BASE}/wallet/rewards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, hotspots }),
    signal: withTimeout(signal, 60_000),
  });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data.results;
}

export const fetchWalletHotspots = dedupeAsync(async (address, { signal } = {}) => {
  signal?.throwIfAborted();
  const query = new URLSearchParams({ address });
  const res = await fetch(`${API_BASE}/wallet?${query.toString()}`, { signal: withTimeout(signal, 30_000) });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}, 3_000, { signalIndex: 1 });
