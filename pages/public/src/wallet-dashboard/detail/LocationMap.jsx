import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Layer, Source } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import useDarkMode from "../../lib/useDarkMode.js";
import { COVERAGE_RSSI_MAX, COVERAGE_RSSI_MIN } from "../format.js";
import { ATTRIBUTION, basemapStyle, overlayColors } from "../map/basemap.js";

// Close enough to read the street around the asserted res-12 cell (about
// 25 px across), far enough to show a position tens of meters off.
const CELL_ZOOM = 16.5;
const COVERAGE_MAX_ZOOM = 14;
const PAD = 28;
// The modeled-coverage ramp over −130 → −90 dBm (the fleet map's), faintest
// at the floor, deepest toward −90.
const RAMP = {
  light: { from: "rgba(183, 211, 246, 0.45)", to: "rgba(28, 92, 171, 0.75)" },
  dark: { from: "rgba(24, 79, 149, 0.45)", to: "rgba(109, 167, 236, 0.8)" },
};
const css = ([r, g, b], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;
// A theme switch while the basemap style is still loading aborts its
// requests; that isn't an error worth logging.
const onMapError = (e) => {
  if (e?.error?.name !== "AbortError") console.error(e?.error ?? e);
};
// Closing the detail removes the map while its style or sprite request is
// still out. maplibre detaches the style from the map, then the aborted
// request reports an error on the style itself, which logs it when nothing
// listens there. A listener on each style (a theme switch makes a new one)
// takes those teardown aborts.
const ignoreTeardownError = () => {};
const quietStyleTeardown = (map) => map.style?.on("error", ignoreTeardownError);
const EMPTY = { type: "FeatureCollection", features: [] };
const point = (lng, lat, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lng, lat] } });

/** [[west, south], [east, north]] over a list of [lng, lat]. */
function bboxOf(coords) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}

/**
 * The detail's 240 px mini map, MapLibre only (one WebGL context, no deck):
 * the asserted res-12 cell in the network's color with a pin at its center,
 * a WiFi Hotspot's reported positions with lines to those far from the cell
 * (all from `selectedOverlay`, the same geometry the fleet map draws), and
 * the modeled coverage footprint when it's on. Static: it reads as one image
 * (`role="img"`, `ariaLabel`). One instance stays mounted across Previous /
 * Next; its sources update in place and the camera jumps to the new Hotspot.
 *
 * @param overlay   selectedOverlay(row, mobile)
 * @param net       "iot" | "mobile": the cell's color
 * @param footprint the drawn coverage cells (`{ polygon, rssi }[]`) while
 *                  coverage is shown, else null
 * @param legend    [{ kind: "cell"|"pin"|"ramp"|"pos", text }]
 */
