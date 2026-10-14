import { memo, useState, useMemo, useCallback, useEffect, useRef } from "react";
import MapGL, { NavigationControl } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { WebMercatorViewport } from "@deck.gl/core";
import { ScatterplotLayer, PolygonLayer, LineLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";
import { cellToLatLng, cellToBoundary, cellToParent } from "h3-js";
import { XMarkIcon } from "@heroicons/react/24/outline";
import useDarkMode from "../lib/useDarkMode.js";
import useReducedMotion, { prefersReducedMotion } from "../lib/useReducedMotion.js";
import CopyButton from "../components/CopyButton.jsx";
import { Dot, TimeAgo } from "./cards/primitives.jsx";
import IotTrafficDetail from "./IotTrafficDetail.jsx";
import { useHotspotCoverage } from "./useIotLookups.js";
import {
  deviceLabel,
  isEarning,
  fmtToken,
  fmtCompact,
  plural,
  lifetimeUi,
  isTrafficKnown,
  livenessDay,
  fmtDataDay,
  fmtGainDbi,
  fmtElevationM,
  modeledCoverageInputs,
  COVERAGE_RSSI_MIN,
  COVERAGE_RSSI_MAX,
  IOT_STATUS_LABEL,
  IOT_STATUS_COLOR,
  NETWORK_COLOR,
  accountUrl,
  fmtAgo,
  fmtBytes,
  fmtCount,
  fmtDate,
} from "./format.js";
import {
  LOCATION_SOURCE_LABEL,
  MOBILE_ISSUES,
  fmtMbps,
  fmtMeters,
  fmtMultiplier,
  fmtReason,
  windowText,
} from "./mobileFormat.js";

const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Dot colors derive from the shared network palette so they match the card
// chips/bars (single source of truth in format.js).
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const IOT_COLOR = hexToRgb(NETWORK_COLOR.iot);
const MOBILE_COLOR = hexToRgb(NETWORK_COLOR.mobile);
const IDLE_COLOR = [148, 163, 184]; // map-only "never rewarded" state, no card equivalent
const INACTIVE_COLOR = hexToRgb(IOT_STATUS_COLOR.inactive);
const WHITE = [255, 255, 255];
const WHITE_SOFT = [255, 255, 255, 150];

// Dot radius (px) carries 30-day IoT messages; fill keeps meaning status.
// Log-ish buckets: Hotspot counts span 0 to ~10⁶, so a linear scale would
// leave all but the busiest at the floor.
const BUSY_MESSAGES = 1000;
const DOT_RADIUS = { quiet: 3, some: 5, busy: 8, base: 4 };
const SELECTED_GROWTH = 2;
const SIZE_KEY = [
  { radius: DOT_RADIUS.quiet, label: "0" },
  { radius: DOT_RADIUS.some, label: `<${fmtCompact(BUSY_MESSAGES)}` },
  { radius: DOT_RADIUS.busy, label: `${fmtCompact(BUSY_MESSAGES)}+` },
];

// Modeled-coverage ramp over COVERAGE_RSSI_MIN → MAX: one blue hue (clear of
// the dots' emerald / violet / rose / slate), faintest at the floor and
// deepest + most opaque toward −90 dBm. [r, g, b, alpha 0–1].
const COVERAGE_RAMP = {
  light: { from: [183, 211, 246, 0.45], to: [28, 92, 171, 0.75] },
  dark: { from: [24, 79, 149, 0.45], to: [109, 167, 236, 0.8] },
};
// The service models coverage on res-8 cells.
const COVERAGE_RES = 8;
// Below this zoom res-8 cells are a few pixels wide — ease in when a
// footprint loads.
const FOOTPRINT_MIN_ZOOM = 9;
const FOOTPRINT_ZOOM = 10;
const TERRAIN_TILES_URL = "https://registry.opendata.aws/terrain-tiles/";

// deck.gl's tooltip is a plain div inside the map container; theme tokens are
// CSS variables, so it follows light/dark like the rest of the page.
const TOOLTIP_STYLE = {
  backgroundColor: "rgb(var(--color-surface-raised))",
  color: "rgb(var(--color-content))",
  fontSize: "12px",
  lineHeight: "16px",
  padding: "6px 8px",
  borderRadius: "8px",
  boxShadow: "var(--shadow-card-lg)",
  maxWidth: "260px",
  marginLeft: "12px",
  marginTop: "12px",
};

const INITIAL_VIEW = { longitude: -98.5, latitude: 39.8, zoom: 3.2, pitch: 0, bearing: 0 };

// The selected WiFi Hotspot's heartbeats (last 60 min): its asserted cell,
// its reported positions, and lines out to positions farther than this from
// the asserted centre (closer ones sit on the cell).
const FAR_M = 25;
// Mobile violet, light/dark (the --color-mobile token's two values).
const MOBILE_OVERLAY = { light: [124, 58, 237], dark: [167, 139, 250] };
const POSITION_FILL = { light: [255, 255, 255], dark: [30, 30, 34] };
// Arrival pulse: two rings per new position, the second trailing.
const PULSE_RING_MS = 900;
const PULSE_STAGGER_MS = 350;
const PULSE_MS = PULSE_RING_MS + PULSE_STAGGER_MS;
// Camera eases, instant under reduced motion (read when the ease starts).
const EASE_MS = 800;
const easeMs = () => (prefersReducedMotion() ? 0 : EASE_MS);
// The heartbeat window's wording before any Mobile data is in.
const HEARTBEAT_WINDOW_DEFAULT = windowText("heartbeats", null);

/** Great-circle distance in meters between two [lat, lng] points. */
function metersBetween([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Decode an H3 hex cell index to [lat, lng]; null on failure. */
function h3HexToLatLng(hex) {
  try {
    return cellToLatLng(hex);
  } catch {
    return null;
  }
}

/** An H3 cell's outline as a closed [lng, lat] ring; null on failure. */
function h3Boundary(hex) {
  try {
    return cellToBoundary(hex, true);
  } catch {
    return null;
  }
}

/** A cell's ancestor at `res` (lowercased for comparison); null on failure. */
function h3Parent(hex, res) {
  if (!hex) return null;
  try {
    return cellToParent(hex.toLowerCase(), res);
  } catch {
    return null;
  }
}

/** A whole dB value with a true minus sign: "−112". */
function fmtDb(value) {
  const n = Math.round(value);
  return `${n < 0 ? "−" : ""}${Math.abs(n)}`;
}

const fmtDbm = (rssi) => `${fmtDb(rssi)} dBm`;

/** deck.gl fill ([r, g, b, 0–255]) for a modeled RSSI, along the ramp. */
function coverageColor(rssi, dark) {
  const { from, to } = dark ? COVERAGE_RAMP.dark : COVERAGE_RAMP.light;
  const t = Math.min(1, Math.max(0, (rssi - COVERAGE_RSSI_MIN) / (COVERAGE_RSSI_MAX - COVERAGE_RSSI_MIN)));
  const [r, g, b, a] = from.map((v, i) => v + (to[i] - v) * t);
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)];
}

const cssRgba = ([r, g, b, a]) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;

/** Size/outline encoding for one dot from its IoT row's `traffic` (null for a
 * non-IoT Hotspot). */
function dotEncoding(traffic) {
  // Not an IoT Hotspot (Mobile-only): base size, filled.
  if (traffic == null) return { radius: DOT_RADIUS.base, hollow: false, known: false };
  // IoT, traffic pending / unavailable / unpublished: base size, hollow.
  if (!isTrafficKnown(traffic)) return { radius: DOT_RADIUS.base, hollow: true, known: false };
  const n = traffic.packets30d;
  const radius = n === 0 ? DOT_RADIUS.quiet : n < BUSY_MESSAGES ? DOT_RADIUS.some : DOT_RADIUS.busy;
  return { radius, hollow: false, known: true };
}

/** One-line hover summary for a fleet dot, from its IoT row (null if
 * non-IoT) and its Mobile row (null if not on Mobile). `noHeartbeat`: the
 * no-heartbeat wording for the current window (aggregateMobile's issueText). */
function dotTooltip(hotspot, row, mobileRow, noHeartbeat) {
  const name = hotspot.name || "Unnamed Hotspot";
  // WiFi Hotspots: the heartbeat verdict, once heartbeats are in.
  const heartbeat =
    mobileRow?.heartbeating == null
      ? null
      : mobileRow.heartbeating
        ? `Heartbeat ${fmtAgo(mobileRow.lastHeartbeatAt)}`
        : noHeartbeat;
  if (!row) return [name, deviceLabel(hotspot.deviceType), heartbeat].filter(Boolean).join(" · ");
  if (row.status === "pending") return [name, "Checking IoT status…", heartbeat].filter(Boolean).join(" · ");
  const day = livenessDay(row.anchor);
  return [
    name,
    day ? `${IOT_STATUS_LABEL[row.status]} (${fmtDataDay(day)})` : IOT_STATUS_LABEL[row.status],
    row.messages != null ? `${plural(row.messages, "message")} (30d)` : "traffic unavailable",
    heartbeat,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Hover summary for one reported heartbeat position, in its window
 * (`window`: windowText for the heartbeats). The distance is the table's,
 * the same figure the panel shows. */
function positionTooltip(p, window) {
  return [
    `Reported position · ${plural(p.n, "heartbeat")} ${window.long}`,
    `${fmtMeters(p.away)} from asserted`,
    [p.source && (LOCATION_SOURCE_LABEL[p.source] || p.source), p.trust != null && `trust ${fmtMultiplier(p.trust)}`]
      .filter(Boolean)
      .join(", "),
    p.lastAt ? `last heard ${fmtAgo(p.lastAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The selected Hotspot's footprint as drawn: cells at or above the ramp floor
 * with their outlines, plus the facts the panel's caveats need. null until
 * cells load.
 */
function deriveFootprint(cells, assertedHex) {
  if (!cells) return null;
  const ownCell = h3Parent(assertedHex, COVERAGE_RES);
  const drawn = [];
  for (const c of cells) {
    if (c.rssi < COVERAGE_RSSI_MIN) continue;
    const polygon = h3Boundary(c.hex);
    if (polygon) drawn.push({ ...c, polygon });
  }
  const isOwn = (c) => c.hex.toLowerCase() === ownCell;
  return {
    modeled: cells.length,
    drawn,
    // Built nightly from the asserted location at the time — a footprint
    // that misses the Hotspot's own cell predates its current assertion.
    fromPreviousAssertion: Boolean(ownCell) && cells.length > 0 && !cells.some(isOwn),
    onlyOwnCell: drawn.length === 1 && isOwn(drawn[0]),
  };
}

export default function FleetMap({
  hotspots = [],
  rewardsByKey = {},
  iotStatus = null,
  mobile = null,
  mobileArrivals = null,
  heartbeatsLive = false,
  wallet = null,
}) {
  const dark = useDarkMode();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  // The selected Hotspot (entityKey) and whether its modeled coverage is
  // shown — one state so a new selection always starts with coverage off.
  const [selection, setSelection] = useState({ key: null, coverage: false });
  const selected = selection.key;
  const fittedRef = useRef(null);
  const easedRef = useRef(null);
  const hoverDotRef = useRef(false);
  // Per-row IoT verdicts, derived once per scan flush by the shell; per-row
  // Mobile verdicts likewise, once per Mobile update.
  const iotRows = iotStatus?.rows;
  const mobileRows = mobile?.rows;

  const select = useCallback(
    (key) => setSelection((s) => (s.key === key ? s : { key, coverage: false })),
    [],
  );
  const toggleCoverage = useCallback(() => setSelection((s) => ({ ...s, coverage: !s.coverage })), []);

  // Decode coordinates once per fleet.
  const mappable = useMemo(() => {
    const out = [];
    for (const h of hotspots) {
      if (!h.location) continue;
      const coords = h3HexToLatLng(h.location);
      if (coords) out.push({ ...h, coords });
    }
    return out;
  }, [hotspots]);

  // One encoded dot per mappable Hotspot, biggest first so small dots draw on
  // top. Fill: IoT-inactive (the most actionable thing on this map) over
  // never-rewarded dimming over the network color. A new array whenever
  // status/traffic/rewards change, so deck recomputes every attribute; only
  // selection needs updateTriggers below.
  const dots = useMemo(() => {
    const out = mappable.map((h) => {
      const row = iotRows?.get(h.entityKey);
      return {
        hotspot: h,
        color:
          row?.status === "inactive"
            ? INACTIVE_COLOR
            : isEarning(rewardsByKey[h.entityKey]) === false
              ? IDLE_COLOR
              : h.network === "mobile"
                ? MOBILE_COLOR
                : IOT_COLOR,
        ...dotEncoding(row?.traffic),
      };
    });
    return out.sort((a, b) => b.radius - a.radius);
  }, [mappable, iotRows, rewardsByKey]);

  // Legend rows appear only for encodings actually drawn.
  const legend = useMemo(
    () => ({
      inactive: dots.some((d) => d.color === INACTIVE_COLOR),
      idle: dots.some((d) => d.color === IDLE_COLOR),
      sizeKey: dots.some((d) => d.known),
      hollow: dots.some((d) => d.hollow),
    }),
    [dots],
  );

  // Fit to bounds once per wallet (keyed on wallet+size, so switching to another
  // wallet re-centers even if it has the same Hotspot count) without fighting pan/zoom.
  useEffect(() => {
    if (mappable.length === 0) return;
    const sig = `${wallet}:${mappable.length}`;
    if (fittedRef.current === sig) return;
    fittedRef.current = sig;

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const h of mappable) {
      const [lat, lng] = h.coords;
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
    if (mappable.length === 1) {
      setViewState((p) => ({ ...p, latitude: minLat, longitude: minLng, zoom: 12, transitionDuration: easeMs() }));
    } else {
      const span = Math.max(maxLat - minLat, maxLng - minLng) || 0.1;
      const zoom = Math.max(1, Math.min(15, Math.log2(360 / (span * 1.6))));
      setViewState((p) => ({
        ...p,
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        zoom,
        transitionDuration: easeMs(),
      }));
    }
  }, [mappable, wallet]);

  const selectedHotspot = useMemo(
    () => (selected ? mappable.find((h) => h.entityKey === selected) : null),
    [selected, mappable],
  );
  const selectedRow = selectedHotspot ? iotRows?.get(selectedHotspot.entityKey) ?? null : null;
  const selectedMobileRow = selectedHotspot ? mobileRows?.get(selectedHotspot.entityKey) ?? null : null;
  const mobileDays = useMemo(
    () => ({
      rewards: mobile?.rewards?.latest?.state === "ok" ? mobile.rewards.latest.day : null,
      usage: mobile?.usage?.day ?? null,
      loaded: mobile?.loaded ?? null,
      failed: mobile?.failed ?? null,
      windows: mobile?.windows ?? null,
    }),
    [mobile?.rewards, mobile?.usage, mobile?.loaded, mobile?.failed, mobile?.windows],
  );
  const hbWindow = mobile?.windows?.heartbeats ?? HEARTBEAT_WINDOW_DEFAULT;
  const noHeartbeatLabel = mobile?.issueText?.noHeartbeat.label ?? MOBILE_ISSUES.noHeartbeat.label;

  // The selected WiFi Hotspot's heartbeats in the window, as drawn: asserted
  // cell (the heartbeats' own, else the fleet row's), reported positions and
  // the far ones. `away` is the table's distance from asserted (the panel's
  // and the agent tool's figure, between res-12 cell centres), measured here
  // only when the table has none (an unasserted Hotspot); lines and the
  // camera still draw to each position's own coordinates.
  const heartbeatOverlay = useMemo(() => {
    if (!selectedMobileRow?.wifi || !selectedMobileRow.points.length) return null;
    const cell = selectedMobileRow.assertedCell || selectedHotspot.location;
    const center = cell ? h3HexToLatLng(cell) : null;
    if (!center) return null;
    const points = selectedMobileRow.points.map((p) => ({
      ...p,
      away: p.distance ?? metersBetween(center, [p.lat, p.lon]),
    }));
    return {
      center,
      polygon: h3Boundary(cell),
      points,
      far: points.filter((p) => p.away > FAR_M),
    };
  }, [selectedMobileRow, selectedHotspot]);
  const overlayColor = dark ? MOBILE_OVERLAY.dark : MOBILE_OVERLAY.light;

  // New heartbeat positions for the selected Hotspot pulse once on a live
  // arrival (never on the first load, a reselection, or the window sliding).
  // Positions are grouped fixes (see mobile/tables.js): one is new when its
  // latest fix is newer than the last snapshot's.
  const [pulse, setPulse] = useState(null); // { key, points, start }
  const [pulseT, setPulseT] = useState(0);
  const positionsSeenRef = useRef({ key: null, seq: 0, lastAt: new Map() });
  useEffect(() => {
    const seen = positionsSeenRef.current;
    const points = heartbeatOverlay?.points ?? [];
    const seq = mobileArrivals?.seq ?? 0;
    const at = (p) => `${p.lat},${p.lon}`;
    if (
      !reducedMotion &&
      selected &&
      seen.key === selected &&
      seq > seen.seq &&
      mobileArrivals.byTable.heartbeats?.includes(selected)
    ) {
      const fresh = points.filter((p) => (seen.lastAt.get(at(p)) ?? 0) < p.lastAt);
      if (fresh.length) {
        setPulseT(0);
        setPulse({ key: selected, points: fresh, start: performance.now() });
      }
    }
    positionsSeenRef.current = { key: selected, seq, lastAt: new Map(points.map((p) => [at(p), p.lastAt])) };
  }, [selected, heartbeatOverlay, mobileArrivals, reducedMotion]);
  // ~30 fps while a pulse plays, then stops; a separate layer, so the static
  // ones aren't rebuilt per frame.
  useEffect(() => {
    if (!pulse) return undefined;
    const id = setInterval(() => {
      const t = performance.now() - pulse.start;
      if (t >= PULSE_MS) setPulse(null);
      else setPulseT(t);
    }, 33);
    return () => clearInterval(id);
  }, [pulse]);

  // Bring reported positions into view, only when some are more than FAR_M
  // from the asserted cell and aren't already visibly apart on screen. Decided
  // once per selection, as soon as its live heartbeats are in (never on the
  // saved paint), and a pan or zoom first uses the decision up (see
  // onViewStateChange): a far fix arriving later never moves the camera.
  const easedPositionsRef = useRef(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const selectedWifi = Boolean(selectedMobileRow?.wifi);
  useEffect(() => {
    if (!selected) {
      easedPositionsRef.current = null;
      return;
    }
    if (easedPositionsRef.current === selected || !heartbeatsLive || !selectedWifi) return;
    easedPositionsRef.current = selected;
    if (!heartbeatOverlay?.far.length) return;
    const box = containerRef.current?.getBoundingClientRect();
    if (!box?.width || !box?.height) return;
    const { width, height } = box;
    const spots = [heartbeatOverlay.center, ...heartbeatOverlay.far.map((p) => [p.lat, p.lon])];
    const lats = spots.map((p) => p[0]);
    const lngs = spots.map((p) => p[1]);
    const bounds = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
    const base = Math.round(Math.min(80, width / 4, height / 4));
    const padding = { top: base, right: base, bottom: base, left: base };
    // Keep clear of the detail panel: beside it on a wide map, above it on
    // a narrow one.
    const panel = containerRef.current.querySelector("[data-map-panel]")?.getBoundingClientRect();
    if (panel?.width) {
      if (panel.width < width * 0.6) padding.left = Math.max(base, Math.round(panel.right - box.left + 16));
      else padding.bottom = Math.max(base, Math.round(box.bottom - panel.top + 16));
    }
    if (padding.left + padding.right >= width - 40 || padding.top + padding.bottom >= height - 40) {
      Object.assign(padding, { top: base, right: base, bottom: base, left: base });
    }
    setViewState((vs) => {
      const viewport = new WebMercatorViewport({ ...vs, width, height });
      const px = spots.map(([lat, lng]) => viewport.project([lng, lat]));
      const inside = px.every(
        ([x, y]) =>
          x >= padding.left && x <= width - padding.right && y >= padding.top && y <= height - padding.bottom,
      );
      const xs = px.map((p) => p[0]);
      const ys = px.map((p) => p[1]);
      const apart = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) >= 40;
      if (inside && apart) return vs;
      const fit = viewport.fitBounds(bounds, { padding, maxZoom: 18 });
      // fitBounds offsets for uneven padding at its unclamped zoom, so at
      // maxZoom (positions a few meters apart) the offset shrinks and a
      // position can land under the panel: centre the bounds in the padded
      // area at the final zoom.
      const at = new WebMercatorViewport({ ...vs, width, height, ...fit });
      const [mx, my] = at.project([(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]);
      const tx = padding.left + (width - padding.left - padding.right) / 2;
      const ty = padding.top + (height - padding.top - padding.bottom) / 2;
      const [longitude, latitude] = at.unproject([width / 2 + mx - tx, height / 2 + my - ty]);
      return { ...vs, longitude, latitude, zoom: fit.zoom, transitionDuration: easeMs() };
    });
  }, [selected, heartbeatOverlay, heartbeatsLive, selectedWifi]);

  // Only active Hotspots with an asserted location (per the service's own
  // record) are modeled; anything else is guaranteed `[]`, so no toggle.
  const coverageEligible = selectedRow?.status === "active" && Boolean(selectedRow.hex);
  const coverageShown = coverageEligible && selection.coverage;
  const coverage = useHotspotCoverage(coverageShown ? selected : null);
  const footprint = useMemo(
    () => deriveFootprint(coverage.cells, selectedRow?.hex),
    [coverage.cells, selectedRow?.hex],
  );
  const footprintDrawn = Boolean(footprint?.drawn.length);
  const { from: rampFrom, to: rampTo } = dark ? COVERAGE_RAMP.dark : COVERAGE_RAMP.light;
  const rampCss = `linear-gradient(to right, ${cssRgba(rampFrom)}, ${cssRgba(rampTo)})`;
  // Stable panel props, so the memoized panel skips pan/zoom re-renders.
  const coverageProps = useMemo(
    () =>
      coverageEligible
        ? { shown: coverageShown, onToggle: toggleCoverage, state: coverage.state, retry: coverage.retry, footprint, rampCss }
        : null,
    [coverageEligible, coverageShown, toggleCoverage, coverage.state, coverage.retry, footprint, rampCss],
  );
  const deselect = useCallback(() => select(null), [select]);

  // A fleet-fit view is usually too far out to see res-8 cells: bring a
  // freshly loaded footprint into view (once per load; never zooms out).
  useEffect(() => {
    if (!footprint?.drawn.length || !selectedHotspot || easedRef.current === footprint) return;
    easedRef.current = footprint;
    const [lat, lng] = selectedHotspot.coords;
    setViewState((p) =>
      p.zoom >= FOOTPRINT_MIN_ZOOM
        ? p
        : { ...p, latitude: lat, longitude: lng, zoom: FOOTPRINT_ZOOM, transitionDuration: easeMs() },
    );
  }, [footprint, selectedHotspot]);

  const layers = useMemo(() => {
    const out = [];
    // Before "fleet" so the dots stay on top of the footprint.
    if (footprintDrawn) {
      out.push(
        new PolygonLayer({
          id: "footprint",
          data: footprint.drawn,
          getPolygon: (d) => d.polygon,
          getFillColor: (d) => coverageColor(d.rssi, dark),
          filled: true,
          stroked: false,
          pickable: true,
          updateTriggers: { getFillColor: [dark] },
        }),
      );
    }
    // The selected Hotspot's asserted cell and lines out to far positions,
    // under the dots.
    if (heartbeatOverlay) {
      if (heartbeatOverlay.polygon) {
        out.push(
          new PolygonLayer({
            id: "asserted-cell",
            data: [heartbeatOverlay.polygon],
            getPolygon: (d) => d,
            getFillColor: [...overlayColor, 40],
            getLineColor: [...overlayColor, 220],
            getLineWidth: 1.5,
            lineWidthUnits: "pixels",
            filled: true,
            stroked: true,
            updateTriggers: { getFillColor: [dark], getLineColor: [dark] },
          }),
        );
      }
      if (heartbeatOverlay.far.length) {
        out.push(
          new LineLayer({
            id: "position-lines",
            data: heartbeatOverlay.far,
            getSourcePosition: () => [heartbeatOverlay.center[1], heartbeatOverlay.center[0]],
            getTargetPosition: (p) => [p.lon, p.lat],
            getColor: [...overlayColor, 170],
            getWidth: 1.5,
            widthUnits: "pixels",
            updateTriggers: { getColor: [dark] },
          }),
        );
      }
    }
    out.push(
      new ScatterplotLayer({
        id: "fleet",
        data: dots,
        getPosition: (d) => [d.hotspot.coords[1], d.hotspot.coords[0]],
        // Hollow = IoT traffic not known: the status color moves to the outline.
        getFillColor: (d) => (d.hollow ? [...d.color, 0] : d.color),
        getLineColor: (d) =>
          d.hollow ? d.color : d.hotspot.entityKey === selected ? WHITE : WHITE_SOFT,
        getLineWidth: (d) => (d.hotspot.entityKey === selected ? 2 : d.hollow ? 1.5 : 1),
        getRadius: (d) => d.radius + (d.hotspot.entityKey === selected ? SELECTED_GROWTH : 0),
        radiusUnits: "pixels",
        radiusMaxPixels: DOT_RADIUS.busy + SELECTED_GROWTH,
        lineWidthUnits: "pixels",
        stroked: true,
        filled: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [14, 165, 233, 120],
        updateTriggers: {
          getLineColor: [selected],
          getLineWidth: [selected],
          getRadius: [selected],
        },
      }),
    );
    // Reported positions above the dots: they cluster on the selected one.
    if (heartbeatOverlay) {
      out.push(
        new ScatterplotLayer({
          id: "positions",
          data: heartbeatOverlay.points,
          getPosition: (p) => [p.lon, p.lat],
          getFillColor: dark ? POSITION_FILL.dark : POSITION_FILL.light,
          getLineColor: overlayColor,
          getRadius: 4,
          getLineWidth: 2,
          radiusUnits: "pixels",
          lineWidthUnits: "pixels",
          stroked: true,
          filled: true,
          pickable: true,
          updateTriggers: { getFillColor: [dark], getLineColor: [dark] },
        }),
      );
    }
    return out;
  }, [dots, selected, footprint, footprintDrawn, dark, heartbeatOverlay, overlayColor]);

  // The arrival pulse, rebuilt per frame while it plays.
  const pulseLayer = useMemo(() => {
    if (!pulse || pulse.key !== selected) return null;
    const rings = [];
    for (const delay of [0, PULSE_STAGGER_MS]) {
      const t = (pulseT - delay) / PULSE_RING_MS;
      if (t <= 0 || t >= 1) continue;
      const eased = 1 - (1 - t) ** 2;
      for (const p of pulse.points) rings.push({ p, radius: 5 + 20 * eased, alpha: Math.round(200 * (1 - eased)) });
    }
    return new ScatterplotLayer({
      id: "position-pulse",
      data: rings,
      getPosition: (d) => [d.p.lon, d.p.lat],
      getRadius: (d) => d.radius,
      getLineColor: (d) => [...overlayColor, d.alpha],
      getLineWidth: 2,
      radiusUnits: "pixels",
      lineWidthUnits: "pixels",
      stroked: true,
      filled: false,
    });
  }, [pulse, pulseT, selected, overlayColor]);
  const allLayers = useMemo(() => (pulseLayer ? [...layers, pulseLayer] : layers), [layers, pulseLayer]);

  const getTooltip = useCallback(
    ({ layer, object }) => {
      if (!object) return null;
      if (layer?.id === "fleet") {
        const h = object.hotspot;
        return {
          text: dotTooltip(h, iotRows?.get(h.entityKey), mobileRows?.get(h.entityKey), noHeartbeatLabel),
          style: TOOLTIP_STYLE,
        };
      }
      if (layer?.id === "footprint") return { text: `${fmtDbm(object.rssi)} (modeled)`, style: TOOLTIP_STYLE };
      if (layer?.id === "positions") return { text: positionTooltip(object, hbWindow), style: TOOLTIP_STYLE };
      return null;
    },
    [iotRows, mobileRows, noHeartbeatLabel, hbWindow],
  );

  // A dot selects; empty map deselects; the footprint is read-only.
  const onMapClick = useCallback(
    (info, event) => {
      // Taps on MapLibre's own controls (zoom, attribution) bubble through
      // deck's container too — they aren't map clicks.
      if (event?.srcEvent?.target?.closest?.(".maplibregl-ctrl")) return;
      if (info.layer?.id === "fleet" && info.object) select(info.object.hotspot.entityKey);
      else if (!info.object) select(null);
    },
    [select],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-xl bg-surface-inset">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs, interactionState: i }) => {
          // A pan or zoom uses up the selection's one positions ease (deck's
          // own eased transitions report `inTransition` instead).
          if (i?.isDragging || i?.isPanning || i?.isZooming || i?.isRotating) {
            easedPositionsRef.current = selectedRef.current;
          }
          setViewState(vs);
        }}
        layers={allLayers}
        controller={true}
        getTooltip={getTooltip}
        onClick={onMapClick}
        onHover={(info) => {
          hoverDotRef.current = info.layer?.id === "fleet" && Boolean(info.object);
        }}
        // Pointer only over dots — the footprint is hoverable, not clickable.
        getCursor={({ isDragging }) => (isDragging ? "grabbing" : hoverDotRef.current ? "pointer" : "grab")}
      >
        <MapGL mapStyle={dark ? BASEMAP_DARK : BASEMAP_LIGHT}>
          <NavigationControl position="top-right" showCompass={false} />
        </MapGL>
      </DeckGL>

      {hotspots.length > 0 && mappable.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-lg bg-surface-raised/90 px-3 py-2 text-xs text-content-tertiary shadow-soft backdrop-blur">
            None of this wallet&apos;s Hotspots have an asserted location.
          </span>
        </div>
      )}

      {/* Legend (top) and the selected Hotspot's panel (bottom) share one
          column, so a tall panel scrolls in the space below the legend
          instead of covering it. The column passes pointer events through to
          the map; only the panel takes them. */}
      <div className="pointer-events-none absolute inset-3 flex flex-col justify-between gap-3">
        {/* Legend */}
        <div className="flex shrink-0 flex-col gap-1 self-start rounded-lg bg-surface-raised/90 px-3 py-2 text-xs shadow-soft backdrop-blur">
          <LegendRow color={`rgb(${IOT_COLOR.join(",")})`} label="IoT" />
          <LegendRow color={`rgb(${MOBILE_COLOR.join(",")})`} label="Mobile" />
          {legend.inactive && <LegendRow color={`rgb(${INACTIVE_COLOR.join(",")})`} label="Inactive (IoT)" />}
          {legend.idle && <LegendRow color={`rgb(${IDLE_COLOR.join(",")})`} label="Never rewarded" />}
          {(legend.sizeKey || legend.hollow) && (
            <div className="mt-0.5 flex flex-col gap-1 border-t border-border pt-1.5">
              {legend.sizeKey && (
                <>
                  <span className="text-content-tertiary">IoT messages (30d)</span>
                  <span className="flex items-center gap-2 text-content-secondary">
                    {SIZE_KEY.map(({ radius, label }) => (
                      <span key={label} className="flex items-center gap-1">
                        <span
                          className="shrink-0 rounded-full bg-content-secondary"
                          style={{ width: radius * 2, height: radius * 2 }}
                        />
                        {label}
                      </span>
                    ))}
                  </span>
                </>
              )}
              {legend.hollow && (
                <span className="flex items-center gap-1.5 text-content-secondary">
                  <span className="h-2 w-2 rounded-full border-[1.5px] border-content-secondary" />
                  Traffic unknown
                </span>
              )}
            </div>
          )}
          {heartbeatOverlay && (
            <div className="mt-0.5 flex flex-col gap-1 border-t border-border pt-1.5 text-content-secondary">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm border-[1.5px]"
                  style={{
                    borderColor: `rgb(${overlayColor.join(",")})`,
                    background: `rgba(${overlayColor.join(",")}, 0.16)`,
                  }}
                />
                Asserted cell
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full border-2 bg-surface-raised"
                  style={{ borderColor: `rgb(${overlayColor.join(",")})` }}
                />
                Reported positions ({hbWindow.short})
              </span>
            </div>
          )}
          {footprintDrawn && (
            <span className="mt-0.5 flex items-center gap-1.5 border-t border-border pt-1.5 text-content-secondary">
              <span className="h-2 w-5 shrink-0 rounded-sm" style={{ background: rampCss }} />
              Modeled coverage {fmtDb(COVERAGE_RSSI_MIN)} → {fmtDbm(COVERAGE_RSSI_MAX)}
            </span>
          )}
        </div>

        {selectedHotspot && (
          <FleetMapDetail
            hotspot={selectedHotspot}
            rewards={rewardsByKey[selectedHotspot.entityKey]}
            row={selectedRow}
            mobileRow={selectedMobileRow}
            mobileDays={mobileDays}
            coverage={coverageProps}
            onClose={deselect}
          />
        )}
      </div>
    </div>
  );
}

function LegendRow({ color, label }) {
  return (
    <span className="flex items-center gap-1.5 text-content-secondary">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/**
 * The selected Hotspot's panel. Memoized with stable props (its IoT `row`
 * changes only on scan flushes, its `mobileRow` only on Mobile updates), so
 * the map's pan/zoom frames skip it and the traffic chart inside.
 */
const FleetMapDetail = memo(function FleetMapDetail({
  hotspot,
  rewards,
  row,
  mobileRow,
  mobileDays,
  coverage,
  onClose,
}) {
  const earning = isEarning(rewards);
  // Resolved verdicts only — "pending" (scan running) and null (non-IoT) have
  // no label and stay quiet.
  const status = row?.status;
  const showStatus = status in IOT_STATUS_LABEL;
  const statusDay = livenessDay(row?.anchor);
  return (
    <div
      data-map-panel
      className="pointer-events-auto min-h-0 w-full max-w-[360px] self-start overflow-auto overscroll-contain rounded-xl bg-surface-raised/95 p-3 text-sm shadow-soft-lg backdrop-blur"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-content">{hotspot.name || "Unnamed Hotspot"}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-content-tertiary">
            <span>{deviceLabel(hotspot.deviceType)}</span>
            {showStatus && (
              <span className="inline-flex items-center gap-1">
                <Dot color={IOT_STATUS_COLOR[status]} />
                {IOT_STATUS_LABEL[status]}
                {statusDay ? ` on ${fmtDataDay(statusDay)}` : ""}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-content-tertiary hover:text-content-secondary"
          aria-label="Close"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {(hotspot.city || hotspot.state) && (
        <div className="mt-1.5 text-xs text-content-secondary">
          {[hotspot.city, hotspot.state, hotspot.country].filter(Boolean).join(", ")}
        </div>
      )}

      {rewards && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {earning === false ? (
            <span className="text-content-tertiary">No lifetime rewards</span>
          ) : (
            ["hnt", "iot", "mobile"].map((t) => {
              const ui = lifetimeUi(rewards, t);
              if (!ui) return null;
              return (
                <span key={t} className="text-content-secondary">
                  {fmtToken(ui, { max: 2 })}{" "}
                  <span className="text-content-tertiary">{t.toUpperCase()} lifetime</span>
                </span>
              );
            })
          )}
        </div>
      )}

      {row && (
        <div className="mt-3">
          <IotTrafficDetail entityKey={hotspot.entityKey} traffic={row.traffic} compact />
        </div>
      )}

      {coverage && <CoverageSection hotspot={hotspot} {...coverage} />}

      {mobileRow && <MobileSection row={mobileRow} days={mobileDays} />}

      <div className="mt-3 flex items-center gap-2 text-xs text-content-tertiary">
        <span className="truncate font-mono">{hotspot.entityKey}</span>
        <CopyButton text={hotspot.entityKey} />
        {hotspot.assetId && (
          <a
            href={accountUrl(hotspot.assetId)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 text-accent-text hover:underline"
          >
            Explorer
          </a>
        )}
      </div>
    </div>
  );
});

/** "…" while a value's table loads. */
const LOADING = <span className="text-content-tertiary">…</span>;

function DetailRow({ label, children }) {
  return (
    <>
      {/* Wraps only past a frozen window's longer label. */}
      <dt className="max-w-[9.5rem] text-content-tertiary">{label}</dt>
      <dd className="min-w-0 text-content-secondary">{children}</dd>
    </>
  );
}

const CURRENT_WINDOWS = {
  heartbeats: HEARTBEAT_WINDOW_DEFAULT,
  invalidHeartbeats: windowText("invalidHeartbeats", null),
  speedtests: windowText("speedtests", null),
};

/**
 * The selected Mobile Hotspot's network data: the latest UTC day's HNT and the
 * data it was rewarded for, the usage day's users served, then (WiFi
 * Hotspots) its last heartbeat and location in the 60-min window and its
 * speedtest average (24 h), and any ban. Windows are named as the card names
 * them (frozen ones by their end); a table whose check failed with nothing to
 * show reads "Couldn't load", never a perpetual "…".
 */
function MobileSection({ row, days }) {
  const day = (d) => (d ? ` ${fmtDataDay(d)} (UTC)` : "");
  const loaded = days.loaded || {};
  const failed = days.failed || {};
  const { heartbeats: hb, invalidHeartbeats: inv, speedtests: st } = days.windows || CURRENT_WINDOWS;
  const pending = (table) =>
    failed[table] ? <span className="text-content-tertiary">Couldn&apos;t load</span> : LOADING;
  const speed = row.speedtest;
  const rejectedTop = row.rejectedReasons
    ? Object.entries(row.rejectedReasons).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">Mobile</div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs tabular-nums">
        <DetailRow label={`Earned${day(days.rewards)}`}>
          {row.hntLatestDay == null ? (
            pending("rewards")
          ) : (
            <>
              <span className="font-medium text-content">{fmtToken(row.hntLatestDay, { max: 4 })} HNT</span>
              {/* The rewards table's own bytes: what the HNT was paid for. */}
              {row.bytesLatestDay > 0 && ` · ${fmtBytes(row.bytesLatestDay)} rewarded`}
            </>
          )}
        </DetailRow>
        <DetailRow label={`Users${day(days.usage)}`}>
          {row.usageReported == null ? (
            pending("usage")
          ) : row.users == null ? (
            <span className="text-content-tertiary">Not reported</span>
          ) : (
            fmtCount(row.users)
          )}
        </DetailRow>
        {row.wifi && (
          <>
            <DetailRow label="Last heartbeat">
              {row.heartbeating == null ? (
                pending("heartbeats")
              ) : row.heartbeating ? (
                <>
                  <TimeAgo at={row.lastHeartbeatAt} /> · {plural(row.heartbeats, "heartbeat")} {hb.long}
                </>
              ) : (
                <span className={MOBILE_ISSUES.noHeartbeat.textClass}>None {hb.long}</span>
              )}
            </DetailRow>
            {row.heartbeating && (
              <DetailRow label="Location">
                <span className={row.trust != null && row.trust < 1 ? MOBILE_ISSUES.lowTrust.textClass : ""}>
                  Trust {fmtMultiplier(row.trust)}
                </span>
                {row.distance != null && ` · ${fmtMeters(row.distance)} from asserted`}
                {row.locationSource && ` · ${LOCATION_SOURCE_LABEL[row.locationSource] || row.locationSource}`}
              </DetailRow>
            )}
            <DetailRow label={`Speedtest (${st.short})`}>
              {!loaded.speedtests ? (
                pending("speedtests")
              ) : !speed ? (
                <span className="text-content-tertiary">None {st.long}</span>
              ) : (
                <>
                  {fmtMbps(speed.down)} down, {fmtMbps(speed.up)} up · {Math.round(speed.latency)} ms ·{" "}
                  <span className={speed.multiplier < 1 ? MOBILE_ISSUES.lowSpeedtest.textClass : ""}>
                    ×{fmtMultiplier(speed.multiplier)}
                  </span>
                </>
              )}
            </DetailRow>
            {row.rejectedHeartbeats > 0 && (
              <DetailRow label={`Rejected (${inv.short})`}>
                <span className={MOBILE_ISSUES.rejectedHeartbeats.textClass}>
                  {fmtCount(row.rejectedHeartbeats)}
                  {rejectedTop && ` · ${fmtReason(rejectedTop)}`}
                </span>
              </DetailRow>
            )}
          </>
        )}
        {row.ban && (
          <DetailRow label="Ban">
            <span className={MOBILE_ISSUES.banned.textClass}>Banned</span>
            {row.ban.reason && row.ban.reason !== "ban_reason_unknown" && ` · ${fmtReason(row.ban.reason)}`}
            {row.ban.at ? ` · ${fmtDate(row.ban.at)}` : ""}
            {row.ban.message && <span className="mt-0.5 line-clamp-2 block text-content-tertiary">{row.ban.message}</span>}
          </DetailRow>
        )}
      </dl>
    </div>
  );
}

/** Opt-in modeled-coverage toggle for the selected (active) Hotspot, with the
 * footprint's caveats while it's shown. */
function CoverageSection({ hotspot, shown, onToggle, state, retry, footprint, rampCss }) {
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={shown}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
          shown
            ? "border-accent/40 bg-accent-surface text-accent-text"
            : "border-border text-content-secondary hover:border-content-tertiary"
        }`}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: rampCss }} />
        {/* Fixed label: aria-pressed carries the on/off state. */}
        Modeled coverage
      </button>
      {shown && <CoverageNotes hotspot={hotspot} state={state} retry={retry} footprint={footprint} />}
    </div>
  );
}

