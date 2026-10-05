import { parseJson, throwIfApiError } from "./api.js";
import { dedupeAsync } from "./requestDedupe.js";

// Client for api-iot.heliumtools.org (helium-iot-service): per-Hotspot IoT
// connectivity, delivered-message traffic (utilization) and modeled coverage.
// Keyless and CORS-open by design, so the browser calls it directly (no worker
// proxy); the service edge-caches REST responses ~5 min.
//
// Request budget: ONLY `/v1/gateways/{a}` is built for one-request-per-row
// dashboard bursts. Everything else here is per wallet (the utilization index)
// or per opened Hotspot (detail, coverage) — never fan those out across a fleet.
//
// Semantics (see the service's docs/API.md):
//   - `status: 0` = active = "connected to the Helium Packet Router during the
//     most recent reported day". Liveness lands once per UTC day and is
//     anchored to `dataThrough` (an ISO timestamp marking the END of a 24h
//     window), never wall-clock — it is NOT an "online right now" flag.
//   - `utilization` = delivered LoRaWAN messages over the 30 data days ending
//     its own `dataThrough` (a YYYY-MM-DD data day — a different field and
//     format from the liveness anchor).
const IOT_STATUS_API_BASE = "https://api-iot.heliumtools.org";

/** A utilization data day, "YYYY-MM-DD". */
export const DATA_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Lookups are cached for the service's own edge-cache window, so remounts
// (wallet A → B → back to A) cost zero requests; in-flight requests are shared
// by concurrent callers (StrictMode, the WebMCP tool alongside the page).
const CACHE_TTL_MS = 5 * 60 * 1000;

function apiFetch(path) {
  return fetch(`${IOT_STATUS_API_BASE}${path}`, { signal: AbortSignal.timeout(15_000) });
}

// ── Per-Hotspot gateway record (status + 30-day utilization summary) ─────────

/**
 * Normalize the gateway response's `utilization` block.
 *   ok          — a well-formed block (packets30d may be a real 0)
 *   unavailable — `null` sent `no-store` (a transient read failure on the
 *                 service; a retry gets the real block) or a malformed block
 *   unpublished — `null` sent cacheable: the utilization layer isn't published
 * `Cache-Control` is a CORS-safelisted response header, so it's readable here.
 */
function normalizeUtilization(raw, cacheControl) {
  if (raw == null) {
    const transient = /no-store/i.test(cacheControl || "");
    return { utilization: null, utilizationState: transient ? "unavailable" : "unpublished" };
  }
  const packets30d = Number(raw.packets30d);
  if (
    !Number.isFinite(packets30d) ||
    packets30d < 0 ||
    typeof raw.dataThrough !== "string" ||
    !DATA_DAY_RE.test(raw.dataThrough)
  ) {
    return { utilization: null, utilizationState: "unavailable" };
  }
  const ouis = Array.isArray(raw.ouis) ? raw.ouis.filter((o) => Number.isInteger(o) && o >= 0) : [];
  // Built once per record and stored by reference, so memoized consumers can
  // compare it by identity across scan flushes.
  return {
    utilization: Object.freeze({ packets30d, ouis: Object.freeze(ouis), dataThrough: raw.dataThrough }),
    utilizationState: "ok",
  };
}

async function requestGatewayStatus(address) {
  const res = await apiFetch(`/v1/gateways/${encodeURIComponent(address)}`);
  if (res.status === 404) return { notFound: true };
  const data = await parseJson(res);
  throwIfApiError(res, data);
  if (typeof data?.status !== "number") throw new Error("Malformed status response");
  return {
    status: data.status,
    dataThrough: data.dataThrough ?? null,
    // The service's own asserted res-12 cell (used to spot a footprint built
    // from a previous assertion). Absent when unasserted.
    hex: typeof data.location?.hex === "string" ? data.location.hex : null,
    ...normalizeUtilization(data.utilization, res.headers.get("cache-control")),
  };
}

