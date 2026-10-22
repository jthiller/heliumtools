import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WebMercatorViewport } from "@deck.gl/core";
import { fmtCount } from "../format.js";
import { StatusMark } from "../ui/index.js";
import { dotStyle, labelAlignAt, siteAria, siteLabelText, siteRing } from "./mapEncoding.js";

/**
 * One dot as HTML (the loupe, the phone preview, legend swatches), drawn
 * exactly like the canvas sprites (mapEncoding `dotStyle`). Decorative: the
 * element around it carries the words.
 */
export function DotMark({ dot, size, className = "" }) {
  const { className: markCls, style, triangle } = dotStyle(dot, size);
  return (
    <span aria-hidden="true" className={`relative isolate inline-flex shrink-0 items-center justify-center ${className}`}>
      {triangle && (
        <span
          className="absolute left-1/2 top-1/2 -z-[1] block h-5 w-[21px] -translate-x-1/2 -translate-y-[55%] bg-surface-raised"
          style={{ clipPath: "polygon(50% 0, 100% 98%, 0 98%)" }}
        />
      )}
      <span className={markCls} style={style} />
    </span>
  );
}

const LABEL_ALIGN = {
  center: "left-1/2 -translate-x-1/2",
  start: "left-0",
  end: "right-0",
};

/**
 * A site marker's look (the design's `.mp-site`): a ring split by network
 * (or by status in Health mode) around the count, the need-a-look badge, the
 * place label pill (always when `labelAll`, else on hover and focus), a
 * dashed outline for the loupe's site and an ink ring around the selection.
 * Used as the fleet map's buttons and the phone preview's static spans.
 * `labelAlign` keeps a static marker's label inside its box near an edge:
 * "start" runs it right from the marker, "end" left (default centered).
 */
export function MarkerFace({ marker, mode, filtered, labelAll, loupe, selected, phone = false, labelAlign = "center" }) {
  const { stats, badge, size } = marker;
  const big = stats.n >= 5;
  const count = filtered ? stats.matched : stats.n;
  // The count fits its ring: smaller type from three digits on.
  const digits = String(count).length;
  const fontSize = (big ? (phone ? 15 : 18) : phone ? 12 : 13) - (digits >= 4 ? (big ? 6 : 4) : digits === 3 ? 2 : 0);
  const label = siteLabelText(stats, filtered);
  return (
    <>
      {/* The loupe's dashed outline and the selection ring sit under the badge and label. */}
      {loupe && (
        <span className="pointer-events-none absolute -inset-2.5 rounded-[14px] border-[1.5px] border-dashed border-wd-ink-3" />
      )}
      {selected && (
        <span
          className="pointer-events-none absolute -inset-1.5 rounded-full border-2 border-wd-ink"
          style={{ boxShadow: "0 0 0 2px rgb(var(--color-surface-raised))" }}
        />
      )}
      <span
        className="relative block h-full w-full rounded-full shadow-soft-lg"
        style={{ padding: big ? 5 : 4, background: siteRing(stats, mode) }}
      >
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-surface-raised font-display font-bold tabular-nums text-wd-ink"
          style={{ fontSize, lineHeight: 1 }}
        >
          {fmtCount(count)}
        </span>
      </span>
      {badge && (
        <span className="absolute -right-4 -top-[7px] flex h-5 items-center gap-[3px] whitespace-nowrap rounded-full bg-surface-raised pl-1 pr-[7px] text-[11px] font-semibold leading-5 text-wd-caution-text shadow-soft">
          <StatusMark tier={badge.tier} sr={false} className="scale-75" />
          {badge.text}
        </span>
      )}
      <span
        className={`${labelAll ? "block" : "hidden group-hover:block group-focus-visible:block"} absolute ${LABEL_ALIGN[labelAlign] ?? LABEL_ALIGN.center} top-[calc(100%+6px)] whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 text-wd-ink shadow-soft`}
        style={{ background: "var(--wd-glass)" }}
      >
        {label}
      </span>
    </>
  );
}

const ARROWS = new Set(["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"]);

// The overlay is clipped, never scrolled: focusing a marker near an edge
// would otherwise scroll it out of register with the canvas.
const keepUnscrolled = (e) => {
  const el = e.currentTarget;
  if (el.scrollTop || el.scrollLeft) {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  }
};

