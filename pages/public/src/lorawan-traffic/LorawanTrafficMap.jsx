// LoRaWAN Traffic Map (/lorawan-traffic): every IoT Hotspot that delivered
// LoRaWAN packets, colored by the network operator (OUI) that received them.
// Docs: ./CLAUDE.md.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import MapGL, { NavigationControl } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { WebMercatorViewport } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowLeftIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import useDarkMode from "../lib/useDarkMode.js";
import useMediaQuery from "../lib/useMediaQuery.js";
import { abortableDelay } from "../lib/abort.js";
import { numberFormatter } from "../lib/utils.js";
import { useWebMcpTools } from "../webmcp/useWebMcpTools.js";
import { makeLorawanTrafficTools } from "./webmcpTools.js";
import useTraffic from "./useTraffic.js";
import {
  PROP,
  boundsOf,
  clampRange,
  countShown,
  groupHits,
  hitsNear,
  inRange,
  radiusFor,
  readUrlState,
  writeUrlState,
} from "./data.js";
import {
  AboutData,
  LocationCard,
  LocationRows,
  MapTooltip,
  OperatorPicker,
  PacketRange,
  ShownStats,
  Spinner,
  WindowPicker,
  locationTitle,
} from "./panels.jsx";
import "./lorawan-traffic.css";

const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const INITIAL_VIEW = { longitude: 5, latitude: 40, zoom: 1.6, pitch: 0, bearing: 0 };
const FILL_ALPHA = 184; // 72%
const STROKE_WIDTH = 0.6;
const fmt = (n) => numberFormatter.format(n);

