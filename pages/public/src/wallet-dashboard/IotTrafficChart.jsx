import { useLayoutEffect, useMemo, useRef, useState } from "react";
import useDarkMode from "../lib/useDarkMode.js";
import { fmtCount, fmtCompact, fmtDataDay, plural } from "./format.js";

// Per-OUI categorical slots, in fixed order (slot = the OUI's rank within the
// Hotspot, see deriveTrafficDetail). Validated against this site's raised
// surfaces in both modes; aqua/yellow/magenta sit under 3:1 on white, which
// is why the per-OUI table (the chart's table view) is always rendered.
const OUI_SERIES_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
};
/** The folded tail ("Other", slot null). */
const OTHER_SERIES_COLOR = { light: "#a8a29e", dark: "#6e6a75" };

/** Fill for a series/OUI color slot; null (or out of range) = "Other" gray. */
export function seriesColor(slot, dark) {
  const mode = dark ? "dark" : "light";
  return (slot != null && OUI_SERIES_COLORS[mode][slot]) || OTHER_SERIES_COLOR[mode];
}

const BAR_MAX = 24; // px: marks stay thin; the band's leftover is air
const GAP = 2; // px of surface between stacked segments and between columns
const RADIUS = 4; // rounded data-end on the top segment only
const MIN_BAR = 2; // px: a non-zero day never renders as nothing
const TOP_PAD = 6; // room for the top tick label, centered on its gridline
const AXIS_H = 18; // x-axis label band under the baseline
const TIP_GAP = 12;

/** Total rendered height for a given plot height (plot + tick label bands),
 * so placeholders can reserve exactly the chart's footprint. */
export function trafficChartHeight(plotHeight) {
  return plotHeight + TOP_PAD + AXIS_H;
}

/** Smallest clean round number ≥ v (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ). */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const nice = mag >= 1 ? Math.round(step * mag) : step * mag;
    if (nice >= v) return nice;
  }
  return 10 * mag;
}

