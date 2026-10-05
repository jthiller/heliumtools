import { useState, useEffect, useRef } from "react";
import { scanOnboardDates } from "../lib/walletDashboardApi.js";

// State flushes are time-throttled: a warm cache answers a big fleet's batches
// back-to-back, and each flush re-derives the dashboard's IoT verdicts.
const FLUSH_INTERVAL_MS = 500;
// Reused for every reset so an already-empty map keeps its identity (memos
// keyed on it don't recompute when a scan starts).
const EMPTY = Object.freeze({});

/**
 * Progressively resolve on-chain onboard dates for an entire fleet via
 * `scanOnboardDates` (the dashboard's cached /onboarded endpoint), waiting out
 * rate limits.
 *
 * onboardedByKey values: an ISO timestamp, or null (unknown — the chain history
 * didn't settle it, or the lookup failed); an absent key is still loading.
 * `progress` counts resolved Hotspots for the timeline's wait state.
 *
 * @returns {{ onboardedByKey, progress: {done,total}, done }}
 */
export default function useFleetOnboarded(hotspots) {
  const [state, setState] = useState({ onboardedByKey: EMPTY, progress: { done: 0, total: 0 }, done: false });
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;

    // `hotspots === undefined` means the fleet hasn't loaded yet; `[]` means it
    // loaded and is genuinely empty (mirrors useFleetRewards).
    const eligible = (hotspots || []).filter((h) => h.entityKey);
    const total = eligible.length;
    setState({ onboardedByKey: EMPTY, progress: { done: 0, total }, done: total === 0 && Array.isArray(hotspots) });
    if (total === 0) return;

    let cancelled = false;
    const isCancelled = () => cancelled || runId !== runIdRef.current;
    let lastFlush = 0;
    const flush = ({ onboardedByKey }, done = false) => {
      lastFlush = Date.now();
      setState({
        onboardedByKey: { ...onboardedByKey },
        progress: { done: Object.keys(onboardedByKey).length, total },
        done,
      });
    };

    scanOnboardDates(eligible, {
      isCancelled,
      waitOutRateLimit: true,
      onProgress: (result) => {
        if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) flush(result);
      },
    }).then((result) => {
      if (!isCancelled()) flush(result, true);
    });

    return () => {
      cancelled = true;
    };
  }, [hotspots]);

  return state;
}