/**
 * The fleet map's site markers: an HTML layer over the canvas. Positions
 * never go through React per frame: the map calls `apiRef.current.update()`
 * on every view change and one requestAnimationFrame projects each marker
 * from `viewRef` (the live view) and moves it with a transform. React
 * renders only when the marker set changes (a whole-zoom step or a settled
 * view) or the encoding does. Keyboard: one "Sites on the map" group, one
 * Tab stop (roving tabindex) over the markers in view (those kept just
 * outside it, so a pan reveals them, are never focusable); arrows move in
 * reading order, Home and End jump to the ends, Enter zooms in. When the
 * focused marker leaves the map (the zoom split it or resolved it into
 * dots), focus moves to the biggest marker in view made of its sites, else
 * to the map (`onFocusLost`). A wheel over a marker still zooms the map
 * (`onWheel` forwards it). Also positions the selected dot's name label.
 */
export const SiteMarkers = memo(function SiteMarkers({
  markers,
  mode,
  filtered,
  labelAll,
  loupeSiteId,
  selectedKey,
  selectedSiteIds,
  selectedLabel,
  viewRef,
  sizeRef,
  apiRef,
  onZoomTo,
  onWheel,
  onFocusLost,
}) {
  const descId = useId();
  const els = useRef(new Map());
  // The sites of a focused marker whose button is being removed.
  const lostRef = useRef(null);
  // One ref callback per marker id, so React detaches it only when that
  // marker's button goes (an inline callback is detached on every render,
  // which would flag the focused marker as lost while it stays).
  const refFns = useRef(new Map());
  const sitesOf = useRef(new Map());
  const refFor = (m) => {
    sitesOf.current.set(m.id, m.siteIds);
    let fn = refFns.current.get(m.id);
    if (!fn) {
      const id = m.id;
      fn = (el) => {
        if (el) {
          els.current.set(id, el);
          return;
        }
        // Detached while still in the page: remember its sites if it has focus.
        if (els.current.get(id) === document.activeElement) lostRef.current = new Set(sitesOf.current.get(id) ?? []);
        els.current.delete(id);
        refFns.current.delete(id);
        sitesOf.current.delete(id);
      };
      refFns.current.set(id, fn);
    }
    return fn;
  };
  const labelRef = useRef(null);
  const frame = useRef(0);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const [active, setActive] = useState(null);
  const selectedLabelRef = useRef(selectedLabel);
  selectedLabelRef.current = selectedLabel;

  const position = useCallback(() => {
    const view = viewRef.current;
    const size = sizeRef.current;
    if (!view || !size?.width) return;
    const vp = new WebMercatorViewport({ ...view, width: size.width, height: size.height });
    for (const m of markersRef.current) {
      const el = els.current.get(m.id);
      if (!el) continue;
      const [x, y] = vp.project([m.lng, m.lat]);
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }
    const lbl = labelRef.current;
    if (lbl && selectedLabelRef.current) {
      const [x, y] = vp.project([selectedLabelRef.current.lng, selectedLabelRef.current.lat]);
      lbl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }
  }, [viewRef, sizeRef]);

  useLayoutEffect(() => {
    position();
  }, [markers, selectedLabel, position]);

  // Reading order at the live view, markers in view only: rows of about a
  // marker's height, then left to right.
  const readingOrder = useCallback(
    (list) => {
      const view = viewRef.current;
      const size = sizeRef.current;
      if (!view || !size?.width) return list.map((m) => ({ id: m.id }));
      const vp = new WebMercatorViewport({ ...view, width: size.width, height: size.height });
      return list
        .map((m) => {
          const [px, py] = vp.project([m.lng, m.lat]);
          return { id: m.id, px, py };
        })
        .filter(({ px, py }) => px >= 0 && py >= 0 && px <= size.width && py <= size.height)
        .sort((a, b) => Math.round(a.py / 40) - Math.round(b.py / 40) || a.px - b.px);
    },
    [viewRef, sizeRef],
  );

  // Focus never drops to the page when its marker goes.
  useLayoutEffect(() => {
    const lost = lostRef.current;
    lostRef.current = null;
    const ae = document.activeElement;
    if (!lost || (ae && ae !== document.body)) return;
    const shown = new Set(readingOrder(markers).map((x) => x.id));
    const heir = markers
      .filter((m) => shown.has(m.id) && m.siteIds.some((id) => lost.has(id)))
      .sort((a, b) => b.stats.n - a.stats.n)[0];
    const el = heir && els.current.get(heir.id);
    if (el) {
      setActive(heir.id);
      el.focus({ preventScroll: true });
    } else onFocusLost?.();
  }, [markers, onFocusLost, readingOrder]);
  useEffect(() => {
    apiRef.current = {
      update() {
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          position();
        });
      },
    };
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [apiRef, position]);

  // A wheel over a marker zooms the map, not the page (a passive React
  // handler couldn't stop the page from scrolling).
  const groupRef = useRef(null);
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = groupRef.current;
    if (!el) return undefined;
    const h = (e) => {
      if (!wheelRef.current) return;
      e.preventDefault();
      wheelRef.current(e);
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [markers.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // The one Tab stop: the marker last focused while it's in view, else the
  // first in reading order (none when no marker is in view). Markers render
  // again when the view settles, so the stop follows a pan.
  const shownIds = useMemo(() => readingOrder(markers).map((x) => x.id), [markers, readingOrder]);
  const activeId = shownIds.includes(active) ? active : (shownIds[0] ?? null);
  // Labels near a side run inward (at the view the markers rendered for: they
  // render again when a pan settles).
  const aligns = useMemo(() => {
    const view = viewRef.current;
    const size = sizeRef.current;
    const out = new Map();
    if (!view || !size?.width) return out;
    const vp = new WebMercatorViewport({ ...view, width: size.width, height: size.height });
    for (const m of markers) out.set(m.id, labelAlignAt(vp.project([m.lng, m.lat])[0], m.stats, filtered, size.width));
    return out;
  }, [markers, filtered, viewRef, sizeRef]);

  const onKeyDown = (e) => {
    if (!ARROWS.has(e.key)) return;
    const order = readingOrder(markersRef.current)
      .map((x) => ({ ...x, el: els.current.get(x.id) }))
      .filter((x) => x.el);
    if (!order.length) return;
    const at = Math.max(0, order.findIndex((x) => x.id === activeId));
    let next = at;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(order.length - 1, at + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = order.length - 1;
    e.preventDefault();
    setActive(order[next].id);
    order[next].el.focus({ preventScroll: true });
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden" onScroll={keepUnscrolled}>
      {selectedLabel && (
        <span
          ref={labelRef}
          aria-hidden="true"
          className="absolute left-0 top-0 z-[1] will-change-transform"
          style={{ transform: "translate3d(-999px, -999px, 0)" }}
        >
          <span
            className="absolute bottom-[22px] left-0 block w-max max-w-[240px] -translate-x-1/2 rounded-lg bg-surface-raised px-[9px] py-1.5 text-[12px] font-semibold leading-4 text-wd-ink shadow-soft-lg"
          >
            {selectedLabel.name}
          </span>
        </span>
      )}
      {markers.length > 0 && (
        <div ref={groupRef} role="group" aria-label="Sites on the map" aria-describedby={descId} onKeyDown={onKeyDown}>
          <p id={descId} hidden>
            Every Hotspot is also in the Hotspot list.
          </p>
          {markers.map((m) => {
            const loupe = m.siteIds.length === 1 && m.siteIds[0] === loupeSiteId;
            const selected = Boolean(selectedKey) && m.siteIds.some((id) => selectedSiteIds?.has(id));
            const dim = filtered && m.stats.matched === 0;
            return (
              <button
                key={m.id}
                ref={refFor(m)}
                type="button"
                tabIndex={m.id === activeId ? 0 : -1}
                aria-label={siteAria(m.stats, { filtered, loupe, selected })}
                onFocus={() => setActive(m.id)}
                onClick={() => onZoomTo(m)}
                className={`group pointer-events-auto absolute left-0 top-0 cursor-pointer rounded-full border-0 bg-transparent p-0 will-change-transform hover:z-[5] focus-visible:z-[5] ${
                  // A 36 px marker reaches 44 px for touch on phones.
                  m.size < 44 ? "max-md:before:absolute max-md:before:-inset-1 max-md:before:rounded-full max-md:before:content-['']" : ""
                }`}
                style={{
                  width: m.size,
                  height: m.size,
                  marginLeft: -m.size / 2,
                  marginTop: -m.size / 2,
                  opacity: dim ? 0.3 : 1,
                  transform: "translate3d(-999px, -999px, 0)",
                }}
              >
                <MarkerFace
                  marker={m}
                  mode={mode}
                  filtered={filtered}
                  labelAll={labelAll}
                  loupe={loupe}
                  selected={selected}
                  labelAlign={aligns.get(m.id) ?? "center"}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default SiteMarkers;
