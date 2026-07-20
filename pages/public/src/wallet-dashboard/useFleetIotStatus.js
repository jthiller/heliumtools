import { useState, useEffect, useRef } from "react";
import { fetchGatewayStatus } from "../lib/iotStatusApi.js";

// Per-address GETs (the service has no batch endpoint — it's designed for
// per-row bursts and collapses them at its edge cache). Bounded fan-out, with
// state flushed in chunks so a large fleet doesn't trigger a re-render per row.
const CONCURRENCY = 8;
const FLUSH_EVERY = 20;

/**
 * Progressively fetch IoT connectivity status (active/inactive) for a fleet
 * from api-iot.heliumtools.org, one GET per IoT Hotspot. Mobile-only Hotspots
 * are skipped — the service covers the IoT network only.
 *
 * statusByKey values: { status: 0|1 } | { notFound: true } | null (lookup
 * failed → "unknown"); a key that is absent is still loading. `dataThrough` is
 * the liveness feed's newest event timestamp (shared by every lookup) — the
 * anchor for "setting up" derivation and the "as of" display.
 *
 * @returns {{ statusByKey, dataThrough, progress: {done,total}, loading, done }}
 */
export default function useFleetIotStatus(hotspots) {
  const [state, setState] = useState({
    statusByKey: {},
    dataThrough: null,
    progress: { done: 0, total: 0 },
    loading: false,
    done: false,
  });
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;

    // `hotspots === undefined` means the fleet hasn't loaded yet; `[]` means it
    // loaded and is genuinely empty (mirrors useFleetRewards).
    const fleetLoaded = Array.isArray(hotspots);
    const eligible = (hotspots || [])
      .filter((h) => h.entityKey && (h.networks || []).includes("iot"))
      .sort((a, b) => (a.entityKey < b.entityKey ? -1 : a.entityKey > b.entityKey ? 1 : 0));
    if (eligible.length === 0) {
      setState({
        statusByKey: {},
        dataThrough: null,
        progress: { done: 0, total: 0 },
        loading: false,
        done: fleetLoaded,
      });
      return;
    }

    setState({
      statusByKey: {},
      dataThrough: null,
      progress: { done: 0, total: eligible.length },
      loading: true,
      done: false,
    });

    let cancelled = false;
    const statusByKey = {};
    let dataThrough = null;
    let doneCount = 0;
    let cursor = 0;

    const flush = () => {
      setState((prev) => ({
        ...prev,
        statusByKey: { ...statusByKey },
        dataThrough,
        progress: { done: doneCount, total: eligible.length },
      }));
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
          if (!dataThrough && entry.dataThrough) dataThrough = entry.dataThrough;
        } catch {
          // Transport failure / 5xx — record as null so the Hotspot reads as
          // "unknown" instead of silently counting as inactive.
          if (cancelled || runId !== runIdRef.current) return;
          statusByKey[h.entityKey] = null;
        }
        doneCount++;
        if (doneCount % FLUSH_EVERY === 0) flush();
      }
    }

    const pool = Array.from({ length: Math.min(CONCURRENCY, eligible.length) }, worker);
    Promise.all(pool).then(() => {
      if (cancelled || runId !== runIdRef.current) return;
      flush();
      setState((prev) => ({ ...prev, loading: false, done: true }));
    });

    return () => {
      cancelled = true;
    };
  }, [hotspots]);

  return state;
}
