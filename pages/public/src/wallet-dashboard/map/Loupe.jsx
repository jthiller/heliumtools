import { memo, useMemo, useRef, useState } from "react";
import MapGL from "react-map-gl/maplibre";
import { WebMercatorViewport } from "@deck.gl/core";
import useMediaQuery from "../../lib/useMediaQuery.js";
import { ATTRIBUTION, basemapStyle } from "./basemap.js";
import { dotAria, dotLines, needTxt, tierTextClass } from "./mapEncoding.js";
import { fitView } from "./useSiteClusters.js";
import { DotMark } from "./SiteMarkers.jsx";
import { fmtCount, plural } from "../format.js";

const ARROWS = new Set(["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"]);
// The loupe unmounts on a selection, aborting its tile requests: not an error.
const onMapError = (e) => {
  if (e?.error?.name !== "AbortError") console.error(e?.error ?? e);
};

/**
 * One site up close (WdMap's loupe): while the fleet map shows a dense site
 * of 5 or more Hotspots as one marker, this inset draws that site's
 * Hotspots one by one, so they read without zooming in. MapLibre only (one
 * WebGL context, no deck); the dots are buttons in one "{site}, up close"
 * group with a roving tabindex, each with the map dot's tooltip as its
 * hover and focus label, and a click selects it on the map (focus moves to
 * the selected Hotspot's panel, since the loupe closes). The fleet map
 * mounts it only at fleet zoom with no selection, for fleets of 200
 * Hotspots or fewer, and never on phones.
 */
export const Loupe = memo(function Loupe({ site, dots, ctx, filtered, filterKeys, stats, pointsByKey, dark, onSelect }) {
  const wide = useMediaQuery("(min-width: 1280px)");
  const size = useMemo(() => (wide ? { width: 340, height: 214 } : { width: 290, height: 200 }), [wide]);
  const view = useMemo(() => {
    const start = { longitude: site.lng, latitude: site.lat, zoom: 16 };
    return fitView(start, size, site.bbox, { padding: { top: 26, right: 26, bottom: 26, left: 26 }, maxZoom: 19 });
  }, [site, size]);
  const placed = useMemo(() => {
    const vp = new WebMercatorViewport({ ...view, pitch: 0, bearing: 0, width: size.width, height: size.height });
    return (dots || [])
      .map((d) => {
        const p = pointsByKey.get(d.row.key);
        if (!p) return null;
        const [x, y] = vp.project([p.lng, p.lat]);
        return { ...d, x, y, dim: filtered && !filterKeys?.has(d.row.key) };
      })
      .filter(Boolean)
      .sort((a, b) => Math.round(a.y / 24) - Math.round(b.y / 24) || a.x - b.x);
  }, [dots, pointsByKey, view, size, filtered, filterKeys]);

  const [active, setActive] = useState(null);
  const refs = useRef(new Map());
  const activeKey = placed.some((d) => d.row.key === active) ? active : (placed[0]?.row.key ?? null);
  const onKeyDown = (e) => {
    if (!ARROWS.has(e.key) || !placed.length) return;
    const at = Math.max(0, placed.findIndex((d) => d.row.key === activeKey));
    let next = at;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(placed.length - 1, at + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (e.key === "Home") next = 0;
    else next = placed.length - 1;
    e.preventDefault();
    const key = placed[next].row.key;
    setActive(key);
    refs.current.get(key)?.focus();
  };

  const n = stats?.n ?? placed.length;
  const sub = filtered
    ? `${fmtCount(stats?.matched ?? 0)} of ${fmtCount(n)} match`
    : stats?.checking > 0 && !stats?.need
      ? `${plural(n, "Hotspot")}, checking`
      : `${plural(n, "Hotspot")} · ${needTxt(stats?.need ?? 0)}`;

  return (
    <div
      role="group"
      aria-label={`${site.label}, up close: ${plural(n, "Hotspot")} shown one by one.`}
      className="absolute bottom-4 right-4 z-[7] w-[290px] overflow-hidden rounded-xl bg-surface-raised shadow-soft-lg xl:w-[340px]"
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-wd-line-2 px-3 py-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-wd-sm font-semibold text-wd-ink">{site.label}</span>
          <span className="shrink-0 text-wd-cap text-wd-ink-2">up close</span>
        </span>
        <span className="shrink-0 text-wd-cap text-wd-ink-2">{sub}</span>
      </div>
      <div className="relative" style={{ height: size.height }}>
        <div aria-hidden="true" className="absolute inset-0">
          <MapGL
            longitude={view.longitude}
            latitude={view.latitude}
            zoom={view.zoom}
            interactive={false}
            attributionControl={false}
            mapStyle={basemapStyle(dark)}
            onError={onMapError}
          />
        </div>
        <div className="pointer-events-none absolute inset-0" onKeyDown={onKeyDown}>
          {placed.map((d) => {
            const t = dotLines(d.row, ctx);
            const tipY = d.y < 70 ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]";
            const tipX = d.x < 120 ? "-left-1" : d.x > size.width - 120 ? "-right-1" : "left-1/2 -translate-x-1/2";
            return (
              <button
                key={d.row.key}
                ref={(el) => {
                  if (el) refs.current.set(d.row.key, el);
                  else refs.current.delete(d.row.key);
                }}
                type="button"
                tabIndex={d.row.key === activeKey ? 0 : -1}
                aria-label={dotAria(d.row, ctx, { dim: d.dim })}
                onFocus={() => setActive(d.row.key)}
                onClick={() => onSelect(d.row.key, { fly: true, focus: true })}
                className="group pointer-events-auto absolute z-[2] -ml-3 -mt-3 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 hover:z-[6] focus-visible:z-[6]"
                style={{ left: d.x, top: d.y, opacity: d.dim ? 0.3 : 1 }}
              >
                <DotMark dot={d.dot} />
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute ${tipY} ${tipX} hidden w-max max-w-[240px] rounded-lg bg-surface-raised px-[9px] py-1.5 text-left text-[12px] font-normal leading-4 text-wd-ink-2 shadow-soft-lg group-hover:block group-focus-visible:block`}
                >
                  <b className="block font-semibold text-wd-ink">{t.name}</b>
                  <span className="block">{t.device}</span>
                  <span className="block">{t.money}</span>
                  <span className={`block ${t.tier === "serious" || t.tier === "check" ? tierTextClass(t.tier) : ""}`}>{t.status}</span>
                  {t.more.map((m) => (
                    <span key={m} className="block">
                      {m}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <span
          aria-hidden="true"
          className="absolute bottom-1 right-1.5 z-[3] rounded-[3px] px-1 text-[10px] font-medium leading-[14px] text-wd-ink-3"
          style={{ background: "var(--wd-glass)" }}
        >
          {ATTRIBUTION}
        </span>
      </div>
    </div>
  );
});

export default Loupe;