/**
 * Look up one IoT Hotspot's record by its Helium public key (the fleet row's
 * entityKey). Returns:
 *   - { status: 0|1, dataThrough: string|null, hex: string|null,
 *       utilization: {packets30d, ouis, dataThrough}|null,
 *       utilizationState: "ok"|"unavailable"|"unpublished" } on 200
 *   - { notFound: true } on 404 (unknown to the service's inventory)
 * and throws on transport errors / other statuses so callers can mark the
 * Hotspot "unknown" rather than mislabeling it inactive. Only records with a
 * usable utilization block (or a definitive 404) are cached: a transient or
 * unpublished block must be re-asked on the next scan, not pinned.
 */
export const fetchGatewayStatus = dedupeAsync(requestGatewayStatus, CACHE_TTL_MS, {
  max: 2000, // a couple of large fleets
  keep: (v) => v.notFound || v.utilizationState === "ok",
});

/** Bounded fan-out for a fleet scan (the service collapses per-row bursts at
 * its edge cache, but there's no batch endpoint). */
const SCAN_CONCURRENCY = 8;

/**
 * Look up every address with `fetchGatewayStatus`, SCAN_CONCURRENCY at a
 * time — the one per-row fan-out, shared by the dashboard's progressive scan
 * and its WebMCP tool. A failed lookup records `null` (→ "unknown", never
 * inactive). `dataThrough` keeps the NEWEST liveness anchor seen (ISO strings
 * order lexicographically): first-wins would be nondeterministic under
 * concurrency and could pin a stale day when cached and fresh records mix.
 *
 * `onProgress(result)` runs after each lookup with the live accumulator;
 * `isCancelled()` stops the workers early.
 * @returns {Promise<{statusByKey: Record<string, object|null>, dataThrough: string|null}>}
 */
export async function scanGatewayStatuses(addresses, { onProgress, isCancelled = () => false } = {}) {
  const result = { statusByKey: {}, dataThrough: null };
  let cursor = 0;
  async function worker() {
    while (!isCancelled() && cursor < addresses.length) {
      const address = addresses[cursor++];
      let entry = null;
      try {
        entry = await fetchGatewayStatus(address);
      } catch {
        // Transport failure / 5xx — stays null.
      }
      if (isCancelled()) return;
      result.statusByKey[address] = entry;
      if (entry?.dataThrough && (!result.dataThrough || entry.dataThrough > result.dataThrough)) {
        result.dataThrough = entry.dataThrough;
      }
      onProgress?.(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, addresses.length) }, worker));
  return result;
}

// ── Network utilization index (one request per page, not per Hotspot) ────────

async function requestUtilizationIndex() {
  const res = await apiFetch("/v1/iot/utilization");
  if (res.status === 404) return { published: false };
  const data = await parseJson(res);
  throwIfApiError(res, data);
  if (typeof data?.dataThrough !== "string" || !data.window) throw new Error("Malformed utilization index");
  const ouiStats = new Map();
  for (const o of Array.isArray(data.ouis) ? data.ouis : []) {
    if (Number.isInteger(o?.oui)) {
      ouiStats.set(o.oui, { gateways1d: o.gateways1d ?? null, gateways7d: o.gateways7d ?? null, gateways30d: o.gateways30d ?? null });
    }
  }
  return {
    published: true,
    dataThrough: data.dataThrough,
    days: Number(data.window.days) || 30,
    daysComplete: Number(data.window.daysComplete),
    missingDays: Array.isArray(data.window.missingDays) ? data.window.missingDays.filter((d) => DATA_DAY_RE.test(d)) : [],
    ouiStats,
  };
}

/**
 * The published utilization build's anchor and completeness, plus per-OUI
 * network totals. Used for the "lower bound" note (daysComplete < days), to
 * mark missing days in a Hotspot's daily chart, and for the per-OUI
 * "quiet network-wide" hint. Returns `{ published: false }` on 404 (no build
 * published); throws on failure (callers treat that as "completeness unknown").
 */
export const fetchUtilizationIndex = dedupeAsync(requestUtilizationIndex, CACHE_TTL_MS);

