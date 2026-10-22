import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { scanOnboardDates } from "../lib/walletDashboardApi.js";
import { hasIotStatus } from "./format.js";

// State flushes are time-throttled: a warm cache answers a big fleet's batches
// back-to-back, and each flush re-derives the dashboard's IoT verdicts.
const FLUSH_INTERVAL_MS = 500;
// Reused for every reset so an already-empty map keeps its identity (memos
// keyed on it don't recompute when a scan starts).
const EMPTY = Object.freeze({});

/**
 * One `scanOnboardDates` pass over `rows`, writing each batch's dates into
 * `acc.byKey` and noting in `acc.failed` which Hotspots came from a batch
 * that failed (the scan records `{}` for those, the same as "no date on
 * chain"). `onProgress` runs once per batch, right after that batch's keys
 * are written, so the keys new since the last call are that batch's, and a
 * rise in `failedBatches` says it failed.
 */
function scanInto(rows, acc, isCancelled, onBatch) {
  let failedSeen = 0;
  const done = new Set();
  return scanOnboardDates(rows, {
    isCancelled,
    waitOutRateLimit: true,
    onProgress: (result) => {
      const failed = result.failedBatches > failedSeen;
      failedSeen = result.failedBatches;
      for (const key of Object.keys(result.onboardedByKey)) {
        if (done.has(key)) continue;
        done.add(key);
        acc.byKey[key] = result.onboardedByKey[key];
        if (failed) acc.failed.add(key);
        else acc.failed.delete(key);
      }
      onBatch();
    },
  });
}

/**
 * Progressively resolve on-chain onboard dates for an entire fleet via
 * `scanOnboardDates` (the dashboard's cached /onboarded endpoint), waiting out
 * rate limits.
 *
 * onboardedByKey values: the Hotspot's dates per network, `{ iot?, mobile? }`
 * (ISO, or null when unknown: the chain history didn't settle it, or the
 * lookup failed); an absent key is still loading. IoT Hotspots are scanned
 * first: a not-active IoT verdict waits on its date, Mobile rows hold nothing.
 * `progress` counts resolved Hotspots for the timeline's wait state.
 * `failed` counts the Hotspots whose lookup failed (they read unknown, but a
 * failed lookup isn't "no date": Data status and About say so), and
 * `retry()` looks up only those again, in place: `done` stays true and the
 * dates already in never go back to loading (`retrying` while it runs).
 *
 * @returns {{ onboardedByKey, progress: {done,total}, done, failed: number, retrying: boolean, retry: () => void }}
 */
export default function useFleetOnboarded(hotspots) {
  const [state, setState] = useState({
    onboardedByKey: EMPTY,
    progress: { done: 0, total: 0 },
    done: false,
    failed: 0,
    retrying: false,
  });
  const runIdRef = useRef(0);
  // This run's rows, accumulator and flush, for retry().
  const runRef = useRef(null);

  useEffect(() => {
    const runId = ++runIdRef.current;

    // `hotspots === undefined` means the fleet hasn't loaded yet; `[]` means it
    // loaded and is genuinely empty (mirrors useFleetRewards).
    // Stable sort: IoT rows first, fleet order within each group.
    const eligible = (hotspots || []).filter((h) => h.entityKey).sort((a, b) => hasIotStatus(b) - hasIotStatus(a));
    const total = eligible.length;
    setState({
      onboardedByKey: EMPTY,
      progress: { done: 0, total },
      done: total === 0 && Array.isArray(hotspots),
      failed: 0,
      retrying: false,
    });
    runRef.current = null;
    if (total === 0) return;

    let cancelled = false;
    const isCancelled = () => cancelled || runId !== runIdRef.current;
    const acc = { byKey: {}, failed: new Set() };
    let lastFlush = 0;
    const flush = (done, retrying) => {
      lastFlush = Date.now();
      setState({
        onboardedByKey: { ...acc.byKey },
        progress: { done: Object.keys(acc.byKey).length, total },
        done,
        failed: acc.failed.size,
        retrying,
      });
    };
    const run = { eligible, acc, flush, isCancelled, busy: true };
    runRef.current = run;

    scanInto(eligible, acc, isCancelled, () => {
      if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) flush(false, false);
    }).then(() => {
      if (isCancelled()) return;
      run.busy = false;
      flush(true, false);
    });

    return () => {
      cancelled = true;
    };
  }, [hotspots]);

  const retry = useCallback(() => {
    const run = runRef.current;
    if (!run || run.busy || run.isCancelled() || run.acc.failed.size === 0) return;
    run.busy = true;
    const rows = run.eligible.filter((h) => run.acc.failed.has(h.entityKey));
    run.flush(true, true);
    let lastFlush = Date.now();
    scanInto(rows, run.acc, run.isCancelled, () => {
      if (Date.now() - lastFlush < FLUSH_INTERVAL_MS) return;
      lastFlush = Date.now();
      run.flush(true, true);
    }).then(() => {
      if (run.isCancelled()) return;
      run.busy = false;
      run.flush(true, false);
    });
  }, []);

  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
