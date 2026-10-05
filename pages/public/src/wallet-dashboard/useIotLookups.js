import { useState, useEffect, useCallback } from "react";
import {
  fetchUtilizationIndex,
  fetchGatewayUtilizationDetail,
  fetchGatewayCoverage,
} from "../lib/iotStatusApi.js";
import { fetchWellKnownOuiNames } from "../lib/wellKnownOuis.js";

/**
 * Run one cached async lookup per `key` (null key / !enabled = idle).
 * The lib clients share in-flight promises and cache results, so remounts and
 * concurrent consumers (table row + map panel) cost one request. Late results
 * from a superseded key are dropped.
 *
 * @returns {{ state: "idle"|"loading"|"ok"|"error", value, retry }}
 */
function useCachedLookup(key, load, enabled = true) {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState({ key: null, state: "idle", value: null });

  useEffect(() => {
    if (!enabled || key == null) return;
    let cancelled = false;
    setResult({ key, state: "loading", value: null });
    load(key)
      .then((value) => !cancelled && setResult({ key, state: "ok", value }))
      .catch(() => !cancelled && setResult({ key, state: "error", value: null }));
    return () => {
      cancelled = true;
    };
    // `load` is a module-level function per hook below — stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  if (!enabled || key == null) return { state: "idle", value: null, retry };
  // A result for a previous key reads as loading for the new one.
  if (result.key !== key) return { state: "loading", value: null, retry };
  return { state: result.state, value: result.value, retry };
}

// Page-wide lookups take no argument; the key only drives the hook (calling
// the loaders bare keeps them on the same cache entry as the WebMCP tools').
const NAMES_KEY = "names";
const loadIndex = () => fetchUtilizationIndex();
const loadNames = () => fetchWellKnownOuiNames();
const NO_NAMES = new Map();

/**
 * The network utilization index (5-min memo): the published build's
 * dataThrough, days/daysComplete/missingDays, and per-OUI network totals.
 * `forDay` is the data day the caller's rows describe — when it moves (a
 * nightly publish on a long-open page, another wallet), the index is asked
 * again rather than pinned to the build first seen. `index` is null while
 * loading / on failure (completeness unknown), or `{ published: false }`.
 */
export function useUtilizationIndex(enabled = true, forDay = null) {
  const { state, value } = useCachedLookup(`index:${forDay ?? ""}`, loadIndex, enabled);
  return { index: state === "ok" ? value : null, state };
}

/**
 * OUI id → name from helium/well-known (one request per session). `names` is
 * null while loading, then a Map. `failed` = the list couldn't be loaded:
 * `names` is then an empty Map (every OUI reads "OUI {id}") and callers must
 * not say any OUI is "not listed".
 */
export function useWellKnownOuiNames(enabled = true) {
  const { state, value } = useCachedLookup(NAMES_KEY, loadNames, enabled);
  return { names: state === "ok" ? value : state === "error" ? NO_NAMES : null, failed: state === "error" };
}

/**
 * One Hotspot's daily per-OUI traffic (`?series=1`). Pass `entityKey = null`
 * to stay idle — callers skip the request when the gateway record already
 * says the Hotspot delivered nothing (packets30d === 0) or traffic is
 * unavailable.
 *
 * @returns {{ state: "idle"|"loading"|"ok"|"unpublished"|"notFound"|"error", detail, retry }}
 */
export function useHotspotTrafficDetail(entityKey) {
  const { state, value, retry } = useCachedLookup(entityKey, fetchGatewayUtilizationDetail);
  if (state !== "ok") return { state, detail: null, retry };
  if (value.notFound) return { state: "notFound", detail: null, retry };
  if (value.unpublished) return { state: "unpublished", detail: null, retry };
  return { state: "ok", detail: value.detail, retry };
}

/**
 * One Hotspot's modeled coverage footprint. Pass `entityKey = null` to stay
 * idle (the toggle is off, or the Hotspot isn't active — only active Hotspots
 * are modeled).
 *
 * @returns {{ state: "idle"|"loading"|"ok"|"notFound"|"error", cells, retry }}
 */
export function useHotspotCoverage(entityKey) {
  const { state, value, retry } = useCachedLookup(entityKey, fetchGatewayCoverage);
  if (state !== "ok") return { state, cells: null, retry };
  if (value.notFound) return { state: "notFound", cells: null, retry };
  return { state: "ok", cells: value.cells, retry };
}
