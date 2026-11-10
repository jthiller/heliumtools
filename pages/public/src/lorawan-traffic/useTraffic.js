import { useCallback, useEffect, useState } from "react";
import { fetchNetworkTraffic, fetchOuiTraffic } from "../lib/iotStatusApi.js";
import { fetchWellKnownOuiNames } from "../lib/wellKnownOuis.js";
import { assignHotspotIds, buildOuiRows } from "./data.js";

/** Per-OUI files in flight at once. */
const FILE_CONCURRENCY = 8;

const EMPTY_LAYER = Object.freeze({ points: Object.freeze([]), ids: new Uint32Array(0) });

const INITIAL = {
  // "index" (loading the summary) -> "layers" (summary in, files arriving) -> "ready" | "error"
  status: "index",
  error: null,
  index: null,
  rows: [],
  // false when the well-known list didn't load: every OUI then reads "OUI <n>".
  namesLoaded: true,
  layers: new Map(), // oui -> { points, ids }
  loaded: 0,
  total: 0,
  hotspotIds: 0, // distinct Hotspots across the loaded layers
  failed: [], // "OUI <n> (<reason>)" for files that failed after a retry
};

/** A sentence for a failed summary read. */
function explainFailure(err) {
  if (err?.status) return `The utilization API answered with an error (HTTP ${err.status}). Try again in a few minutes.`;
  return "The utilization API is unreachable. Check your connection, or try again in a few minutes.";
}

/**
 * Loads the map's data: the utilization index and Helium's well-known OUI names
 * together, then one file per OUI, a few at a time, busiest OUI first. Layers
 * arrive in `layers` as they load, so the map fills in progressively. A file
 * that fails is retried once, then listed in `failed` and left empty; only a
 * failed index is an error. `reload()` starts over.
 */
export default function useTraffic() {
  const [state, setState] = useState(INITIAL);
  const [run, setRun] = useState(0);
  const reload = useCallback(() => setRun((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setState(INITIAL);

    (async () => {
      const [index, names] = await Promise.all([
        fetchNetworkTraffic({ signal }),
        // The names are a nicety: without them the map still works by number.
        fetchWellKnownOuiNames({ signal }).catch(() => null),
      ]);
      if (signal.aborted) return;
      if (!index.published) {
        setState({
          ...INITIAL,
          status: "error",
          error: "The utilization API has no published build yet. The map fills in once the nightly build publishes. Try again later.",
        });
        return;
      }

      const rows = buildOuiRows(index, names);
      const withFile = new Set(index.files.ouis);
      const queue = rows.map((r) => r.oui).filter((oui) => withFile.has(oui));
      // OUIs the index lists without a file have no located Hotspots.
      const layers = new Map(rows.filter((r) => !withFile.has(r.oui)).map((r) => [r.oui, EMPTY_LAYER]));
      setState({ ...INITIAL, status: queue.length ? "layers" : "ready", index, rows, namesLoaded: names !== null, layers, total: queue.length });

      const registry = new Map(); // Hotspot address -> small integer id
      let next = 0;
      const worker = async () => {
        while (next < queue.length && !signal.aborted) {
          const oui = queue[next++];
          let points = null;
          let reason = "";
          for (let attempt = 0; attempt < 2 && points === null && !signal.aborted; attempt++) {
            try {
              points = await fetchOuiTraffic(oui, index.files.oui, index.version, { signal });
            } catch (err) {
              reason = err?.name === "TimeoutError" ? "timed out" : err?.message || "failed";
            }
          }
          if (signal.aborted) return;
          const layer = points === null ? EMPTY_LAYER : { points, ids: assignHotspotIds(points, registry) };
          setState((prev) => ({
            ...prev,
            layers: new Map(prev.layers).set(oui, layer),
            loaded: prev.loaded + 1,
            hotspotIds: registry.size,
            failed: points === null ? [...prev.failed, `OUI ${oui} (${reason})`] : prev.failed,
            status: prev.loaded + 1 >= prev.total ? "ready" : prev.status,
          }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(FILE_CONCURRENCY, queue.length) }, worker));
    })().catch((err) => {
      if (signal.aborted) return;
      console.error("[lorawan-traffic] load failed:", err);
      setState({ ...INITIAL, status: "error", error: explainFailure(err) });
    });

    return () => controller.abort();
  }, [run]);

  return { ...state, reload };
}
