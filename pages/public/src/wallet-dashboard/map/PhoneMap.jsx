import { memo, useEffect, useMemo, useRef, useState } from "react";
import MapGL from "react-map-gl/maplibre";
import { WebMercatorViewport } from "@deck.gl/core";
import { Btn, StatusMark } from "../ui/index.js";
import { ATTRIBUTION, basemapStyle } from "./basemap.js";
import {
  dotOf,
  dotRank,
  drawnOf,
  labelAlignAt,
  legendRows,
  needTxt,
  siteLabel,
  siteQuery,
  siteStats,
  siteSub,
} from "./mapEncoding.js";
import { boundsOf, fitView, queryClusters, useSiteClusters } from "./useSiteClusters.js";
import { DotMark, MarkerFace } from "./SiteMarkers.jsx";
import { MapLegend } from "./MapLegend.jsx";

const HEIGHT = 240;
const HEIGHT_CLOSE = 260;
// The preview unmounts while the map dialog is open, aborting its tile requests: not an error.
const onMapError = (e) => {
  if (e?.error?.name !== "AbortError") console.error(e?.error ?? e);
};

/** One "By place" row: a site (filters the list to its place) or a single Hotspot (opens it). */
function PlaceRow({ group, onPlace, onOpenDetail }) {
  const { stats, row } = group;
  const one = stats.n === 1 && row;
  const label = one ? row.name || "Unnamed Hotspot" : siteLabel(stats);
  const sub = one ? `${row.deviceLabel} · ${row.placeText}` : siteSub(stats);
  const checking = stats.need === 0 && stats.checking > 0;
  const iss = checking ? "Checking" : stats.need ? (one ? "Needs a look" : `${needTxt(stats.need)}`) : "No issues";
  const tier = checking ? "checking" : stats.need ? (stats.crit ? "serious" : "check") : "ok";
  return (
    <li>
      <button
        type="button"
        aria-label={`${label}. ${sub}. ${iss}. ${one ? "Open its details." : "Show in the Hotspot list."}`}
        onClick={(e) => (one ? onOpenDetail(row.param, e.currentTarget) : onPlace(siteQuery(stats)))}
        className="flex min-h-14 w-full items-center gap-3 border-0 border-t border-wd-line-2 bg-transparent px-4 py-2 text-left wd-ring-inset"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-wd-sm font-semibold text-wd-ink">{label}</span>
          <span className="text-wd-cap text-wd-ink-2">{sub}</span>
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-wd-cap ${stats.need ? "text-wd-caution-text" : "text-wd-ink-2"}`}
        >
          <StatusMark tier={tier} sr={false} />
          {iss.charAt(0).toUpperCase() + iss.slice(1)}
        </span>
        <span aria-hidden="true" className="text-lg text-wd-ink-3">
          ›
        </span>
      </button>
    </li>
  );
}

/**
 * The map on phones (< 768 px): a static 240 px preview (MapLibre only, one
 * WebGL context; sites and dots as plain HTML, nothing in it is a target)
 * with "Open map", which opens the interactive map full screen. The preview
 * map is unmounted while that dialog is open (`suspended`). Below it: the
 * selected Hotspot's panel (`panel`), the Legend disclosure, and with no
 * selection a "By place" list of the preview's sites, whose rows filter the
 * list to a place or open a single Hotspot.
 */
export const PhoneMap = memo(function PhoneMap({
  list,
  places,
  filter,
  mode,
  selKey,
  overlay,
  panel,
  ctx,
  windows,
  dark,
  suspended,
  openRef,
  onOpenMap,
  onPlace,
  onOpenDetail,
}) {
  const boxRef = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const filtered = Boolean(filter?.narrowed);
  const pointsByKey = useMemo(() => new Map((places?.points || []).map((p) => [p.key, p])), [places]);
  const selPoint = selKey ? pointsByKey.get(selKey) : null;
  const height = selPoint ? HEIGHT_CLOSE : HEIGHT;
  const size = useMemo(() => ({ width: width || 358, height }), [width, height]);

  // The preview's view: the selection's site up close, else the fleet (or
  // the filter's matches).
  const view = useMemo(() => {
    const start = { longitude: 0, latitude: 0, zoom: 2 };
    // Room for marker labels, and for "Open map" in the bottom right.
    const pad = selPoint ? { top: 44, right: 32, bottom: 32, left: 32 } : { top: 40, right: 40, bottom: 64, left: 40 };
    if (selPoint) {
      const site = places.siteByKey.get(selKey);
      const b = site && site.count > 1 ? site.bbox : [selPoint.lng, selPoint.lat, selPoint.lng, selPoint.lat];
      return fitView(start, size, b, { padding: pad, maxZoom: 18 });
    }
    const pts = filtered ? (places?.points || []).filter((p) => filter.keys.has(p.key)) : places?.points || [];
    const b = boundsOf(pts.length ? pts : places?.points || []);
    if (!b) return { longitude: -98.5, latitude: 39.8, zoom: 2 };
    const one = b[0] === b[2] && b[1] === b[3];
    return fitView(start, size, b, { padding: pad, maxZoom: one ? 13 : 15 });
  }, [selPoint, selKey, places, filtered, filter, size]);

  const clusters = useSiteClusters({ places, list, filter, radius: 48 });
  const query = useMemo(() => queryClusters(clusters, view, size, { phone: true, margin: 0 }), [clusters, view, size]);
  const vp = useMemo(() => new WebMercatorViewport({ ...view, pitch: 0, bearing: 0, ...size }), [view, size]);
  const dots = useMemo(() => {
    const out = [];
    for (const k of query.singleKeys) {
      const row = list?.byKey?.get(k);
      const p = pointsByKey.get(k);
      if (!row || !p) continue;
      const [x, y] = vp.project([p.lng, p.lat]);
      if (x < -20 || y < -20 || x > size.width + 20 || y > size.height + 20) continue;
      const dot = dotOf(row, mode);
      out.push({ key: k, row, dot, x, y, dim: filtered && !filter.keys.has(k), rank: dotRank(dot, k === selKey) });
    }
    return out.sort((a, b) => a.rank - b.rank);
  }, [query.singleKeys, list, pointsByKey, vp, size, mode, filtered, filter, selKey]);
  const markers = useMemo(
    () =>
      query.markers
        .map((m) => {
          const [x, y] = vp.project([m.lng, m.lat]);
          // A label centred under a marker near the side would be cut off: run it inward.
          return { ...m, x, y, labelAlign: labelAlignAt(x, m.stats, filtered, size.width) };
        })
        .filter((m) => m.x > -30 && m.y > -30 && m.x < size.width + 30 && m.y < size.height + 30),
    [query.markers, vp, size, filtered],
  );
  const selSite = selKey ? places?.siteByKey?.get(selKey) : null;
  const selDot = dots.find((d) => d.key === selKey) ?? null;

  // The selected Hotspot's overlay at the close-up: asserted cell, lines to far positions, positions.
  const geo = useMemo(() => {
    if (!overlay?.cell || !selPoint) return null;
    const cell = overlay.cell.polygon.map(([lng, lat]) => vp.project([lng, lat]).map((v) => Math.round(v * 10) / 10).join(",")).join(" ");
    const lines = (overlay.farLines || []).map((l) => [vp.project(l.from), vp.project(l.to)]);
    const pos = (overlay.groups || []).map((g) => vp.project([g.lng, g.lat]));
    return { cell, lines, pos, net: list?.byKey?.get(selKey)?.nets?.iot ? "iot" : "mobile" };
  }, [overlay, selPoint, vp, list, selKey]);

  const drawn = useMemo(() => drawnOf({ dots, markers, mode }), [dots, markers, mode]);
  const rows = useMemo(
    () =>
      legendRows(drawn, {
        selected: Boolean(selDot),
        overlay: geo ? { cell: geo.net, positions: geo.pos.length > 0, window: windows?.hb } : null,
        dark,
        ctx,
      }),
    [drawn, selDot, geo, windows, dark, ctx],
  );

  // "By place": the preview's sites and single Hotspots, most Hotspots first.
  const groups = useMemo(() => {
    const out = markers.map((m) => ({ id: m.id, stats: m.stats, row: null }));
    for (const d of dots) out.push({ id: d.key, stats: siteStats([d.row], filtered ? filter.keys : null, { cityOnly: clusters.cityOnly }), row: d.row });
    return out.sort((a, b) => b.stats.n - a.stats.n || siteLabel(a.stats).localeCompare(siteLabel(b.stats)));
  }, [markers, dots, filtered, filter, clusters.cityOnly]);

  return (
    <>
      <div ref={boxRef} className="relative overflow-hidden" style={{ height }}>
        <div aria-hidden="true" className="absolute inset-0 bg-wd-well">
          {!suspended && (
            <MapGL
              longitude={view.longitude}
              latitude={view.latitude}
              zoom={view.zoom}
              interactive={false}
              attributionControl={false}
              mapStyle={basemapStyle(dark)}
              onError={onMapError}
            />
          )}
          {geo && (
            <svg className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-visible">
              <polygon
                points={geo.cell}
                fill={`rgb(var(--wd-${geo.net}))`}
                fillOpacity="0.16"
                stroke={`rgb(var(--wd-${geo.net}))`}
                strokeOpacity="0.86"
                strokeWidth="1.5"
              />
              {geo.lines.map(([a, b], i) => (
                <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="rgb(var(--wd-mobile))" strokeOpacity="0.67" strokeWidth="2" />
              ))}
            </svg>
          )}
          {markers.map((m) => (
            <span
              key={m.id}
              className="absolute z-[2]"
              style={{ left: m.x, top: m.y, width: m.size, height: m.size, marginLeft: -m.size / 2, marginTop: -m.size / 2 }}
            >
              <MarkerFace
                marker={m}
                mode={mode}
                filtered={filtered}
                labelAll={markers.length <= 2}
                loupe={false}
                selected={Boolean(selSite) && m.siteIds.includes(selSite.id)}
                phone
                labelAlign={m.labelAlign}
              />
            </span>
          ))}
          {dots.map((d) => (
            <span
              key={d.key}
              className="absolute z-[2] -ml-3 -mt-3 flex h-6 w-6 items-center justify-center"
              style={{ left: d.x, top: d.y, opacity: d.dim ? 0.3 : 1 }}
            >
              <DotMark dot={d.dot} />
              {d.key === selKey && (
                <>
                  <span
                    className="absolute left-1/2 top-1/2 -ml-[17px] -mt-[17px] block h-[34px] w-[34px] rounded-full border-2 border-wd-ink"
                    style={{ boxShadow: "0 0 0 2px rgb(var(--color-surface-raised)), inset 0 0 0 2px rgb(var(--color-surface-raised))" }}
                  />
                  <span className="absolute bottom-[calc(100%+10px)] left-1/2 w-max max-w-[220px] -translate-x-1/2 rounded-lg bg-surface-raised px-[9px] py-1.5 text-[12px] font-semibold leading-4 text-wd-ink shadow-soft-lg">
                    {d.row.name || "Unnamed Hotspot"}
                  </span>
                </>
              )}
            </span>
          ))}
          {geo?.pos.map(([x, y], i) => (
            <span
              key={i}
              className="absolute z-[3] -ml-1.5 -mt-1.5 block h-3 w-3 rounded-full border-2 border-wd-mobile bg-surface-raised"
              style={{ left: x, top: y }}
            />
          ))}
          <span
            className="absolute bottom-1 left-1.5 z-[3] rounded-[3px] px-1 text-[10px] font-medium leading-[14px] text-wd-ink-3"
            style={{ background: "var(--wd-glass)" }}
          >
            {ATTRIBUTION}
          </span>
        </div>
        <Btn ref={openRef} onClick={onOpenMap} className="absolute bottom-2.5 right-2.5 z-[8] shadow-soft">
          Open map
        </Btn>
      </div>
      {panel}
      <MapLegend rows={rows} windows={windows?.line} variant="details" />
      {!panel && groups.length > 0 && (
        <div>
          <h3 className="m-0 px-4 pb-1 pt-3 font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-3">By place</h3>
          <ul className="m-0 list-none p-0">
            {groups.map((g) => (
              <PlaceRow key={g.id} group={g} onPlace={onPlace} onOpenDetail={onOpenDetail} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
});

export default PhoneMap;
