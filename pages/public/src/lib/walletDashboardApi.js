import { ApiError, parseJson, throwIfApiError } from "./api.js";

export { ApiError };

export const API_BASE = import.meta.env.DEV
  ? "/api/wallet-dashboard"
  : "https://api.heliumtools.org/wallet-dashboard";

/** Balances + USD prices + portfolio total + fleet stats (no per-Hotspot list). */
export async function fetchSummary(wallet) {
  const query = new URLSearchParams({ wallet });
  const res = await fetch(`${API_BASE}/summary?${query.toString()}`);
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}

/** Full per-Hotspot list (map + table + geo + timeline) plus fleet stats. */
export async function fetchFleet(wallet) {
  const query = new URLSearchParams({ wallet });
  const res = await fetch(`${API_BASE}/fleet?${query.toString()}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}

/**
 * Batched + cached pending/lifetime rewards for a set of Hotspots.
 * Returns the `{ [entityKey]: { rewards, error } }` results map.
 */
export async function fetchRewards(owner, hotspots) {
  const res = await fetch(`${API_BASE}/rewards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, hotspots }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data.results;
}

/** Categorized recent transactions; pass `before` (a signature) to paginate. */
export async function fetchTransactions(wallet, { before, limit } = {}) {
  const query = new URLSearchParams({ wallet });
  if (before) query.set("before", before);
  if (limit) query.set("limit", String(limit));
  const res = await fetch(`${API_BASE}/transactions?${query.toString()}`);
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}
