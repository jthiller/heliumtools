import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fetchRewards } from "../lib/walletDashboardApi.js";

export const REWARDS_BATCH_SIZE = 50; // matches the worker's REWARDS_BATCH_SIZE (fewer requests/load)
const CONCURRENCY = 3; // bounded fan-out — respects Helius RPS + the rate-limit cap

/**
 * The fleet rows /rewards batches are built from: filtered to claimable
 * rows, sorted so batch composition is deterministic (the worker caches
 * per batch by its sorted entity keys — stable batches = cache hits), and
 * projected to the {entityKey, assetId} pairs the endpoint takes. Shared
 * with the page's WebMCP tool so agent batches hit the same warm cache.
 */
export function eligibleRewardHotspots(hotspots) {
  return (hotspots || [])
    .filter((h) => h.entityKey && h.assetId)
    .sort((a, b) => (a.entityKey < b.entityKey ? -1 : a.entityKey > b.entityKey ? 1 : 0))
    .map((h) => ({ entityKey: h.entityKey, assetId: h.assetId }));
}

const IDLE = { rewardsByKey: {}, progress: { done: 0, total: 0 }, loading: false, done: false, failed: 0, retrying: false, error: null };

/**
 * Progressively fetch pending + lifetime rewards for an entire fleet via the
 * dashboard's own cached /wallet-dashboard/rewards endpoint (`fetchRewards`), in
 * batches of BATCH_SIZE with bounded concurrency. Returns the accumulating reward
 * map plus progress, so sections can show running totals while the fan-out is in flight.
 *
 * rewardsByKey values: the Hotspot's rewards, or null when its batch failed
 * (unknown, never counted as idle); an absent key is still loading.
 *
 * `retryFailed()` re-requests only the batches that failed (their keys read
 * null), as they were composed (so a cached batch is a hit), with the same
 * concurrency; every loaded entry stays, answers merge into the same map, and
 * `progress` / `done` move back by the retried part only. A second failure
 * leaves those entries null. A no-op while a scan runs. `failed` counts the
 * Hotspots whose batch failed. `retrying` is true while a retry runs (`done`
 * is then false, but the scan isn't starting over: figures that settled stay
 * settled). `error`: the last failed batch's message once the scan settles
 * with failures (for a "Details" beside Retry), else null.
 *
 * @returns {{ rewardsByKey, progress: {done,total}, loading, done, failed, retrying, error, retryFailed }}
 */
export default function useFleetRewards(wallet, hotspots) {
  const [state, setState] = useState(IDLE);
  const runIdRef = useRef(0);
  // The live run: { runId, wallet, batches, rewardsByKey, doneCount, total, running }.
  const runRef = useRef(null);

  // Request `batches` for `run` CONCURRENCY at a time, merging answers into
  // its map and flushing after each batch; marks the scan done when the last
  // in-flight pool for the run finishes. `counted[i]`: how many Hotspots
  // batch i moves `progress` by (all of them, or a retry's failed ones).
  const runBatches = useCallback((run, batches, counted) => {
    const live = () => run.runId === runIdRef.current;
    let cursor = 0;
    run.running++;
    async function worker() {
      while (live()) {
        const idx = cursor++;
        if (idx >= batches.length) return;
        const batch = batches[idx];
        try {
          const results = await fetchRewards(run.wallet, batch);
          if (!live()) return;
          for (const h of batch) {
            const rewards = results?.[h.entityKey]?.rewards;
            if (rewards) run.rewardsByKey[h.entityKey] = rewards;
            else if (run.rewardsByKey[h.entityKey] === undefined) run.rewardsByKey[h.entityKey] = null;
          }
        } catch (e) {
          // Record the batch as failed (null) so these Hotspots read as "unknown"
          // (excluded from earning/idle counts) rather than silently counting as
          // idle; keep going so partial totals still render. A retried batch
          // never clears an entry that loaded.
          if (!live()) return;
          run.lastError = e?.message || String(e);
          for (const h of batch) if (run.rewardsByKey[h.entityKey] === undefined) run.rewardsByKey[h.entityKey] = null;
        }
        run.doneCount += counted ? counted[idx] : batch.length;
        setState((prev) => ({
          ...prev,
          rewardsByKey: { ...run.rewardsByKey },
          progress: { done: Math.min(run.doneCount, run.total), total: run.total },
        }));
      }
    }
    const pool = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker);
    return Promise.all(pool).then(() => {
      if (!live()) return;
      run.running--;
      if (run.running > 0) return;
      const failed = Object.values(run.rewardsByKey).filter((v) => v === null).length;
      setState((prev) => ({ ...prev, loading: false, done: true, failed, retrying: false, error: failed ? (run.lastError ?? null) : null }));
    });
  }, []);

  useEffect(() => {
    const runId = ++runIdRef.current;
    runRef.current = null;

    // `hotspots === undefined` means the fleet hasn't loaded yet; `[]` means it
    // loaded and is genuinely empty. Only report `done` in the latter case so
    // sections show a loading state ("…") instead of a false settled "$0 / 0 earning".
    const fleetLoaded = Array.isArray(hotspots);
    const eligible = eligibleRewardHotspots(hotspots);
    if (!wallet || eligible.length === 0) {
      setState({ ...IDLE, done: !!wallet && fleetLoaded && eligible.length === 0 });
      return;
    }

    const batches = [];
    for (let i = 0; i < eligible.length; i += REWARDS_BATCH_SIZE) {
      batches.push(eligible.slice(i, i + REWARDS_BATCH_SIZE));
    }
    const run = { runId, wallet, batches, rewardsByKey: {}, doneCount: 0, total: eligible.length, running: 0 };
    runRef.current = run;
    setState({ ...IDLE, progress: { done: 0, total: eligible.length }, loading: true });
    runBatches(run, batches);

    return () => {
      // A newer run id stops this run's workers at their next step.
      if (runIdRef.current === runId) runIdRef.current++;
    };
  }, [wallet, hotspots, runBatches]);

  const retryFailed = useCallback(() => {
    const run = runRef.current;
    if (!run || run.runId !== runIdRef.current || run.running > 0) return;
    const failedBatches = run.batches.filter((b) => b.some((h) => run.rewardsByKey[h.entityKey] == null));
    if (!failedBatches.length) return;
    // Only the failed entries go back to loading; a loaded one keeps its value
    // until the batch's answer overwrites it.
    const counted = failedBatches.map((b) => {
      let n = 0;
      for (const h of b) {
        if (run.rewardsByKey[h.entityKey] != null) continue;
        delete run.rewardsByKey[h.entityKey];
        n++;
      }
      return n;
    });
    const retried = counted.reduce((s, n) => s + n, 0);
    run.doneCount -= retried;
    run.lastError = null;
    setState((prev) => ({
      ...prev,
      rewardsByKey: { ...run.rewardsByKey },
      progress: { done: Math.max(0, run.doneCount), total: run.total },
      loading: true,
      done: false,
      retrying: true,
    }));
    runBatches(run, failedBatches, counted);
  }, [runBatches]);

  return useMemo(() => ({ ...state, retryFailed }), [state, retryFailed]);
}
