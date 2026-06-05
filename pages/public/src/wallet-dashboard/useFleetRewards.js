import { useState, useEffect, useRef } from "react";
import { fetchRewards } from "../lib/walletDashboardApi.js";

const BATCH_SIZE = 50; // matches the worker's REWARDS_BATCH_SIZE (fewer requests/load)
const CONCURRENCY = 3; // bounded fan-out — respects Helius RPS + the rate-limit cap

/**
 * Progressively fetch pending + lifetime rewards for an entire fleet via the
 * dashboard's own cached /wallet-dashboard/rewards endpoint (`fetchRewards`), in
 * batches of BATCH_SIZE with bounded concurrency. Returns the accumulating reward
 * map plus progress, so cards can show running totals while the fan-out is in flight.
 *
 * @returns {{ rewardsByKey, progress: {done,total}, loading, done }}
 */
export default function useFleetRewards(wallet, hotspots) {
  const [state, setState] = useState({
    rewardsByKey: {},
    progress: { done: 0, total: 0 },
    loading: false,
    done: false,
  });
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;

    // `hotspots === undefined` means the fleet hasn't loaded yet; `[]` means it
    // loaded and is genuinely empty. Only report `done` in the latter case so
    // cards show a loading state ("…") instead of a false settled "$0 / 0 earning".
    const fleetLoaded = Array.isArray(hotspots);
    // Sort so the batch composition is deterministic across reloads — the worker
    // caches per batch by its (sorted) entity keys, so stable batches = cache hits.
    const eligible = (hotspots || [])
      .filter((h) => h.entityKey && h.assetId)
      .sort((a, b) => (a.entityKey < b.entityKey ? -1 : a.entityKey > b.entityKey ? 1 : 0));
    if (!wallet || eligible.length === 0) {
      setState({
        rewardsByKey: {},
        progress: { done: 0, total: 0 },
        loading: false,
        done: !!wallet && fleetLoaded && eligible.length === 0,
      });
      return;
    }

    const batches = [];
    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      batches.push(eligible.slice(i, i + BATCH_SIZE));
    }

    setState({
      rewardsByKey: {},
      progress: { done: 0, total: eligible.length },
      loading: true,
      done: false,
    });

    let cancelled = false;
    const rewardsByKey = {};
    let doneCount = 0;
    let cursor = 0;

    async function worker() {
      while (!cancelled && runId === runIdRef.current) {
        const idx = cursor++;
        if (idx >= batches.length) return;
        const batch = batches[idx];
        try {
          const results = await fetchRewards(
            wallet,
            batch.map((h) => ({ entityKey: h.entityKey, assetId: h.assetId })),
          );
          if (cancelled || runId !== runIdRef.current) return;
          for (const [key, val] of Object.entries(results || {})) {
            rewardsByKey[key] = val?.rewards || null;
          }
        } catch {
          // Record the batch as failed (null) so these Hotspots read as "unknown"
          // (excluded from earning/idle counts) rather than silently counting as
          // idle; keep going so partial totals still render.
          if (cancelled || runId !== runIdRef.current) return;
          for (const h of batch) rewardsByKey[h.entityKey] = null;
        }
        doneCount += batch.length;
        if (cancelled || runId !== runIdRef.current) return;
        setState((prev) => ({
          ...prev,
          rewardsByKey: { ...rewardsByKey },
          progress: { done: Math.min(doneCount, eligible.length), total: eligible.length },
        }));
      }
    }

    const pool = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker);
    Promise.all(pool).then(() => {
      if (cancelled || runId !== runIdRef.current) return;
      setState((prev) => ({ ...prev, loading: false, done: true }));
    });

    return () => {
      cancelled = true;
    };
  }, [wallet, hotspots]);

  return state;
}
