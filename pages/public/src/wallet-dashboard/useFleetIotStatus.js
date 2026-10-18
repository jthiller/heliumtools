import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { scanGatewayStatuses } from "../lib/iotStatusApi.js";
import { hasIotStatus } from "./format.js";

// State flushes are time-throttled so a large fleet re-renders the dashboard a
// few times per scan, not once per completed lookup.
const FLUSH_INTERVAL_MS = 500;
const IDLE = { statusByKey: {}, dataThrough: null, done: false, failed: 0, retrying: false };

/**
 * Progressively fetch each IoT Hotspot's api-iot.heliumtools.org record — IoT
 * connectivity (active/inactive) plus its 30-day traffic (`utilization`)
 * block — one GET per IoT Hotspot via `scanGatewayStatuses` (see hasIotStatus
 * for eligibility — mobile-only rows are skipped; the service covers IoT
 * only). This is the ONLY per-row fan-out to the service; per-Hotspot detail
 * and coverage are fetched lazily for an opened Hotspot.
 *
 * statusByKey values: the `fetchGatewayStatus` record ({ status, dataThrough,
 * hex, utilization, utilizationState }) | { notFound: true } | null (lookup
 * failed → "unknown"); a key that is absent is still loading. Derive verdicts
 * through format.js (`aggregateIotStatus` / `iotRowOf`). `dataThrough` is the
 * newest liveness anchor seen across lookups — the fallback for "setting up"
 * derivation.
 *
 * `retryFailed()` looks up again only the Hotspots whose lookup failed (null),
 * through the same scan (8 in flight): those entries go back to loading, every
 * other entry stays, answers merge in, and `done` returns once they're in. A
 * second failure leaves them null. A no-op while a scan runs. `failed` counts
 * the failed lookups. `retrying` is true while a retry runs (`done` is then
 * false, but the scan isn't starting over: figures that settled stay settled).
 *
 * @returns {{ statusByKey, dataThrough, done, failed, retrying, retryFailed }}
 */
export default function useFleetIotStatus(hotspots) {
  const [state, setState] = useState(IDLE);
  const runIdRef = useRef(0);
  // The live run: { runId, statusByKey, dataThrough, running, retrying }.
  const runRef = useRef(null);

  const scan = useCallback((run, keys) => {
    const isCancelled = () => run.runId !== runIdRef.current;
    let lastFlush = 0;
    const flush = (done = false) => {
      lastFlush = Date.now();
      const failed = done ? Object.values(run.statusByKey).filter((v) => v === null).length : 0;
      setState({ statusByKey: { ...run.statusByKey }, dataThrough: run.dataThrough, done, failed, retrying: !done && run.retrying });
    };
    run.running = true;
    return scanGatewayStatuses(keys, {
      isCancelled,
      onProgress: (result) => {
        Object.assign(run.statusByKey, result.statusByKey);
        if (result.dataThrough && (!run.dataThrough || result.dataThrough > run.dataThrough)) run.dataThrough = result.dataThrough;
        if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) flush();
      },
    }).then((result) => {
      if (isCancelled()) return;
      Object.assign(run.statusByKey, result.statusByKey);
      if (result.dataThrough && (!run.dataThrough || result.dataThrough > run.dataThrough)) run.dataThrough = result.dataThrough;
      run.running = false;
      run.retrying = false;
      flush(true);
    });
  }, []);

  useEffect(() => {
    const runId = ++runIdRef.current;
    runRef.current = null;

    // `hotspots === undefined` means the fleet hasn't loaded yet; `[]` means it
    // loaded and is genuinely empty (mirrors useFleetRewards).
    const fleetLoaded = Array.isArray(hotspots);
    const eligible = (hotspots || []).filter(hasIotStatus);
    if (eligible.length === 0) {
      setState({ ...IDLE, done: fleetLoaded });
      return;
    }

    setState(IDLE);
    const run = { runId, statusByKey: {}, dataThrough: null, running: false, retrying: false };
    runRef.current = run;
    scan(
      run,
      eligible.map((h) => h.entityKey),
    );

    return () => {
      // A newer run id stops this scan's workers at their next step.
      if (runIdRef.current === runId) runIdRef.current++;
    };
  }, [hotspots, scan]);

  const retryFailed = useCallback(() => {
    const run = runRef.current;
    if (!run || run.runId !== runIdRef.current || run.running) return;
    const keys = Object.keys(run.statusByKey).filter((k) => run.statusByKey[k] === null);
    if (!keys.length) return;
    for (const k of keys) delete run.statusByKey[k];
    run.retrying = true;
    setState((prev) => ({ ...prev, statusByKey: { ...run.statusByKey }, done: false, failed: 0, retrying: true }));
    scan(run, keys);
  }, [scan]);

  return useMemo(() => ({ ...state, retryFailed }), [state, retryFailed]);
}