/** A bar segment with a rounded top and a square base. */
function topRoundedPath(x, y, w, h) {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

/** What an empty day means: a confirmed zero only when the window's
 * unreported days are known (see deriveTrafficDetail `missingKnown`). */
const emptyDayText = (missingKnown) => (missingKnown ? "No messages" : "No messages, or not reported");

/** Screen-reader readout for one day (the visible tooltip is aria-hidden). */
function describeDay(day, series, missingKnown) {
  const date = fmtDataDay(day.day, { year: true });
  if (day.missing) return `${date}: no data reported.`;
  if (day.total === 0) return `${date}: ${emptyDayText(missingKnown).toLowerCase()}.`;
  const parts = series
    .map((s) => `${s.name} ${fmtCount(day.values[s.key] || 0)}`)
    .join(", ");
  return `${date}: ${plural(day.total, "message")}. ${parts}.`;
}

/**
 * One Hotspot's delivered messages per day, stacked by operator (OUI).
 * Hand-rolled SVG sized to its container; one column per data day of
 * `view.days`, stacked in `view.series` order (series[0] at the baseline).
 * Unreported days (`missing`) draw a dashed stub — never a zero.
 *
 * Hover, tap or focus + Left/Right reads a day; Escape clears.
 *
 * @param view     a "ready" result of deriveTrafficDetail
 * @param height   plot height in px (the axis bands are added on top; see
 *                 trafficChartHeight)
 * @param compact  narrow map-panel variant (smaller tooltip)
 */
export default function IotTrafficChart({ view, height = 160, compact = false }) {
  const dark = useDarkMode();
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(null); // day index | null
  // Announce days only when navigating by keyboard (hover would chatter).
  const [keyboard, setKeyboard] = useState(false);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const { days, series } = view;
  const n = days.length;
  const outerHeight = trafficChartHeight(height);
  const baseY = TOP_PAD + height;

  const yMax = useMemo(() => niceMax(Math.max(0, ...days.map((d) => d.total))), [days]);
  const yLabel = fmtCompact(yMax);
  const plotLeft = Math.ceil(yLabel.length * 5.6) + 8;
  const band = n > 0 && width > plotLeft ? (width - plotLeft) / n : 0;
  const barW = Math.max(1, Math.min(BAR_MAX, Math.round(band * 0.72), Math.floor(band - GAP)));

  // Stack geometry in px above the baseline. Segment edges are rounded from
  // cumulative values so the column's height is exact; each segment above
  // the first gives up its bottom GAP px to the surface gap. A segment too
  // small to survive its gap is skipped (the next one covers its sliver) —
  // the tooltip and table still carry its value.
  const columns = useMemo(() => {
    if (!band) return null;
    const scale = height / yMax;
    return days.map((d, i) => {
      const x = Math.round(plotLeft + i * band + (band - barW) / 2);
      const segs = [];
      if (d.total > 0) {
        let cum = 0;
        let lastTop = 0;
        for (const s of series) {
          const v = d.values[s.key] || 0;
          if (v <= 0) continue;
          cum += v;
          const top = Math.round(cum * scale);
          const bottom = segs.length ? lastTop + GAP : 0;
          if (top - bottom < 1) continue;
          segs.push({ key: s.key, slot: s.slot, bottom, top });
          lastTop = top;
        }
        if (!segs.length) {
          // Too small for the scale: keep a stub in the day's largest series.
          const main = series.reduce((m, s) => ((d.values[s.key] || 0) > (d.values[m.key] || 0) ? s : m));
          segs.push({ key: main.key, slot: main.slot, bottom: 0, top: MIN_BAR });
        }
      }
      return { x, segs, missing: d.missing };
    });
  }, [days, series, band, barW, plotLeft, height, yMax]);

  const pickDay = (e) => {
    if (!band) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setKeyboard(false);
    setActive(Math.min(n - 1, Math.max(0, Math.floor((x - plotLeft) / band))));
  };

  const onKeyDown = (e) => {
    let next;
    if (e.key === "ArrowLeft") next = active == null ? n - 1 : Math.max(0, active - 1);
    else if (e.key === "ArrowRight") next = active == null ? n - 1 : Math.min(n - 1, active + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape" && active != null) {
      // Consume it so an enclosing panel doesn't close on the same press.
      e.preventDefault();
      e.stopPropagation();
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setKeyboard(true);
    setActive(next);
  };

  const first = days[0]?.day;
  const last = days[n - 1]?.day;
  const ariaLabel =
    `Daily messages by OUI, ${fmtDataDay(first)} – ${fmtDataDay(last)}: ${fmtCount(view.total)} total. ` +
    "Use the left and right arrow keys to read each day.";

  // First, middle and last day under the axis (deduped for short windows).
  const xTicks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const stubH = Math.min(24, Math.round(height * 0.3));

  const activeDay = active != null ? days[active] : null;
  let tip = null;
  if (activeDay && columns) {
    const tipW = Math.min(compact ? 176 : 208, width);
    const cx = plotLeft + (active + 0.5) * band;
    // Beside the column, flipping left near the right edge; centered and
    // clamped when neither side fits (narrow panels).
    let left = cx + TIP_GAP;
    if (left + tipW > width) left = cx - TIP_GAP - tipW;
    if (left < 0) left = Math.max(0, Math.min(width - tipW, cx - tipW / 2));
    tip = { left, width: tipW };
  }

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}
      className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
      style={{ height: outerHeight }}
    >
      {columns && (
        <svg
          width={width}
          height={outerHeight}
          aria-hidden="true"
          className="block select-none"
          style={{ touchAction: "pan-y" }}
          onPointerDown={pickDay}
          onPointerMove={pickDay}
          onPointerLeave={(e) => {
            // A tap ends with pointerleave; keep its readout until blur.
            if (e.pointerType === "mouse") setActive(null);
          }}
        >
          {/* Hover band behind the active column (the whole column is the target). */}
          {active != null && (
            <rect
              x={plotLeft + active * band}
              y={TOP_PAD}
              width={band}
              height={height}
              className="fill-content/[0.06]"
            />
          )}

          {/* Hairline grid: the baseline and one clean max tick. */}
          <g className="stroke-border" strokeWidth="1" shapeRendering="crispEdges">
            <line x1={plotLeft} x2={width} y1={TOP_PAD + 0.5} y2={TOP_PAD + 0.5} />
            <line x1={plotLeft} x2={width} y1={baseY + 0.5} y2={baseY + 0.5} />
          </g>
          <g className="fill-content-tertiary text-[10px] tabular-nums" textAnchor="end" dominantBaseline="middle">
            <text x={plotLeft - 6} y={TOP_PAD}>
              {yLabel}
            </text>
            <text x={plotLeft - 6} y={baseY}>
              0
            </text>
          </g>

          {columns.map((c, i) =>
            c.missing ? (
              <rect
                key={days[i].day}
                x={c.x + 0.5}
                y={baseY - stubH + 0.5}
                width={Math.max(0, barW - 1)}
                height={stubH - 1}
                fill="none"
                strokeWidth="1"
                strokeDasharray="2 2"
                className="stroke-content-tertiary"
              />
            ) : (
              <g key={days[i].day}>
                {c.segs.map((s, j) => {
                  const y = baseY - s.top;
                  const h = s.top - s.bottom;
                  const fill = seriesColor(s.slot, dark);
                  return j === c.segs.length - 1 ? (
                    <path key={s.key} d={topRoundedPath(c.x, y, barW, h)} fill={fill} />
                  ) : (
                    <rect key={s.key} x={c.x} y={y} width={barW} height={h} fill={fill} />
                  );
                })}
              </g>
            ),
          )}

          <g className="fill-content-tertiary text-[10px]">
            {xTicks.map((i) => {
              const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
              const x =
                anchor === "start" ? columns[i].x : anchor === "end" ? columns[i].x + barW : columns[i].x + barW / 2;
              return (
                <text key={i} x={x} y={baseY + 14} textAnchor={anchor}>
                  {fmtDataDay(days[i].day)}
                </text>
              );
            })}
          </g>
        </svg>
      )}

      {tip && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 z-10 rounded-lg bg-surface-raised p-2.5 shadow-soft-lg"
          style={{ left: tip.left, width: tip.width }}
        >
          <div className="text-[11px] text-content-tertiary">{fmtDataDay(activeDay.day, { year: true })}</div>
          {activeDay.missing ? (
            <div className="mt-0.5 text-xs font-medium text-content-secondary">No data reported</div>
          ) : activeDay.total === 0 ? (
            <div className="mt-0.5 text-xs font-medium text-content-secondary">{emptyDayText(view.missingKnown)}</div>
          ) : (
            <>
              <div className="mt-0.5 text-sm font-semibold text-content">{plural(activeDay.total, "message")}</div>
              <div
                className={`mt-1.5 grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 ${
                  compact ? "text-[11px]" : "text-xs"
                }`}
              >
                {series.map((s) => (
                  <div key={s.key} className="contents">
                    <span className="h-0.5 w-2.5 rounded-full" style={{ background: seriesColor(s.slot, dark) }} />
                    <span className="text-right font-medium tabular-nums text-content">
                      {fmtCount(activeDay.values[s.key] || 0)}
                    </span>
                    <span className="truncate text-content-secondary">{s.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {keyboard && activeDay ? describeDay(activeDay, series, view.missingKnown) : ""}
      </div>
    </div>
  );
}

/** Legend key for the unreported-day stub, matching the chart's mark. */
export function MissingDayKey({ className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[1px] border border-dashed border-content-tertiary ${className}`}
    />
  );
}
