import { memo, useState, useMemo, useCallback, useEffect, useRef } from "react";
import MapGL, { NavigationControl } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer, PolygonLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";
import { cellToLatLng, cellToBoundary, cellToParent } from "h3-js";
import { XMarkIcon } from "@heroicons/react/24/outline";
import useDarkMode from "../lib/useDarkMode.js";
import CopyButton from "../components/CopyButton.jsx";
import { Dot } from "./cards/primitives.jsx";
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
} from "./format.js";

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

/** One-line hover summary for a fleet dot, from its IoT row (null if non-IoT). */
function dotTooltip(hotspot, row) {
  const name = hotspot.name || "Unnamed Hotspot";
  if (!row) return `${name} · ${deviceLabel(hotspot.deviceType)}`;
  if (row.status === "pending") return `${name} · Checking IoT status…`;
  const day = livenessDay(row.anchor);
  return [
    name,
    day ? `${IOT_STATUS_LABEL[row.status]} (${fmtDataDay(day)})` : IOT_STATUS_LABEL[row.status],
    row.messages != null ? `${plural(row.messages, "message")} (30d)` : "traffic unavailable",
  ].join(" · ");
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
  wallet = null,
}) {
  const dark = useDarkMode();
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  // The selected Hotspot (entityKey) and whether its modeled coverage is
  // shown — one state so a new selection always starts with coverage off.
  const [selection, setSelection] = useState({ key: null, coverage: false });
  const selected = selection.key;
  const fittedRef = useRef(null);
  const easedRef = useRef(null);
  const hoverDotRef = useRef(false);
  // Per-row IoT verdicts, derived once per scan flush by the shell.
  const iotRows = iotStatus?.rows;

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
      setViewState((p) => ({ ...p, latitude: minLat, longitude: minLng, zoom: 12, transitionDuration: 800 }));
    } else {
      const span = Math.max(maxLat - minLat, maxLng - minLng) || 0.1;
      const zoom = Math.max(1, Math.min(15, Math.log2(360 / (span * 1.6))));
      setViewState((p) => ({
        ...p,
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        zoom,
        transitionDuration: 800,
      }));
    }
  }, [mappable, wallet]);

  const selectedHotspot = useMemo(
    () => (selected ? mappable.find((h) => h.entityKey === selected) : null),
    [selected, mappable],
  );
  const selectedRow = selectedHotspot ? iotRows?.get(selectedHotspot.entityKey) ?? null : null;

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
        : { ...p, latitude: lat, longitude: lng, zoom: FOOTPRINT_ZOOM, transitionDuration: 800 },
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
    return out;
  }, [dots, selected, footprint, footprintDrawn, dark]);

  const getTooltip = useCallback(
    ({ layer, object }) => {
      if (!object) return null;
      if (layer?.id === "fleet") {
        const h = object.hotspot;
        return { text: dotTooltip(h, iotRows?.get(h.entityKey)), style: TOOLTIP_STYLE };
      }
      if (layer?.id === "footprint") return { text: `${fmtDbm(object.rssi)} (modeled)`, style: TOOLTIP_STYLE };
      return null;
    },
    [iotRows],
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
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-surface-inset">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs)}
        layers={layers}
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
 * changes only on scan flushes), so the map's pan/zoom frames skip it and the
 * traffic chart inside.
 */
const FleetMapDetail = memo(function FleetMapDetail({ hotspot, rewards, row, coverage, onClose }) {
  const earning = isEarning(rewards);
  // Resolved verdicts only — "pending" (scan running) and null (non-IoT) have
  // no label and stay quiet.
  const status = row?.status;
  const showStatus = status in IOT_STATUS_LABEL;
  const statusDay = livenessDay(row?.anchor);
  return (
    <div className="pointer-events-auto min-h-0 w-full max-w-[360px] self-start overflow-auto overscroll-contain rounded-xl bg-surface-raised/95 p-3 text-sm shadow-soft-lg backdrop-blur">
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