export default function LorawanTrafficMap() {
  const isDark = useDarkMode();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const traffic = useTraffic();
  const { index, rows, layers } = traffic;

  // Filters, seeded once from the URL and written back to it (below).
  const [seed] = useState(() => readUrlState(new URLSearchParams(window.location.search)));
  const [win, setWin] = useState(seed.win);
  const [storedRange, setStoredRange] = useState({ lo: seed.min ?? 1, hi: seed.max ?? 1, open: seed.max == null });
  const [picked, setPicked] = useState(seed.ouis ? new Set(seed.ouis) : null); // null = every OUI

  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [selection, setSelection] = useState(null); // { lng, lat, hits } for a clicked spot
  const [hover, setHover] = useState(null); // { row, point }
  const [sheetOpen, setSheetOpen] = useState(false);
  const hoverPos = useRef({ x: 0, y: 0 });
  const tooltipRef = useRef(null);
  const mapBoxRef = useRef(null);
  const userMoved = useRef(false);

  const allOuis = useMemo(() => rows.map((r) => r.oui), [rows]);
  const rowsByOui = useMemo(() => new Map(rows.map((r) => [r.oui, r])), [rows]);
  const enabled = useMemo(
    () => new Set(picked === null ? allOuis : allOuis.filter((oui) => picked.has(oui))),
    [picked, allOuis],
  );
  const max = index ? Math.max(1, index.maxPackets[win]) : 1;
  const range = useMemo(() => clampRange(storedRange, max), [storedRange, max]);
  // The slider stays live while the map and the counts catch up.
  const drawnRange = useDeferredValue(range);

  const scratch = useMemo(() => ({ seen: new Uint32Array(traffic.hotspotIds), epoch: 0 }), [traffic.hotspotIds]);
  const shown = useMemo(
    () => countShown({ rows, layers, enabled, win, range: drawnRange, scratch }),
    [rows, layers, enabled, win, drawnRange, scratch],
  );

  // ---- URL ----
  const navigate = useNavigate();
  const { search } = useLocation();
  useEffect(() => {
    if (!index) return undefined;
    const next = writeUrlState({ win, enabled, allOuis, range });
    if (next === search.replace(/^\?/, "")) return undefined;
    // Debounced: a slider drag would otherwise rewrite the URL on every step,
    // and browsers throttle history updates.
    const timer = setTimeout(() => navigate({ search: next ? `?${next}` : "" }, { replace: true }), 400);
    return () => clearTimeout(timer);
  }, [index, win, enabled, allOuis, range, search, navigate]);

  // ---- camera ----
  const fitTo = useCallback(
    (ouis) => {
      const box = mapBoxRef.current;
      const bounds = boundsOf(layers, ouis.length ? ouis : allOuis);
      if (!box || !bounds) return;
      const [w, s, e, n] = bounds;
      // Keep the data clear of the sidebar (desktop) or the sheet (phones).
      const padding = isMobile ? { top: 32, bottom: 120, left: 24, right: 24 } : { top: 48, bottom: 48, left: 436, right: 56 };
      let target;
      try {
        target = new WebMercatorViewport({ width: box.clientWidth, height: box.clientHeight }).fitBounds(
          [[w, s], [e, n]],
          { padding, maxZoom: 10 },
        );
      } catch {
        // A box smaller than the padding: centre without it.
        target = { longitude: (w + e) / 2, latitude: (s + n) / 2, zoom: 2 };
      }
      setViewState((prev) => ({
        ...prev,
        longitude: target.longitude,
        latitude: target.latitude,
        zoom: Math.max(0.5, target.zoom),
        transitionDuration: 600,
      }));
    },
    [layers, allOuis, isMobile],
  );
  const fitRef = useRef(fitTo);
  fitRef.current = fitTo;

  // Frame the data once, when the last layer lands, unless the user already moved the map.
  const framed = useRef(false);
  useEffect(() => {
    if (traffic.status !== "ready" || framed.current) return;
    framed.current = true;
    if (!userMoved.current) fitRef.current([...enabled]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traffic.status]);

  // ---- filters ----
  const toggleOui = useCallback(
    (oui, on) =>
      setPicked((prev) => {
        const next = new Set(prev === null ? allOuis : prev);
        if (on) next.add(oui);
        else next.delete(oui);
        return next;
      }),
    [allOuis],
  );
  const setMany = useCallback((want) => setPicked(new Set(rows.filter(want).map((r) => r.oui))), [rows]);

  // ---- map layers ----
  const drawOrder = useMemo(
    // Largest layers first, so smaller operators draw on top.
    () => [...rows].sort((a, b) => b.hotspots["30d"] - a.hotspots["30d"] || a.oui - b.oui),
    [rows],
  );
  const group = useMemo(() => (selection ? groupHits(selection.hits, win) : null), [selection, win]);

  const deckLayers = useMemo(() => {
    const key = PROP[win];
    const { lo, hi, open } = drawnRange;
    const stroke = isDark ? [17, 17, 19, 220] : [255, 255, 255, 255];
    const filterKey = [key, lo, hi, open];
    const out = [];
    for (const row of drawOrder) {
      const points = layers.get(row.oui)?.points;
      if (!points?.length) continue;
      out.push(
        new ScatterplotLayer({
          id: `oui-${row.oui}`,
          data: points,
          visible: enabled.has(row.oui),
          pickable: true,
          radiusUnits: "pixels",
          lineWidthUnits: "pixels",
          stroked: true,
          getPosition: (d) => [d.lng, d.lat],
          // A point outside the packet range gets no radius and no outline, so it
          // draws nothing and can't be picked. Only these two attributes are
          // rebuilt when a filter moves.
          getRadius: (d) => (inRange(d[key], lo, hi, open) ? radiusFor(d[key]) : 0),
          getLineWidth: (d) => (inRange(d[key], lo, hi, open) ? STROKE_WIDTH : 0),
          getFillColor: [...row.rgb, FILL_ALPHA],
          getLineColor: stroke,
          updateTriggers: { getRadius: filterKey, getLineWidth: filterKey },
        }),
      );
    }
    if (selection) {
      out.push(
        new ScatterplotLayer({
          id: "selection",
          data: [selection],
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 15,
          radiusUnits: "pixels",
          filled: false,
          stroked: true,
          getLineWidth: 2,
          lineWidthUnits: "pixels",
          getLineColor: isDark ? [255, 255, 255, 235] : [28, 25, 23, 235],
        }),
      );
    }
    return out;
  }, [drawOrder, layers, enabled, win, drawnRange, isDark, selection]);

  const handleHover = useCallback(
    (info) => {
      const row = info.object && info.layer?.id?.startsWith("oui-") ? rowsByOui.get(Number(info.layer.id.slice(4))) : null;
      if (!row) {
        setHover(null);
        return;
      }
      hoverPos.current = { x: info.x, y: info.y };
      // Move the tooltip through the DOM so a mouse move doesn't re-render the page.
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${info.x + 12}px`;
        tooltipRef.current.style.top = `${info.y - 12}px`;
      }
      setHover((prev) => (prev && prev.point === info.object && prev.row === row ? prev : { row, point: info.object }));
    },
    [rowsByOui],
  );

  // A click lists every shown Hotspot under it, not just the top dot.
  const handleClick = useCallback(
    (info, event) => {
      if (event?.srcEvent?.target?.closest?.(".maplibregl-ctrl")) return;
      const { viewport } = info;
      if (!viewport || info.x == null) return;
      const hits = hitsNear({
        layers,
        enabled,
        win,
        range,
        x: info.x,
        y: info.y,
        project: (c) => viewport.project(c),
        unproject: (c) => viewport.unproject(c),
      });
      if (!hits.length) {
        setSelection(null);
        return;
      }
      const found = groupHits(hits, win);
      const [lng, lat] = found.sameSpot ? [found.rows[0].lng, found.rows[0].lat] : viewport.unproject([info.x, info.y]);
      setSelection({ lng, lat, hits });
      setSheetOpen(true);
    },
    [layers, enabled, win, range],
  );

  // ---- WebMCP ----
  const live = useRef(null);
  live.current = { traffic, rowsByOui };
  const showTraffic = useCallback(async ({ ouis, window: nextWin, minPackets, maxPackets }, { signal } = {}) => {
    // Wait for every layer: the counts returned below need them all.
    for (;;) {
      const { status, error } = live.current.traffic;
      if (status === "ready") break;
      if (status === "error") throw new Error(error);
      await abortableDelay(250, signal);
    }
    const data = live.current.traffic;
    const known = live.current.rowsByOui;
    const unknown = (ouis || []).filter((oui) => !known.has(oui));
    if (unknown.length) {
      throw new Error(
        `no operator with OUI ${unknown.join(", ")} delivered packets in the 30 days to ${data.index.dataThrough}. get-lorawan-traffic-summary lists the ones that did.`,
      );
    }
    const nextEnabled = new Set(ouis || data.rows.map((r) => r.oui));
    const nextMax = Math.max(1, data.index.maxPackets[nextWin]);
    const nextRange = clampRange({ lo: minPackets, hi: maxPackets ?? 1, open: maxPackets == null }, nextMax);
    setWin(nextWin);
    setStoredRange(nextRange);
    setPicked(ouis ? nextEnabled : null);
    setSelection(null);
    userMoved.current = true; // the agent placed the camera; don't re-frame over it
    fitRef.current([...nextEnabled]);
    const counts = countShown({
      rows: data.rows,
      layers: data.layers,
      enabled: nextEnabled,
      win: nextWin,
      range: nextRange,
      scratch: { seen: new Uint32Array(data.hotspotIds), epoch: 0 },
    });
    return { index: data.index, rows: data.rows, enabled: nextEnabled, win: nextWin, range: nextRange, counts, failed: data.failed };
  }, []);
  useWebMcpTools(() => makeLorawanTrafficTools({ showTraffic }), []);

  // ---- panels ----
  const loadingLayers = traffic.status === "layers";

  const statusBlock =
    traffic.status === "index" ? (
      <div className="flex items-center gap-2.5 px-4 py-4 text-sm text-content-secondary" role="status">
        <Spinner />
        Loading the network summary
      </div>
    ) : traffic.status === "error" ? (
      <div className="space-y-2.5 px-4 py-4">
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-300">
          {traffic.error}
        </p>
        <button
          type="button"
          onClick={traffic.reload}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Try again
        </button>
      </div>
    ) : null;

  const filters = index && (
    <div className="space-y-3.5 px-4 py-3.5">
      <div>
        <h1 className="font-display text-base font-semibold tracking-[-0.01em] text-content">LoRaWAN traffic by operator</h1>
        <p className="mt-0.5 text-xs leading-snug text-content-secondary">
          Hotspots that delivered LoRaWAN packets, colored by the network operator (OUI) that received them.
        </p>
      </div>
      <WindowPicker index={index} win={win} onChange={setWin} />
      <PacketRange range={range} max={max} win={win} onChange={setStoredRange} />
      <ShownStats shown={shown} index={index} win={win} loading={loadingLayers} />
    </div>
  );

  const picker = (listClassName) =>
    index && (
      <>
        <OperatorPicker
          traffic={traffic}
          shown={shown}
          enabled={enabled}
          win={win}
          onToggle={toggleOui}
          onSetMany={setMany}
          onFit={() => fitTo([...enabled])}
          listClassName={listClassName}
        />
        <AboutData index={index} namesLoaded={traffic.namesLoaded} />
      </>
    );

  return (
    <div className="flex h-screen flex-col bg-surface-inset">
      <header className="shrink-0 border-b border-border bg-surface-raised">
        <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4">
          <a href="/" className="flex items-center gap-2 text-content hover:opacity-80 md:gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-accent text-xs font-semibold text-white md:h-10 md:w-10 md:text-sm">
              HT
            </div>
            <span className="font-display text-sm font-semibold tracking-[-0.02em] md:text-[17px]">Helium Tools</span>
            <span className="hidden text-[13px] text-content-tertiary md:inline">Operator utilities</span>
          </a>
          <span className="text-sm font-semibold text-content">LoRaWAN Traffic Map</span>
        </div>
      </header>

      <div ref={mapBoxRef} className="relative flex-1 overflow-hidden">
        <DeckGL
          viewState={viewState}
          onViewStateChange={({ viewState: next, interactionState }) => {
            if (interactionState?.isDragging || interactionState?.isZooming || interactionState?.isPanning) userMoved.current = true;
            setViewState(next);
          }}
          layers={deckLayers}
          onHover={handleHover}
          onClick={handleClick}
          controller={true}
          getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        >
          <MapGL mapStyle={isDark ? BASEMAP_DARK : BASEMAP_LIGHT}>
            <NavigationControl position={isMobile ? "top-left" : "bottom-right"} showCompass={false} />
          </MapGL>
        </DeckGL>

        {!isMobile && hover && (
          <MapTooltip hover={{ ...hover, packets: hover.point[PROP[win]] }} win={win} tooltipRef={tooltipRef} initialPos={hoverPos.current} />
        )}

        {/* Desktop: filters and the operator picker float on the left, a clicked spot on the right. */}
        <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 hidden w-[412px] flex-col gap-3 overflow-y-auto p-4 md:flex">
          <div className="pointer-events-auto shrink-0 rounded-xl bg-surface-raised shadow-soft">{statusBlock || filters}</div>
          {index && (
            // No overflow-hidden and no fixed minimum: the card's minimum is its
            // content (the picker with a three-row list, plus the notes when they
            // are open), so opening the notes in a short window makes the card
            // taller and the sidebar scroll.
            <div className="pointer-events-auto flex flex-1 flex-col rounded-xl bg-surface-raised shadow-soft">
              {picker("min-h-[132px] flex-1")}
            </div>
          )}
        </div>
        {group && (
          <div className="pointer-events-none absolute bottom-16 right-4 top-4 z-10 hidden w-[360px] md:block">
            <div className="pointer-events-auto max-h-full">
              <LocationCard group={group} rowsByOui={rowsByOui} win={win} onClose={() => setSelection(null)} />
            </div>
          </div>
        )}

        {/* Phones: one bottom sheet for everything. */}
        <div className="absolute bottom-0 left-0 right-0 z-10 md:hidden">
          <div className="rounded-t-2xl bg-surface-raised shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              aria-label={sheetOpen ? "Collapse panel" : "Expand panel"}
              aria-expanded={sheetOpen}
              className="flex w-full justify-center py-2"
            >
              <span className="h-1 w-9 rounded-full bg-content-tertiary/40" />
            </button>

            {statusBlock}

            {index && group && sheetOpen && (
              <div className="flex max-h-[55vh] flex-col">
                <div className="flex items-center justify-between gap-3 px-4 pb-2">
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-secondary transition hover:text-content"
                  >
                    <ArrowLeftIcon className="h-3.5 w-3.5" />
                    Filters
                  </button>
                  <span className="text-xs font-medium text-content">
                    {locationTitle(group)}, {win}
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-muted">
                  <LocationRows group={group} rowsByOui={rowsByOui} />
                </div>
              </div>
            )}

            {index && !sheetOpen && (
              <button type="button" onClick={() => setSheetOpen(true)} className="flex w-full items-center gap-2 px-4 pb-3 text-left">
                <span className="text-sm font-semibold text-content">
                  {loadingLayers
                    ? `Loading operators, ${fmt(traffic.loaded)} of ${fmt(traffic.total)}`
                    : group
                      ? locationTitle(group)
                      : `${fmt(shown.unique)} Hotspots shown, ${win}`}
                </span>
                <span className="ml-auto flex items-center gap-1 text-xs text-content-tertiary">
                  {group ? "Details" : "Filters"}
                  <ChevronUpIcon className="h-3.5 w-3.5" />
                </span>
              </button>
            )}

            {index && sheetOpen && !group && (
              <div className="max-h-[60vh] overflow-y-auto">
                {filters}
                <div className="flex flex-col border-t border-border-muted">{picker("h-64")}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
