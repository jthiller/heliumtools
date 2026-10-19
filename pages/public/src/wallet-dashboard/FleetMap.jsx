import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { WebMercatorViewport } from "@deck.gl/core";
import { IconLayer, LineLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";
import useDarkMode from "../lib/useDarkMode.js";
import useReducedMotion, { prefersReducedMotion } from "../lib/useReducedMotion.js";
import { ATTRIBUTION, basemapStyle, overlayColors } from "./map/basemap.js";
import { SELECTED_ICON, SELECTED_SIZE, buildMarkerAtlas } from "./map/markerIcons.js";
import {
  DIM_ALPHA,
  QUIET_ALPHA,
  coverageColor,
  dotLines,
  dotOf,
  dotRank,
  drawnOf,
  drawnSig,
  fmtDbm,
  mergeDrawn,
  positionText,
} from "./map/mapEncoding.js";
import { boundsOf, fitPadding, fitView, markerTarget, queryClusters, useSiteClusters } from "./map/useSiteClusters.js";
import SiteMarkers from "./map/SiteMarkers.jsx";
import MapControls from "./map/MapControls.jsx";
import Loupe from "./map/Loupe.jsx";
import { plural } from "./format.js";

// Camera eases, instant under reduced motion (read when the ease starts).
const EASE_MS = 800;
const STEP_MS = 300;
const easeMs = (ms = EASE_MS) => (prefersReducedMotion() ? 0 : ms);
const easeOut = (t) => 1 - (1 - t) ** 3;
// Selecting a Hotspot shows its site up close; a fleet fit stops short of street level.
const CLOSE_UP_ZOOM = 18;
const FIT_MAX_ZOOM = 15;
const ONE_ZOOM = 13;
// Reported positions farther than this from the asserted cell's centre get a line.
const FAR_M = 25;
// Arrival pulse: two rings per new position, the second trailing.
const PULSE_RING_MS = 900;
const PULSE_STAGGER_MS = 350;
const PULSE_MS = PULSE_RING_MS + PULSE_STAGGER_MS;
// Until the box is measured: the desktop map's size.
const ASSUMED = { width: 1200, height: 520 };
// The markers are recomputed this long after the view stops moving.
const SETTLE_MS = 160;

// deck.gl's tooltip is a plain div inside the map; theme tokens are CSS
// variables, so it follows light and dark like the page.
const TOOLTIP_STYLE = {
  backgroundColor: "rgb(var(--color-surface-raised))",
  color: "rgb(var(--wd-ink-2))",
  fontSize: "12px",
  lineHeight: "16px",
  padding: "6px 9px",
  borderRadius: "8px",
  boxShadow: "var(--shadow-card-lg)",
  maxWidth: "240px",
  marginLeft: "12px",
  marginTop: "12px",
};
const TIER_COLOR = { serious: "rgb(var(--wd-critical-text))", check: "rgb(var(--wd-caution-text))" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const line = (text, style = "") => `<span style="display:block;${style}">${esc(text)}</span>`;

const snapshot = (vs) => ({ longitude: vs.longitude, latitude: vs.latitude, zoom: vs.zoom, pitch: 0, bearing: 0 });
// Unmounting the map (the phone dialog closing, a wallet switch) or a theme
// switch aborts its tile requests; that isn't an error worth logging.
const onMapError = (e) => {
  if (e?.error?.name !== "AbortError") console.error(e?.error ?? e);
};

/**
 * Lets an unmounted map's canvas be collected. luma.gl 9.2 (under deck.gl
 * 9.2) never stops a canvas context's ResizeObserver, IntersectionObserver
 * or its device-pixel-ratio media-query listener, and deck never destroys
 * the context (the device is shared per canvas). The media query holds its
 * listener for the page's lifetime, and the listener holds the context, so
 * every closed map kept its canvas, deck's DOM and the basemap's MapLibre
 * map. Do what luma 9.4's destroy does: stop the observers, turn the
 * pending listener into a no-op and drop what it would keep. Private
 * fields, so every step is optional: a luma that cleans up after itself
 * makes this a no-op.
 */
function releaseCanvasContext(cc) {
  if (!cc) return;
  cc._resizeObserver?.disconnect?.();
  cc._intersectionObserver?.disconnect?.();
  cc.destroy?.();
  cc._observeDevicePixelRatio = () => {};
  cc.props = {};
  cc.canvas = null;
  cc.htmlCanvas = null;
  cc.offscreenCanvas = null;
  cc.device = null;
}

/**
 * The interactive fleet map: deck.gl over a MapLibre basemap (Carto Positron
 * or Dark Matter by color scheme). Sites are HTML markers (SiteMarkers),
 * single Hotspots canvas dots (an IconLayer of prebuilt sprites), the
 * selected Hotspot's overlay (asserted cell, reported positions, lines to
 * far ones, the arrival pulse) and its modeled coverage footprint below
 * them; + / − / Fit controls, the basemap credit, the unasserted link and,
 * at fleet zoom, the loupe. The camera fits the fleet once per wallet (or the
 * filter's matches, once per filter change, never fighting a pan), flies to
 * a selection's site close-up once per request (`flySeq`), eases reported
 * positions into view once per selection, and frames a freshly loaded
 * footprint. Reduced motion makes every move instant.
 *
 * Kept for the landing capture: the canvas is `canvas#deckgl-overlay` with a
 * controlled `viewState` prop, and dev builds expose
 * `window.__wdMap = { getView(), setView({ longitude, latitude, zoom }, { duration }) }`.
 *
 * memo: a pan re-renders this component and DeckGL only; markers, controls
 * and the loupe are memoized children with stable props, and layers are
 * memoized on their data, not on the view.
 */
export default memo(function FleetMap({
  wallet,
  list,
  places,
  filter,
  filterId,
  mode,
  selKey,
  flySeq,
  onSelect,
  overlay,
  footprint,
  coverageShown,
  arrivals,
  heartbeatsLive,
  hbWindow,
  panelRef,
  panelPlacement = "float",
  fitInsets,
  loupeAllowed = false,
  onDrawn,
  onCloseUp,
  onUnasserted,
  unassertedHref,
}) {
  const dark = useDarkMode();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef(null);
  const [size, setSize] = useState(null);
  const sizeRef = useRef(ASSUMED);
  const filtered = Boolean(filter?.narrowed);

  const pointsByKey = useMemo(() => new Map((places?.points || []).map((p) => [p.key, p])), [places]);
  const matchBounds = useMemo(
    () => (filtered ? boundsOf((places?.points || []).filter((p) => filter.keys.has(p.key))) : null),
    [filtered, filter, places],
  );
  const fleetBounds = useMemo(() => boundsOf(places?.points || []), [places]);
  const fitTarget = useCallback(() => {
    const bounds = matchBounds ?? fleetBounds;
    const one = bounds && bounds[0] === bounds[2] && bounds[1] === bounds[3];
    return bounds ? { bounds, maxZoom: one ? ONE_ZOOM : FIT_MAX_ZOOM } : null;
  }, [matchBounds, fleetBounds]);

  // ── The view ──
  const [viewState, setViewState] = useState(() => {
    const t = fitTarget();
    const start = { longitude: -98.5, latitude: 39.8, zoom: 3.2, pitch: 0, bearing: 0 };
    return t ? { ...start, ...fitView(start, ASSUMED, t.bounds, { padding: { top: 60, right: 60, bottom: 60, left: 60 }, maxZoom: t.maxZoom }) } : start;
  });
  const viewRef = useRef(viewState);
  // The view the markers were computed at: a whole-zoom step or a settled view.
  const [settled, setSettled] = useState(() => snapshot(viewState));
  const settledRef = useRef(settled);
  settledRef.current = settled;
  const settleTimer = useRef(0);
  const markersApi = useRef(null);
  const interactingRef = useRef(false);
  const closeUpRef = useRef(false);
  const selKeyRef = useRef(selKey);
  selKeyRef.current = selKey;
  const easedPositionsRef = useRef(null);

  const setCloseUp = useCallback(
    (v) => {
      if (closeUpRef.current === v) return;
      closeUpRef.current = v;
      onCloseUp?.(v);
    },
    [onCloseUp],
  );

  // True while the camera still shows an automatic fleet (or filter) fit:
  // only then does a resized box refit.
  const autoFitRef = useRef(false);
  // Where the camera is headed: the end of our own move (an eased one is
  // still on its way), else the view. The camera rules that look at "what's
  // in view" read this, so a selection's ease isn't judged against the
  // fleet view its fly is leaving.
  const targetRef = useRef(null);

  // A camera move of our own (fit, fly, ease, buttons).
  const moveTo = useCallback((target, duration = 0) => {
    autoFitRef.current = false;
    const next = { ...snapshot(targetRef.current ?? viewRef.current), ...target, transitionDuration: duration, transitionEasing: easeOut };
    targetRef.current = snapshot(next);
    if (!duration) {
      viewRef.current = next;
      setSettled(snapshot(next));
    }
    setViewState(next);
    if (!duration) markersApi.current?.update();
  }, []);

  const onViewStateChange = useCallback(
    ({ viewState: vs, interactionState: i }) => {
      const user = Boolean(i?.isDragging || i?.isPanning || i?.isZooming || i?.isRotating);
      interactingRef.current = user;
      if (user) {
        // A pan or zoom uses up the selection's one positions ease and ends the close-up.
        autoFitRef.current = false;
        targetRef.current = null;
        easedPositionsRef.current = selKeyRef.current;
        setCloseUp(false);
      }
      viewRef.current = vs;
      setViewState(vs);
      markersApi.current?.update();
      if (Math.floor(vs.zoom) !== Math.floor(settledRef.current.zoom)) setSettled(snapshot(vs));
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => setSettled(snapshot(viewRef.current)), SETTLE_MS);
    },
    [setCloseUp],
  );
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  // The box's size (the camera math and the markers' projection need it).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const next = { width: Math.round(r.width), height: Math.round(r.height) };
      sizeRef.current = next;
      setSize((s) => (s && s.width === next.width && s.height === next.height ? s : next));
      markersApi.current?.update();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The box as laid out now (a panel that just opened may have resized it).
  const measure = useCallback(() => {
    const r = containerRef.current?.getBoundingClientRect();
    if (r?.width && r?.height) sizeRef.current = { width: Math.round(r.width), height: Math.round(r.height) };
    return sizeRef.current;
  }, []);

  // Padding that keeps a target clear of the selected Hotspot's panel: beside
  // it on a wide map, above it on a narrow one.
  const panelPadding = useCallback(
    (base) => {
      const pad = { top: base, right: base, bottom: base, left: base };
      const box = containerRef.current?.getBoundingClientRect();
      const panel = panelPlacement === "float" ? panelRef?.current?.getBoundingClientRect() : null;
      if (box && panel?.width) {
        if (panel.width < box.width * 0.6) pad.right = Math.max(base, Math.round(box.right - panel.left + 16));
        else pad.bottom = Math.max(base, Math.round(box.bottom - panel.top + 16));
      }
      return pad;
    },
    [panelRef, panelPlacement],
  );

  // A fleet fit keeps markers and their labels clear of the edges, the
  // controls and a floating legend (`fitInsets.left`).
  const fitLeft = fitInsets?.left ?? 0;
  const fitAll = useCallback(
    (duration) => {
      const t = fitTarget();
      if (!t) return;
      const s = measure();
      const base = Math.round(Math.min(80, s.width / 6, s.height / 6));
      const padding = { top: base, right: base + 40, bottom: base, left: base + fitLeft };
      moveTo(fitView(viewRef.current, s, t.bounds, { padding, maxZoom: t.maxZoom }), duration);
      autoFitRef.current = true;
      setCloseUp(false);
    },
    [fitTarget, fitLeft, measure, moveTo, setCloseUp],
  );

  const flyToSelection = useCallback(
    (key, duration) => {
      const p = pointsByKey.get(key);
      if (!p) return;
      const site = places?.siteByKey?.get(key);
      const bounds = site && site.count > 1 ? site.bbox : [p.lng, p.lat, p.lng, p.lat];
      const s = measure();
      const base = Math.round(Math.min(60, s.width / 6, s.height / 6));
      moveTo(fitView(viewRef.current, s, bounds, { padding: panelPadding(base), maxZoom: CLOSE_UP_ZOOM }), duration);
      setCloseUp(true);
    },
    [pointsByKey, places, measure, moveTo, panelPadding, setCloseUp],
  );

  // Fit once per wallet (keyed on wallet and size, so a wallet with the same
  // count still re-centres), to the filter's matches when one is set, or fly
  // to a selection already requested.
  const fittedRef = useRef(null);
  const flownRef = useRef(0);
  // `filterId` names the applied filter (the host reads it from the URL); the
  // label is only a fallback, since a window freezing renames it.
  const filterKey = filtered ? filterId || filter.label || "filtered" : "";
  const filterKeyRef = useRef(filterKey);
  useEffect(() => {
    if (!size) return;
    const key = `${wallet}:${places?.points?.length ?? 0}`;
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    filterKeyRef.current = filterKey;
    if (flySeq && selKey && pointsByKey.has(selKey)) {
      flownRef.current = flySeq;
      flyToSelection(selKey, 0);
    } else fitAll(0);
  }, [size, wallet, places, filterKey, flySeq, selKey, pointsByKey, flyToSelection, fitAll]);

  // A resized box (a window resize, a rotated phone) refits while the camera
  // still shows the automatic fit; a view the user or a selection chose stays.
  const sizeKey = size ? `${size.width}x${size.height}` : "";
  const lastSizeRef = useRef("");
  useEffect(() => {
    if (!sizeKey) return;
    const prev = lastSizeRef.current;
    lastSizeRef.current = sizeKey;
    if (prev && prev !== sizeKey && autoFitRef.current) fitAll(0);
  }, [sizeKey, fitAll]);

  // A filter change fits its matches once (or the fleet when cleared).
  useEffect(() => {
    if (!size || filterKeyRef.current === filterKey) return;
    filterKeyRef.current = filterKey;
    if (interactingRef.current) return;
    fitAll(easeMs());
  }, [filterKey, size, fitAll]);

  // A selection request flies to its site close-up, once per request.
  useEffect(() => {
    if (!size || !flySeq || flownRef.current === flySeq) return;
    flownRef.current = flySeq;
    if (selKey) flyToSelection(selKey, easeMs());
  }, [flySeq, selKey, size, flyToSelection]);
  useEffect(() => {
    if (!selKey) setCloseUp(false);
  }, [selKey, setCloseUp]);

  // Bring reported positions into view, only when some are more than FAR_M
  // from the asserted cell and aren't already visibly apart on screen.
  // Decided once per selection, as soon as its live heartbeats are in (never
  // on the saved paint); a pan or zoom first uses the decision up.
  const selectedWifi = Boolean(overlay && list?.byKey?.get(selKey)?.wifi);
  useEffect(() => {
    if (!selKey) {
      easedPositionsRef.current = null;
      return;
    }
    if (easedPositionsRef.current === selKey || !heartbeatsLive || !selectedWifi || !size) return;
    easedPositionsRef.current = selKey;
    const far = (overlay?.groups || []).filter((g) => g.distanceM > FAR_M);
    if (!far.length || !overlay.cell) return;
    const s = measure();
    const spots = [overlay.cell.center, ...far];
    const bounds = boundsOf(spots);
    const base = Math.round(Math.min(80, s.width / 4, s.height / 4));
    const padding = fitPadding(panelPadding(base), s);
    // Judged where the camera is headed (the selection's fly may still be on its way).
    const vp = new WebMercatorViewport({ ...snapshot(targetRef.current ?? viewRef.current), width: s.width, height: s.height });
    const px = spots.map((p) => vp.project([p.lng, p.lat]));
    const inside = px.every(([x, y]) => x >= padding.left && x <= s.width - padding.right && y >= padding.top && y <= s.height - padding.bottom);
    const xs = px.map((p) => p[0]);
    const ys = px.map((p) => p[1]);
    const apart = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) >= 40;
    if (inside && apart) return;
    moveTo(fitView(viewRef.current, s, bounds, { padding, maxZoom: CLOSE_UP_ZOOM }), easeMs());
  }, [selKey, overlay, heartbeatsLive, selectedWifi, size, measure, panelPadding, moveTo]);

  // A freshly loaded footprint is framed once (it's kilometres across, far
  // larger than a close-up), unless it's already in view.
  const framedRef = useRef(null);
  useEffect(() => {
    if (!coverageShown || !footprint?.bounds || framedRef.current === footprint || !size) return;
    framedRef.current = footprint;
    const s = measure();
    const base = Math.round(Math.min(48, s.width / 6, s.height / 6));
    const padding = fitPadding(panelPadding(base), s);
    const [w, so, e, n] = footprint.bounds;
    const vp = new WebMercatorViewport({ ...snapshot(targetRef.current ?? viewRef.current), width: s.width, height: s.height });
    const [[x0, y0], [x1, y1]] = [vp.project([w, n]), vp.project([e, so])];
    const inside = x0 >= padding.left && x1 <= s.width - padding.right && y0 >= padding.top && y1 <= s.height - padding.bottom;
    const big = Math.max(x1 - x0, y1 - y0) > 48;
    if (inside && big) return;
    moveTo(fitView(viewRef.current, s, footprint.bounds, { padding, maxZoom: 15 }), easeMs());
    setCloseUp(false);
  }, [coverageShown, footprint, size, measure, panelPadding, moveTo, setCloseUp]);

  // ── Sites and dots ──
  const clusters = useSiteClusters({ places, list, filter, radius: 56 });
  const query = useMemo(() => queryClusters(clusters, settled, size ?? ASSUMED), [clusters, settled, size]);
  const dots = useMemo(() => {
    const out = [];
    for (const k of query.singleKeys) {
      const row = list?.byKey?.get(k);
      const p = pointsByKey.get(k);
      if (!row || !p) continue;
      const dot = dotOf(row, mode);
      const dim = filtered && !filter.keys.has(k);
      out.push({
        key: k,
        row,
        dot,
        position: [p.lng, p.lat],
        alpha: Math.round(255 * (dim ? DIM_ALPHA : 1) * (dot.quiet ? QUIET_ALPHA : 1)),
        rank: dotRank(dot, k === selKey),
      });
    }
    return out.sort((a, b) => a.rank - b.rank);
  }, [query.singleKeys, list, pointsByKey, mode, filtered, filter, selKey]);
  const selDot = useMemo(() => dots.find((d) => d.key === selKey) ?? null, [dots, selKey]);
  const selectedSiteIds = useMemo(() => {
    const site = selKey ? places?.siteByKey?.get(selKey) : null;
    return site ? new Set([site.id]) : null;
  }, [selKey, places]);
  const selectedLabel = useMemo(
    () => (selDot ? { lng: selDot.position[0], lat: selDot.position[1], name: selDot.row.name || "Unnamed Hotspot" } : null),
    [selDot],
  );

  const loupeSite = loupeAllowed && !selKey && (list?.counts?.total ?? 0) <= 200 ? query.loupeSite : null;
  const loupeDots = useMemo(
    () =>
      loupeSite
        ? loupeSite.keys
            .map((k) => list?.byKey?.get(k))
            .filter(Boolean)
            .map((row) => ({ row, dot: dotOf(row, mode) }))
        : null,
    [loupeSite, list, mode],
  );

  // What's in view at the settled view (markers are also kept a little
  // beyond the edges, and singles far off screen are drawn too).
  const seen = useMemo(() => {
    const s = size ?? ASSUMED;
    const vp = new WebMercatorViewport({ ...settled, width: s.width, height: s.height });
    return (lng, lat) => {
      const [x, y] = vp.project([lng, lat]);
      return x >= -12 && y >= -12 && x <= s.width + 12 && y <= s.height + 12;
    };
  }, [settled, size]);
  const markersInView = useMemo(() => query.markers.filter((m) => seen(m.lng, m.lat)), [query.markers, seen]);
  // What's drawn, for the legend: the map's dots and markers in view plus the loupe's.
  // "Selected Hotspot" explains the ink ring on the selected dot, or on the
  // marker that holds it at a zoomed-out view (a footprint's frame).
  const drawn = useMemo(() => {
    const inView = dots.filter((d) => seen(d.position[0], d.position[1]));
    const selMarker = Boolean(selectedSiteIds) && markersInView.some((m) => m.siteIds.some((id) => selectedSiteIds.has(id)));
    return {
      ...mergeDrawn(drawnOf({ dots: inView, markers: markersInView, mode }), loupeDots ? drawnOf({ dots: loupeDots, mode }) : null),
      selected: (Boolean(selDot) && seen(selDot.position[0], selDot.position[1])) || selMarker,
    };
  }, [dots, markersInView, loupeDots, mode, selDot, selectedSiteIds, seen]);
  const sig = `${drawnSig(drawn)}|${drawn.selected}`;
  const drawnRef = useRef(drawn);
  drawnRef.current = drawn;
  useEffect(() => {
    onDrawn?.(drawnRef.current);
  }, [sig, onDrawn]);

  // ── Layers (memoized on their data, never on the view) ──
  const colors = useMemo(() => overlayColors(), [dark]); // eslint-disable-line react-hooks/exhaustive-deps
  const atlas = useMemo(() => buildMarkerAtlas(colors), [colors]);
  const selNet = selKey && list?.byKey?.get(selKey)?.nets?.iot ? "iot" : "mobile";

  const layers = useMemo(() => {
    const out = [];
    if (footprint?.drawn?.length && coverageShown) {
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
    if (overlay?.cell?.polygon) {
      const c = colors[selNet];
      out.push(
        new PolygonLayer({
          id: "asserted-cell",
          data: [overlay.cell.polygon],
          getPolygon: (d) => d,
          getFillColor: [...c, 41],
          getLineColor: [...c, 219],
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          filled: true,
          stroked: true,
          // Pickable so a click inside the cell keeps the selection.
          pickable: true,
        }),
      );
    }
    const farLines = (overlay?.farLines || []).filter((l) => l.distanceM > FAR_M);
    if (farLines.length) {
      out.push(
        new LineLayer({
          id: "position-lines",
          data: farLines,
          getSourcePosition: (l) => l.from,
          getTargetPosition: (l) => l.to,
          getColor: [...colors.mobile, 170],
          getWidth: 2,
          widthUnits: "pixels",
        }),
      );
    }
    out.push(
      new IconLayer({
        id: "dots",
        data: dots,
        iconAtlas: atlas.url,
        iconMapping: atlas.mapping,
        getIcon: (d) => d.dot.id,
        getPosition: (d) => d.position,
        getSize: (d) => atlas.size[d.dot.id] ?? 26,
        sizeUnits: "pixels",
        getColor: (d) => [255, 255, 255, d.alpha],
        alphaCutoff: 0.05,
        pickable: true,
        autoHighlight: true,
        highlightColor: [14, 116, 144, 70],
      }),
    );
    if (selDot) {
      out.push(
        new IconLayer({
          id: "selected",
          data: [selDot],
          iconAtlas: atlas.url,
          iconMapping: atlas.mapping,
          getIcon: () => SELECTED_ICON,
          getPosition: (d) => d.position,
          getSize: SELECTED_SIZE,
          sizeUnits: "pixels",
        }),
      );
    }
    if (overlay?.groups?.length) {
      out.push(
        new ScatterplotLayer({
          id: "positions",
          data: overlay.groups,
          getPosition: (g) => [g.lng, g.lat],
          getFillColor: colors.raised,
          getLineColor: colors.mobile,
          getRadius: 5,
          getLineWidth: 2,
          radiusUnits: "pixels",
          lineWidthUnits: "pixels",
          stroked: true,
          filled: true,
          pickable: true,
        }),
      );
    }
    return out;
  }, [footprint, coverageShown, overlay, colors, selNet, dots, atlas, selDot, dark]);

  // New reported positions for the selected Hotspot pulse once on a live
  // arrival (never on the first load, a reselection, or the window sliding).
  const [pulse, setPulse] = useState(null); // { key, points, start }
  const [pulseT, setPulseT] = useState(0);
  const positionsSeenRef = useRef({ key: null, seq: 0, lastAt: new Map() });
  useEffect(() => {
    const seen = positionsSeenRef.current;
    const groups = overlay?.groups ?? [];
    const seq = arrivals?.seq ?? 0;
    const at = (g) => `${g.lat},${g.lng}`;
    if (!reducedMotion && selKey && seen.key === selKey && seq > seen.seq && arrivals.byTable?.heartbeats?.includes(selKey)) {
      const fresh = groups.filter((g) => (seen.lastAt.get(at(g)) ?? 0) < g.at);
      if (fresh.length) {
        setPulseT(0);
        setPulse({ key: selKey, points: fresh, start: performance.now() });
      }
    }
    positionsSeenRef.current = { key: selKey, seq, lastAt: new Map(groups.map((g) => [at(g), g.at])) };
  }, [selKey, overlay, arrivals, reducedMotion]);
  useEffect(() => {
    if (!pulse) return undefined;
    const id = setInterval(() => {
      const t = performance.now() - pulse.start;
      if (t >= PULSE_MS) setPulse(null);
      else setPulseT(t);
    }, 33);
    return () => clearInterval(id);
  }, [pulse]);
  const pulseLayer = useMemo(() => {
    if (!pulse || pulse.key !== selKey) return null;
    const rings = [];
    for (const delay of [0, PULSE_STAGGER_MS]) {
      const t = (pulseT - delay) / PULSE_RING_MS;
      if (t <= 0 || t >= 1) continue;
      const eased = 1 - (1 - t) ** 2;
      for (const g of pulse.points) rings.push({ g, radius: 5 + 20 * eased, alpha: Math.round(200 * (1 - eased)) });
    }
    return new ScatterplotLayer({
      id: "position-pulse",
      data: rings,
      getPosition: (d) => [d.g.lng, d.g.lat],
      getRadius: (d) => d.radius,
      getLineColor: (d) => [...colors.mobile, d.alpha],
      getLineWidth: 2,
      radiusUnits: "pixels",
      lineWidthUnits: "pixels",
      stroked: true,
      filled: false,
    });
  }, [pulse, pulseT, selKey, colors]);
  const allLayers = useMemo(() => (pulseLayer ? [...layers, pulseLayer] : layers), [layers, pulseLayer]);

  // ── Pointer ──
  const hoverRef = useRef(false);
  const getTooltip = useCallback(
    ({ layer, object }) => {
      if (!object) return null;
      if (layer?.id === "dots") {
        const t = dotLines(object.row, list?.ctx);
        const html =
          `<b style="display:block;font-weight:600;color:rgb(var(--wd-ink))">${esc(t.name)}</b>` +
          line(t.device) +
          line(t.money) +
          line(t.status, TIER_COLOR[t.tier] ? `color:${TIER_COLOR[t.tier]}` : "") +
          t.more.map((m) => line(m)).join("");
        return { html, style: TOOLTIP_STYLE };
      }
      if (layer?.id === "positions") return { text: positionText(object, hbWindow), style: TOOLTIP_STYLE };
      if (layer?.id === "footprint") return { text: `${fmtDbm(object.rssi)} (modeled)`, style: TOOLTIP_STYLE };
      return null;
    },
    [list, hbWindow],
  );
  // A dot selects; bare map clears; the footprint, the cell and positions keep it.
  const onClick = useCallback(
    (info) => {
      if (info.layer?.id === "dots" && info.object) onSelect(info.object.key, { fly: true });
      else if (!info.object) onSelect(null);
    },
    [onSelect],
  );

  // ── Markers and controls ──
  const onZoomTo = useCallback(
    (marker) => {
      const s = measure();
      const { bounds, minZoom } = markerTarget(clusters, marker, viewRef.current.zoom);
      if (!Number.isFinite(bounds[0])) return;
      const base = Math.round(Math.min(80, s.width / 5, s.height / 5));
      const v = fitView(viewRef.current, s, bounds, { padding: panelPadding(base), maxZoom: CLOSE_UP_ZOOM, minZoom: Math.min(minZoom, CLOSE_UP_ZOOM) });
      moveTo(v, easeMs());
      setCloseUp(false);
    },
    [clusters, measure, panelPadding, moveTo, setCloseUp],
  );
  const zoomBy = useCallback(
    (d) => {
      // From where the camera is headed, so two quick presses zoom two steps.
      const at = targetRef.current ?? viewRef.current;
      moveTo({ zoom: Math.max(1, Math.min(20, at.zoom + d)) }, easeMs(STEP_MS));
      setCloseUp(false);
    },
    [moveTo, setCloseUp],
  );
  const onZoomIn = useCallback(() => zoomBy(1), [zoomBy]);
  const onZoomOut = useCallback(() => zoomBy(-1), [zoomBy]);
  const onFit = useCallback(() => fitAll(easeMs()), [fitAll]);
  const onWheel = useCallback((e) => {
    const canvas = containerRef.current?.querySelector("canvas#deckgl-overlay");
    canvas?.dispatchEvent(
      new WheelEvent("wheel", { clientX: e.clientX, clientY: e.clientY, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, bubbles: true, cancelable: true }),
    );
  }, []);

  // Deck doesn't release its WebGL context when it unmounts (the phone map
  // dialog closing, a wallet switch remounting the map): the detached canvas
  // keeps a live context, so contexts pile up until Chrome drops the oldest.
  // Once the canvas has left the page, lose its context and release luma's
  // hold on it (releaseCanvasContext). (Under StrictMode's dev remount the
  // canvas stays in the page, so it's kept.)
  const deviceRef = useRef(null);
  const onDeviceInitialized = useCallback((device) => {
    deviceRef.current = device;
  }, []);
  useEffect(() => {
    const canvas = containerRef.current?.querySelector("canvas#deckgl-overlay");
    return () => {
      if (!canvas) return;
      setTimeout(() => {
        if (canvas.isConnected) return;
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
        const cc = deviceRef.current?.canvasContext;
        if (cc && cc.canvas === canvas) releaseCanvasContext(cc);
        deviceRef.current = null;
      }, 0);
    };
  }, []);

  // Deck's own tab stop (its arrow-key pan) gets a name and a role, so it
  // isn't an unnamed stop; its focus ring comes from the container's classes.
  useEffect(() => {
    const el = containerRef.current?.querySelector("#deckgl-wrapper");
    if (!el) return;
    el.setAttribute("role", "application");
    el.setAttribute("aria-roledescription", "map");
    el.setAttribute("aria-label", "Map view. Arrow keys pan, plus and minus zoom.");
  }, []);
  // When the focused site marker leaves the map (Enter zoomed past it), focus
  // stays on the map: on this surface.
  const onMarkerFocusLost = useCallback(() => {
    containerRef.current?.querySelector("#deckgl-wrapper")?.focus({ preventScroll: true });
  }, []);
  // The basemap's canvas names itself a "Map" region; deck's surface above is the map here.
  const onBasemapLoad = useCallback((e) => {
    e.target.getCanvas()?.setAttribute("aria-hidden", "true");
  }, []);

  // Dev builds: the landing capture sets views without dragging across markers.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const api = {
      getView: () => ({ longitude: viewRef.current.longitude, latitude: viewRef.current.latitude, zoom: viewRef.current.zoom }),
      setView: (v, { duration = 0 } = {}) => moveTo({ longitude: v.longitude, latitude: v.latitude, zoom: v.zoom }, duration),
    };
    window.__wdMap = api;
    return () => {
      if (window.__wdMap === api) delete window.__wdMap;
    };
  }, [moveTo]);

  // Place labels on every marker while 4 or fewer are in view (else on hover and focus).
  const markersLabelAll = markersInView.length <= 4;
  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden [&_#deckgl-wrapper:focus-visible]:![outline-offset:-2px] [&_#deckgl-wrapper:focus-visible]:![outline:2px_solid_rgb(var(--color-accent-text))]"
    >
      <DeckGL
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        layers={allLayers}
        controller={true}
        getTooltip={getTooltip}
        onClick={onClick}
        pickingRadius={4}
        onHover={(info) => {
          hoverRef.current = info.layer?.id === "dots" && Boolean(info.object);
        }}
        getCursor={({ isDragging }) => (isDragging ? "grabbing" : hoverRef.current ? "pointer" : "grab")}
        onDeviceInitialized={onDeviceInitialized}
      >
        <MapGL
          mapStyle={basemapStyle(dark)}
          interactive={false}
          attributionControl={false}
          onLoad={onBasemapLoad}
          onError={onMapError}
        />
      </DeckGL>
      <SiteMarkers
        markers={query.markers}
        mode={mode}
        filtered={filtered}
        labelAll={markersLabelAll}
        loupeSiteId={loupeSite?.id ?? null}
        selectedKey={selKey}
        selectedSiteIds={selectedSiteIds}
        selectedLabel={selectedLabel}
        viewRef={viewRef}
        sizeRef={sizeRef}
        apiRef={markersApi}
        onZoomTo={onZoomTo}
        onWheel={onWheel}
        onFocusLost={onMarkerFocusLost}
      />
      <MapControls onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} fitLabel={filtered ? "Fit to matching Hotspots" : "Fit to fleet"} />
      {places?.unasserted > 0 && (
        <a
          href={unassertedHref}
          onClick={(e) => {
            if (!onUnasserted || e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            onUnasserted();
          }}
          className="absolute bottom-6 left-3.5 z-[7] rounded-lg px-2.5 py-1.5 text-wd-cap font-medium text-accent-text shadow-soft hover:underline max-md:min-h-11"
          style={{ background: "var(--wd-glass)" }}
        >
          {places.unasserted === 1 ? "1 Hotspot has no asserted location" : `${plural(places.unasserted, "Hotspot")} have no asserted location`}
        </a>
      )}
      {loupeSite && (
        <Loupe
          site={loupeSite}
          dots={loupeDots}
          ctx={list?.ctx}
          filtered={filtered}
          filterKeys={filter?.keys}
          stats={clusters.statsById.get(loupeSite.id)}
          pointsByKey={pointsByKey}
          dark={dark}
          onSelect={onSelect}
        />
      )}
      <span
        className="pointer-events-none absolute bottom-1 left-1.5 z-[7] rounded-[3px] px-1 text-[10px] font-medium leading-[14px] text-wd-ink-3"
        style={{ background: "var(--wd-glass)" }}
      >
        {ATTRIBUTION}
      </span>
    </div>
  );
});