// ── Per-Hotspot daily detail (lazy: only for a Hotspot the user opens) ───────

function normalizeOuiDetail(o) {
  return {
    oui: o.oui,
    packets30d: Number(o.packets30d) || 0,
    packets7d: Number(o.packets7d) || 0,
    packets1d: Number(o.packets1d) || 0,
    daysActive30d: Number.isFinite(Number(o.daysActive30d)) ? Number(o.daysActive30d) : null,
    firstDay: DATA_DAY_RE.test(o.firstDay || "") ? o.firstDay : null,
    lastDay: DATA_DAY_RE.test(o.lastDay || "") ? o.lastDay : null,
  };
}

async function requestUtilizationDetail(address) {
  const res = await apiFetch(`/v1/gateways/${encodeURIComponent(address)}/iot/utilization?series=1`);
  if (res.status === 404) return { notFound: true };
  const data = await parseJson(res);
  throwIfApiError(res, data);
  // 200 with dataThrough/window null = the layer is unpublished (the Hotspot
  // exists; there's no build to read).
  if (data?.dataThrough == null || data?.window == null) return { unpublished: true };
  if (!DATA_DAY_RE.test(data.dataThrough) || !DATA_DAY_RE.test(data.window.start || "")) {
    throw new Error("Malformed utilization detail");
  }
  return {
    detail: {
      dataThrough: data.dataThrough,
      window: {
        start: data.window.start,
        end: data.window.end,
        days: Number(data.window.days) || 30,
        daysComplete: Number(data.window.daysComplete),
      },
      packets30d: Number(data.packets30d) || 0,
      packets7d: Number(data.packets7d) || 0,
      packets1d: Number(data.packets1d) || 0,
      ouis: (Array.isArray(data.ouis) ? data.ouis : []).filter((o) => Number.isInteger(o?.oui)).map(normalizeOuiDetail),
      // Sparse: only days with rows are present. Incomplete days are dropped
      // by the service without saying which — completeness comes from the
      // index's missingDays.
      daily: (Array.isArray(data.daily) ? data.daily : [])
        .filter((r) => Number.isInteger(r?.oui) && DATA_DAY_RE.test(r?.day || ""))
        .map((r) => ({ day: r.day, oui: r.oui, packets: Number(r.packets) || 0 })),
    },
  };
}

/**
 * One Hotspot's delivered messages per OUI, per day, over the 30-day window
 * (`/v1/gateways/{a}/iot/utilization?series=1`, ~2 KB). Returns
 * `{ detail }` | `{ unpublished: true }` | `{ notFound: true }`; throws on
 * transport errors. Call only for a Hotspot the user opened.
 */
export const fetchGatewayUtilizationDetail = dedupeAsync(requestUtilizationDetail, CACHE_TTL_MS, {
  max: 200,
  keep: (v) => !v.unpublished,
});

// ── Per-Hotspot modeled coverage footprint (lazy: one opened Hotspot) ────────

async function requestCoverage(address) {
  const res = await apiFetch(`/v1/gateways/${encodeURIComponent(address)}/iot/coverage`);
  if (res.status === 404) return { notFound: true };
  const data = await parseJson(res);
  throwIfApiError(res, data);
  if (!Array.isArray(data)) throw new Error("Malformed coverage response");
  return {
    cells: data
      .filter((c) => typeof c?.hex === "string" && Number.isFinite(Number(c?.rssi)))
      .map((c) => ({ hex: c.hex, rssi: Number(c.rssi) })),
  };
}

/**
 * The res-8 cells a Hotspot's MODELED coverage reaches, with modeled RSSI
 * (dBm). `{ cells: [] }` means not modeled (inactive, unasserted, not yet
 * built, or the layer is unpublished); `{ notFound: true }` on 404. A model,
 * not a measurement — callers must say so and show the terrain attribution.
 * Only one footprint is shown at a time, so a few are kept for back-and-forth.
 */
export const fetchGatewayCoverage = dedupeAsync(requestCoverage, CACHE_TTL_MS, { max: 10 });
