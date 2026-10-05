import { useState, useEffect, useRef } from "react";
import { scanGatewayStatuses } from "../lib/iotStatusApi.js";
import { hasIotStatus } from "./format.js";

// State flushes are time-throttled so a large fleet re-renders the dashboard a
// few times per scan, not once per completed lookup.
const FLUSH_INTERVAL_MS = 500;

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
    const isCancelled = () => cancelled || runId !== runIdRef.current;
    let lastFlush = 0;
    const flush = ({ statusByKey, dataThrough }, done = false) => {
      lastFlush = Date.now();
      setState({ statusByKey: { ...statusByKey }, dataThrough, done });
    };

    scanGatewayStatuses(
      eligible.map((h) => h.entityKey),
      {
        isCancelled,
        onProgress: (result) => {
          if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) flush(result);
        },
      },
    ).then((result) => {
      if (!isCancelled()) flush(result, true);
    });

    return () => {
      cancelled = true;
    };
  }, [hotspots]);

  return state;
}
