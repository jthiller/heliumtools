import { useState, useEffect, useRef } from "react";
import { fetchOnboarded } from "../lib/walletDashboardApi.js";

export const ONBOARDED_BATCH_SIZE = 50; // matches the worker's ONBOARDED_BATCH_SIZE
// A cold batch is up to 100 RPC lookups server-side — keep the fan-out narrow.
const CONCURRENCY = 2;
// Every flush re-clones the fleet rows (dates are merged into them for the map
// and table), so flushes are time-throttled: a warm cache answers a big fleet's
// batches back-to-back, and per-batch flushes would re-render it dozens of times.
const FLUSH_INTERVAL_MS = 500;
// Dates are cached server-side for good once resolved, so a cold large fleet
// that trips the rate limit is worth finishing rather than leaving "—" until a
// reload: wait out the window a few times before giving up on a batch.
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_WAIT_SECONDS = 60;

/**
 * The fleet's entity keys split into /onboarded batches. The worker caches per
 * Hotspot, so batch composition doesn't affect cache hits. Shared with the
 * page's WebMCP tool.
 */
export function onboardedBatches(hotspots) {
  const keys = (hotspots || []).map((h) => h.entityKey).filter(Boolean);
  const batches = [];
  for (let i = 0; i < keys.length; i += ONBOARDED_BATCH_SIZE) {
    batches.push(keys.slice(i, i + ONBOARDED_BATCH_SIZE));
  }
  return batches;
}

/**
 * Progressively resolve on-chain onboard dates for an entire fleet via the
 * dashboard's cached /wallet-dashboard/onboarded endpoint, in batches with
 * bounded concurrency.
 *
 * onboardedByKey values: an ISO timestamp, or null (unknown — the chain
 * history didn't settle it, or the lookup failed); a key that is absent is
 * still loading.
 *
 * @returns {{ onboardedByKey, progress: {done,total}, done }}
 */
export default function useFleetOnboarded(wallet, hotspots) {
  const [state, setState] = useState({
    onboardedByKey: {},
    progress: { done: 0, total: 0 },
    done: false,
  });
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;

    // `hotspots === undefined` means the fleet hasn't loaded yet; `[]` means it
    // loaded and is genuinely empty (mirrors useFleetRewards).
    const fleetLoaded = Array.isArray(hotspots);
    const batches = onboardedBatches(hotspots);
    const total = batches.reduce((n, b) => n + b.length, 0);
    if (!wallet || total === 0) {
      setState({
        onboardedByKey: {},
        progress: { done: 0, total: 0 },
        done: !!wallet && fleetLoaded,
      });
      return;
    }

    setState({ onboardedByKey: {}, progress: { done: 0, total }, done: false });

    let cancelled = false;
    const stale = () => cancelled || runId !== runIdRef.current;
    const onboardedByKey = {};
    let doneCount = 0;
    let cursor = 0;
    let lastFlush = 0;

    const flush = (done = false) => {
      lastFlush = Date.now();
      setState({ onboardedByKey: { ...onboardedByKey }, progress: { done: doneCount, total }, done });
    };

    async function fetchBatch(batch) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fetchOnboarded(wallet, batch);
        } catch (err) {
          if (!err?.rateLimited || attempt >= MAX_RATE_LIMIT_RETRIES) throw err;
          const waitSeconds = Math.min(err.retryAfterSeconds || 5, MAX_RETRY_WAIT_SECONDS);
          await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
          if (stale()) throw err;
        }
      }
    }

    async function worker() {
      while (!stale()) {
        const idx = cursor++;
        if (idx >= batches.length) return;
        const batch = batches[idx];
        try {
          const results = await fetchBatch(batch);
          if (stale()) return;
          for (const key of batch) onboardedByKey[key] = results?.[key] ?? null;
        } catch {
          // Record the batch as unknown (null) so its rows settle on "—"
          // instead of loading forever; keep going for the rest.
          if (stale()) return;
          for (const key of batch) onboardedByKey[key] = null;
        }
        doneCount += batch.length;
        if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) flush();
      }
    }

    const pool = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker);
    Promise.all(pool).then(() => {
      if (stale()) return;
      flush(true);
    });

    return () => {
      cancelled = true;
    };
  }, [wallet, hotspots]);

  return state;
}