export default function LocationMap({ overlay, net, footprint, legend, ariaLabel }) {
  const dark = useDarkMode();
  const mapRef = useRef(null);
  // The map's first style exists as soon as the map does; later ones (a theme
  // switch) announce themselves with styledataloading.
  const setMapRef = useCallback((ref) => {
    mapRef.current = ref;
    const map = ref?.getMap?.();
    if (!map || map.__wdQuietTeardown) return;
    map.__wdQuietTeardown = true;
    quietStyleTeardown(map);
    map.on("styledataloading", () => quietStyleTeardown(map));
  }, []);
  const [loaded, setLoaded] = useState(false);
  const colors = useMemo(() => overlayColors(), [dark]); // eslint-disable-line react-hooks/exhaustive-deps
  const netColor = net === "iot" ? colors.iot : colors.mobile;
  const ramp = dark ? RAMP.dark : RAMP.light;

  const cell = overlay?.cell;
  const center = cell?.center;
  const cellData = useMemo(
    () =>
      cell
        ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [cell.polygon] } }
        : EMPTY,
    [cell],
  );
  const pinData = useMemo(() => (center ? point(center.lng, center.lat) : EMPTY), [center]);
  const posData = useMemo(
    () => ({ type: "FeatureCollection", features: (overlay?.groups ?? []).map((g) => point(g.lng, g.lat, { count: g.count })) }),
    [overlay?.groups],
  );
  const lineData = useMemo(
    () => ({
      type: "FeatureCollection",
      features: (overlay?.farLines ?? []).map((l) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [l.from, l.to] },
      })),
    }),
    [overlay?.farLines],
  );
  const coverageData = useMemo(
    () =>
      footprint?.length
        ? {
            type: "FeatureCollection",
            features: footprint.map((c) => ({
              type: "Feature",
              properties: { rssi: c.rssi },
              geometry: { type: "Polygon", coordinates: [c.polygon] },
            })),
          }
        : EMPTY,
    [footprint],
  );

  // The view: the footprint while coverage shows, else the cell and any
  // reported positions, never closer than the cell zoom.
  const view = useMemo(() => {
    if (footprint?.length) {
      return { bounds: bboxOf(footprint.flatMap((c) => c.polygon)), maxZoom: COVERAGE_MAX_ZOOM };
    }
    if (!center) return null;
    const pts = [[center.lng, center.lat], ...(overlay?.groups ?? []).map((g) => [g.lng, g.lat])];
    if (pts.length > 1) return { bounds: bboxOf([...pts, ...(cell?.polygon ?? [])]), maxZoom: CELL_ZOOM };
    return { center: [center.lng, center.lat], zoom: CELL_ZOOM };
  }, [footprint, center, cell, overlay?.groups]);

  useEffect(() => {
    const map = mapRef.current?.getMap?.();
    if (!map || !loaded || !view) return;
    if (view.bounds) map.fitBounds(view.bounds, { padding: PAD, maxZoom: view.maxZoom, duration: 0 });
    else map.jumpTo({ center: view.center, zoom: view.zoom });
  }, [view, loaded]);

  const initial = center ? { longitude: center.lng, latitude: center.lat, zoom: CELL_ZOOM } : { longitude: 0, latitude: 20, zoom: 1 };

  return (
    <div role="img" aria-label={ariaLabel} className="relative h-60 overflow-hidden rounded-xl bg-wd-well">
      <div aria-hidden="true" className="absolute inset-0">
        <MapGL
          ref={setMapRef}
          initialViewState={initial}
          mapStyle={basemapStyle(dark)}
          interactive={false}
          attributionControl={false}
          onLoad={() => setLoaded(true)}
          onError={onMapError}
          style={{ width: "100%", height: "100%" }}
        >
          <Source id="wd-detail-coverage" type="geojson" data={coverageData}>
            <Layer
              id="wd-detail-coverage-fill"
              type="fill"
              paint={{
                "fill-color": ["interpolate", ["linear"], ["get", "rssi"], COVERAGE_RSSI_MIN, ramp.from, COVERAGE_RSSI_MAX, ramp.to],
              }}
            />
          </Source>
          <Source id="wd-detail-cell" type="geojson" data={footprint?.length ? EMPTY : cellData}>
            <Layer id="wd-detail-cell-fill" type="fill" paint={{ "fill-color": css(netColor, 0.18) }} />
            <Layer id="wd-detail-cell-line" type="line" paint={{ "line-color": css(netColor), "line-width": 1.5 }} />
          </Source>
          <Source id="wd-detail-lines" type="geojson" data={lineData}>
            <Layer id="wd-detail-lines" type="line" paint={{ "line-color": css(colors.mobile, 0.75), "line-width": 1.5 }} />
          </Source>
          <Source id="wd-detail-pin" type="geojson" data={pinData}>
            <Layer
              id="wd-detail-pin"
              type="circle"
              paint={{ "circle-radius": 5, "circle-color": css(netColor), "circle-stroke-width": 2, "circle-stroke-color": css(colors.raised) }}
            />
          </Source>
          <Source id="wd-detail-positions" type="geojson" data={posData}>
            <Layer
              id="wd-detail-positions"
              type="circle"
              paint={{
                "circle-radius": 4.5,
                "circle-color": css(colors.raised),
                "circle-stroke-width": 2,
                "circle-stroke-color": css(colors.mobile),
              }}
            />
          </Source>
        </MapGL>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {legend?.length > 0 && (
          <div className="absolute left-2 top-2 flex flex-col gap-1 rounded-lg bg-[var(--wd-glass)] px-[9px] py-1.5 text-[11px] leading-[14px] text-wd-ink-2 shadow-soft">
            {legend.map((g) => (
              <span key={g.kind} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <LegendKey kind={g.kind} net={net} ramp={ramp} />
                {g.text}
              </span>
            ))}
          </div>
        )}
        <span className="absolute bottom-1 right-1.5 rounded-[3px] bg-[var(--wd-glass)] px-1 text-[10px] font-medium leading-[14px] text-wd-ink-3">
          {ATTRIBUTION}
        </span>
      </div>
    </div>
  );
}

const HEX = "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)";

function LegendKey({ kind, net, ramp }) {
  const tone = net === "iot" ? "bg-wd-iot" : "bg-wd-mobile";
  if (kind === "cell") return <i className={`h-[11px] w-3 shrink-0 opacity-70 ${tone}`} style={{ clipPath: HEX }} />;
  if (kind === "pin") return <i className={`h-[9px] w-[9px] shrink-0 rounded-full ${tone}`} />;
  if (kind === "ramp") {
    return <i className="h-2 w-[22px] shrink-0 rounded-sm" style={{ background: `linear-gradient(90deg, ${ramp.from}, ${ramp.to})` }} />;
  }
  return <i className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-wd-mobile bg-surface-raised" />;
}
