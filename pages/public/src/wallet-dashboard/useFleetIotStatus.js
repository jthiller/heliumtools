import { useState, useEffect, useRef } from "react";
import { fetchGatewayStatus } from "../lib/iotStatusApi.js";
import { hasIotStatus } from "./format.js";

// Per-address GETs (the service has no batch endpoint — it's designed for
// per-row bursts and collapses them at its edge cache). Bounded fan-out; state
// flushes are time-throttled so a large fleet re-renders the dashboard a few
// times per scan, not once per completed lookup.
const CONCURRENCY = 8;
const FLUSH_INTERVAL_MS = 500;

/**
 * Progressively fetch IoT connectivity status (active/inactive) for a fleet
 * from api-iot.heliumtools.org, one GET per IoT Hotspot (see hasIotStatus for
 * eligibility — mobile-only rows are skipped; the service covers IoT only).
 *
 * statusByKey values: { status: 0|1 } | { notFound: true } | null (lookup
 * failed → "unknown"); a key that is absent is still loading. `dataThrough` is
 * the liveness feed's newest event timestamp (shared by every lookup) — the
 * anchor for "setting up" derivation and the "as of" display.
 *
 * @returns {{ statusByKey, dataThrough, done }}
 */
export default function useFleetIotStatus(hotspots) {
  const [state, setState] = useState({ statusByKey: {}, dataThrough: null, done: false });
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;

    // `hotspots === undefined` means the fleet hasn't loaded yet; `[]` means it
    // loaded and is genuinely empty (mirrors useFleetRewards).
    const fleetLoaded = Array.isArray(hotspots);
    const eligible = (hotspots || []).filter(hasIotStatus);
    if (eligible.length === 0) {
      setState({ statusByKey: {}, dataThrough: null, done: fleetLoaded });
      return;
    }

    setState({ statusByKey: {}, dataThrough: null, done: false });

    let cancelled = false;
    const statusByKey = {};
    let dataThrough = null;
    let lastFlush = 0;
    let cursor = 0;

    const flush = (done = false) => {
      lastFlush = Date.now();
      setState({ statusByKey: { ...statusByKey }, dataThrough, done });
    };

    async function worker() {
      while (!cancelled && runId === runIdRef.current) {
        const idx = cursor++;
        if (idx >= eligible.length) return;
        const h = eligible[idx];
        try {
          const entry = await fetchGatewayStatus(h.entityKey);
          if (cancelled || runId !== runIdRef.current) return;
          statusByKey[h.entityKey] = entry;
          // Keep the NEWEST anchor seen (ISO strings order lexicographically).
          // First-wins would be nondeterministic under concurrency and could
          // pin a stale day when a scan mixes cached and fresh lookups.
          if (entry.dataThrough && (!dataThrough || entry.dataThrough > dataThrough)) {
            dataThrough = entry.dataThrough;
          }
        } catch {
          // Transport failure / 5xx — record as null so the Hotspot reads as
          // "unknown" instead of silently counting as inactive.
          if (cancelled || runId !== runIdRef.current) return;
          statusByKey[h.entityKey] = null;
        }
        if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) flush();
      }
    }

    const pool = Array.from({ length: Math.min(CONCURRENCY, eligible.length) }, worker);
    Promise.all(pool).then(() => {
      if (cancelled || runId !== runIdRef.current) return;
      flush(true);
    });

    return () => {
      cancelled = true;
    };
  }, [hotspots]);

  return state;
}