function CoverageNotes({ hotspot, state, retry, footprint }) {
  if (state === "error") {
    return (
      <p className="mt-2 text-xs text-content-tertiary">
        Couldn&apos;t load modeled coverage.{" "}
        <button type="button" onClick={retry} className="font-medium text-accent-text hover:underline">
          Retry
        </button>
      </p>
    );
  }
  if (state !== "ok" && state !== "notFound") {
    return <p className="mt-2 text-xs text-content-tertiary">Loading modeled coverage…</p>;
  }
  if (state === "notFound" || footprint.modeled === 0) {
    return (
      <p className="mt-2 text-xs text-content-tertiary">
        Not modeled yet. Coverage is modeled nightly for active Hotspots with an asserted location.
      </p>
    );
  }
  // The model clamps the asserted inputs (gain 1–15 dBi, default 1.2;
  // elevation 0–50 m with a 1.5 m floor) — say so where it changed one.
  const modeled = modeledCoverageInputs(hotspot.gain, hotspot.elevation);
  const elevation = Number.isFinite(hotspot.elevation) ? hotspot.elevation : null;
  return (
    <div className="mt-2 space-y-1.5 text-xs">
      <p className="text-content-secondary">
        Modeled reach from the asserted location, gain and elevation — a model, not a measurement.
      </p>
      <p className="text-content-tertiary">
        Currently asserted: gain {fmtGainDbi(hotspot.gain)}
        {modeled.gainAdjusted && ` (modeled at ${fmtGainDbi(modeled.gain)})`} · elevation{" "}
        {fmtElevationM(hotspot.elevation)}
        {modeled.elevationAdjusted && ` (modeled at ${fmtElevationM(modeled.elevation)})`}
      </p>
      {(elevation === null || elevation === 0) && (
        <p className="text-content-secondary">
          0 m is the on-chain default; the model may understate this Hotspot&apos;s reach.
        </p>
      )}
      {elevation > 0 && elevation <= 2 && (
        <p className="text-content-secondary">
          Low asserted elevation; the model may understate this Hotspot&apos;s reach.
        </p>
      )}
      {footprint.fromPreviousAssertion && (
        <p className="text-content-secondary">
          Footprint from a previous assertion — coverage is rebuilt nightly.
        </p>
      )}
      {footprint.onlyOwnCell && (
        <p className="text-content-secondary">
          Only this Hotspot&apos;s own cell is modeled above {fmtDbm(COVERAGE_RSSI_MIN)}.
        </p>
      )}
      {footprint.drawn.length === 0 && (
        <p className="text-content-secondary">No modeled cells reach {fmtDbm(COVERAGE_RSSI_MIN)}.</p>
      )}
      {footprint.drawn.length > 0 && (
        <p className="text-[11px] text-content-tertiary">
          Modeled coverage © Helium. Terrain © Tilezen{" "}
          <a
            href={TERRAIN_TILES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-text hover:underline"
          >
            Terrain Tiles
          </a>{" "}
          (NASA SRTM, USGS 3DEP, GEBCO)
        </p>
      )}
    </div>
  );
}
