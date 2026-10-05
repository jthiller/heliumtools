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

/** Full per-Hotspot list (map + table + geo) plus fleet stats. */
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

/**
 * Batched + cached on-chain onboard dates for `[{ entityKey, networks }]`.
 * Returns the `{ [entityKey]: { [network]: iso | null } }` results map.
 */
export async function fetchOnboarded(hotspots) {
  const res = await fetch(`${API_BASE}/onboarded`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotspots }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data.results;
}

const ONBOARDED_BATCH_SIZE = 50; // the worker's cap
// A cold batch is up to 100 RPC lookups server-side — keep the fan-out narrow.
const ONBOARDED_CONCURRENCY = 2;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_WAIT_SECONDS = 60;

/**
 * Onboard dates for fleet rows (`entityKey` + `networks`) via `fetchOnboarded`,
 * in batches of 50, two in flight — the one fan-out, shared by the dashboard's
 * progressive scan and its WebMCP tools. A failed batch records `{}` (no date
 * known) for its Hotspots (→ "—", and IoT verdicts fall through rather than
 * stay pending).
 *
 * `waitOutRateLimit` retries a 429'd batch after its retry-after (≤60s, up to
 * 3×): right for the page, since dates are cached for good once resolved and a
 * cold large fleet is worth finishing; an agent tool would rather report a
 * partial result. `onProgress(result)` runs after each batch with the live
 * accumulator; `isCancelled()` stops early.
 * @returns {Promise<{onboardedByKey: Record<string, Record<string, string|null>>, failedBatches: number, batchCount: number}>}
 */
export async function scanOnboardDates(hotspots, { onProgress, isCancelled = () => false, waitOutRateLimit = false } = {}) {
  const rows = hotspots.map(({ entityKey, networks }) => ({ entityKey, networks }));
  const batches = [];
  for (let i = 0; i < rows.length; i += ONBOARDED_BATCH_SIZE) batches.push(rows.slice(i, i + ONBOARDED_BATCH_SIZE));

  const result = { onboardedByKey: {}, failedBatches: 0, batchCount: batches.length };
  const fetchBatch = async (batch) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchOnboarded(batch);
      } catch (err) {
        if (!waitOutRateLimit || !err?.rateLimited || attempt >= MAX_RATE_LIMIT_RETRIES || isCancelled()) throw err;
        const waitSeconds = Math.min(err.retryAfterSeconds || 5, MAX_RETRY_WAIT_SECONDS);
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
        if (isCancelled()) throw err; // the page moved on during the wait
      }
    }
  };
  let cursor = 0;
  async function worker() {
    while (!isCancelled() && cursor < batches.length) {
      const batch = batches[cursor++];
      let results = null;
      try {
        results = await fetchBatch(batch);
      } catch {
        result.failedBatches++;
      }
      if (isCancelled()) return;
      for (const { entityKey } of batch) result.onboardedByKey[entityKey] = results?.[entityKey] ?? {};
      onProgress?.(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(ONBOARDED_CONCURRENCY, batches.length) }, worker));
  return result;
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
