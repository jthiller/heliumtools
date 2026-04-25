import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import useDarkMode from "../lib/useDarkMode.js";
import { devAddrToNetId, netIdToOperator } from "../lib/lorawan.js";
import { readChartColors } from "../lib/chartColors.js";

// Per-packet dot colour: NetID picks the hue family, frame type picks the
// shade (confirmed uplinks darker than unconfirmed). All Helium NetIDs share
// one emerald family so an operator sees "their traffic" as visually unified.
// Non-Helium NetIDs map deterministically to the remaining hues via djb2.
const HELIUM_NETIDS = new Set(["000024", "00003C", "60002D", "C00053"]);

// [unconfirmed / joins, confirmed] shade pairs, light mode then dark mode.
// Tailwind-derived hex so tone matches the rest of the app.
const NETID_FAMILIES_LIGHT = {
  helium: ["#10b981", "#047857"],   // emerald-500 / emerald-700
  sky:    ["#38bdf8", "#0369a1"],   // sky-400   / sky-700
  amber:  ["#f59e0b", "#b45309"],   // amber-500 / amber-700
  rose:   ["#f43f5e", "#be123c"],   // rose-500  / rose-700
  cyan:   ["#06b6d4", "#0e7490"],   // cyan-500  / cyan-700
  fuchsia:["#d946ef", "#a21caf"],   // fuchsia-500 / fuchsia-700
  lime:   ["#84cc16", "#4d7c0f"],   // lime-500  / lime-700
  indigo: ["#6366f1", "#4338ca"],   // indigo-500 / indigo-700
};
const NETID_FAMILIES_DARK = {
  helium: ["#34d399", "#10b981"],   // emerald-400 / emerald-500
  sky:    ["#7dd3fc", "#38bdf8"],   // sky-300   / sky-400
  amber:  ["#fbbf24", "#f59e0b"],   // amber-400 / amber-500
  rose:   ["#fb7185", "#f43f5e"],   // rose-400  / rose-500
  cyan:   ["#22d3ee", "#06b6d4"],   // cyan-400  / cyan-500
  fuchsia:["#e879f9", "#d946ef"],   // fuchsia-400 / fuchsia-500
  lime:   ["#a3e635", "#84cc16"],   // lime-400  / lime-500
  indigo: ["#818cf8", "#6366f1"],   // indigo-400 / indigo-500
};
// First key reserved for Helium; remaining assigned to other NetIDs in
// insertion order via djb2 hash.
const NON_HELIUM_FAMILIES = ["sky", "amber", "rose", "cyan", "fuchsia", "lime", "indigo"];

function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function familyForNetId(netId) {
  if (!netId) return "helium";
  if (HELIUM_NETIDS.has(netId)) return "helium";
  return NON_HELIUM_FAMILIES[djb2(netId) % NON_HELIUM_FAMILIES.length];
}

function colorForNetIdShade(netId, confirmed, isDark) {
  const palette = isDark ? NETID_FAMILIES_DARK : NETID_FAMILIES_LIGHT;
  const [light, dark] = palette[familyForNetId(netId)];
  return confirmed ? dark : light;
}

function colorForTrack(track, isDark) {
  // Band uses the light shade so it sits quietly behind dots that may be in
  // either shade.
  return colorForNetIdShade(track?.netId, false, isDark);
}

export function swatchColorForNetId(netId, isDark) {
  return colorForNetIdShade(netId, false, isDark);
}

// Custom <select> replacement so we can render a colour swatch next to each
// option — native <option> elements don't support complex children. Follows
// the WAI-ARIA button+listbox pattern: aria-activedescendant on the trigger,
// arrow-key navigation, Enter/Space to select, Escape to close. Focus stays
// on the button throughout so screen readers and keyboard users get a
// predictable flow.
export function ColoredSelect({ value, onChange, options, label }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value)),
  );
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listboxId = useId();
  const optionId = (i) => `${listboxId}-opt-${i}`;

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const i = options.findIndex((o) => o.value === value);
    if (i >= 0) setActiveIndex(i);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`#${CSS.escape(optionId(activeIndex))}`);
    el?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, open]);

  const selected = options.find((o) => o.value === value) ?? options[0];

  const commit = (i) => {
    const opt = options[i];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(activeIndex);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      default:
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary focus:border-accent focus:outline-none"
      >
        {selected.swatch && (
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: selected.swatch }}
          />
        )}
        <span>{selected.label}</span>
        <span aria-hidden className="text-content-tertiary">▾</span>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 max-h-56 min-w-full overflow-y-auto rounded-md border border-border bg-surface-raised py-1 text-xs shadow-soft"
        >
          {options.map((o, i) => {
            const isActive = i === activeIndex;
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => commit(i)}
                className={`flex cursor-pointer items-center gap-2 whitespace-nowrap px-2 py-1 ${
                  isActive ? "bg-surface-inset" : ""
                } ${isSelected ? "text-content-primary" : "text-content-secondary"}`}
              >
                {o.swatch ? (
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: o.swatch }}
                  />
                ) : (
                  <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0" />
                )}
                <span>{o.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// SNR → half-band size (dB). LoRaWAN SNR floor is ~-20 dB (below demodulation
// limit); +10 dB is excellent. Low SNR = wider band (more uncertainty).
const SNR_BEST = 10;
const SNR_WORST = -20;
const HALF_WIDTH_MIN_DB = 1.5;
const HALF_WIDTH_MAX_DB = 10;

function halfWidthForSnr(snr) {
  if (snr == null || !Number.isFinite(snr)) return HALF_WIDTH_MAX_DB;
  const t = Math.max(0, Math.min(1, (snr - SNR_WORST) / (SNR_BEST - SNR_WORST)));
  return HALF_WIDTH_MAX_DB - (HALF_WIDTH_MAX_DB - HALF_WIDTH_MIN_DB) * t;
}

// Plot geometry. Both the chart and the events bar share these insets so
// their time axes line up to the pixel; if you change one here, both
// surfaces update together. The y-axis label gutter shrinks on narrow
// viewports so mobile screens get more plot area.
export const PLOT_RIGHT = 16;
const PLOT_TOP = 8;
export function plotLeftFor(width) {
  // Mobile value has to clear the widest y-axis label ("-115 dBm") plus a
  // small margin from the container edge; the wrapper has no horizontal
  // padding on small screens so the inset comes from the canvas alone.
  return width < 640 ? 68 : 78;
}
const HIT_RADIUS = 12;     // px from cursor to consider a dot hovered
const HIT_RADIUS_SQ = HIT_RADIUS * HIT_RADIUS;
const DOT_RADIUS = 4;
const DOT_RADIUS_HOVERED = 5.5;
const BAND_TWEEN_MS = 220; // hover-band grow duration
// Shared with EventsBar so chart and events bar pulse in unison.
export const PULSE_DURATION_MS = 700;
const PULSE_MAX_R = 16; // outer ring radius at end of pulse

// Catmull-Rom interpolation: appends bezier segments through `points`. When
// `start=false`, continues from the current pen position with a lineTo to the
// first point (used to splice upper + lower halves of the band into one
// closed shape).
//
// Standard Catmull-Rom's tangent magnitude is (p2 - p0) / 6, which overshoots
// when the previous gap is much larger than this one — packets with irregular
// timing then produce a band that loops back on itself. To keep the curve
// monotone in X without putting a hard kink at the clamp threshold, we scale
// BOTH x and y components of the tangent by the same factor whenever the x
// component would extend past the segment's far point. That preserves the
// tangent direction and just shortens the arm, so naturally smooth curves
// stay smooth and only overshooting ones taper in.
function catmullRomTo(ctx, points, start = true) {
  if (points.length === 0) return;
  if (start) ctx.moveTo(points[0].x, points[0].y);
  else ctx.lineTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    // Magnitudes so the same logic works for both ascending traversal (upper
    // half of the band) and the reversed descending traversal (lower half).
    const segDxAbs = Math.abs(p2.x - p1.x);
    const cp1xRaw = (p2.x - p0.x) / 6;
    const cp1yRaw = (p2.y - p0.y) / 6;
    const cp1xAbs = Math.abs(cp1xRaw);
    const cp1Scale = cp1xAbs > segDxAbs ? segDxAbs / cp1xAbs : 1;
    const cp2xRaw = (p3.x - p1.x) / 6;
    const cp2yRaw = (p3.y - p1.y) / 6;
    const cp2xAbs = Math.abs(cp2xRaw);
    const cp2Scale = cp2xAbs > segDxAbs ? segDxAbs / cp2xAbs : 1;
    const cp1x = p1.x + cp1xRaw * cp1Scale;
    const cp1y = p1.y + cp1yRaw * cp1Scale;
    const cp2x = p2.x - cp2xRaw * cp2Scale;
    const cp2y = p2.y - cp2yRaw * cp2Scale;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

// Pick "nice" round-number tick values for an axis range. Targets ~`count`
// ticks and rounds the step to 1, 2, 5, or 10 × power of ten.
function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const rough = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  step *= mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

function buildScales({ width, height, xDomain, yMin, yMax }) {
  if (!width || !height) return null;
  if (yMax === yMin) yMax = yMin + 1;
  const xLeft = plotLeftFor(width);
  const xRight = width - PLOT_RIGHT;
  const yTop = PLOT_TOP;
  const yBottom = height;
  const [xMin, xMax] = xDomain;
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax === xMin) return null;
  const xScale = (v) => xLeft + ((v - xMin) / (xMax - xMin)) * (xRight - xLeft);
  const yScale = (v) => yTop + (1 - (v - yMin) / (yMax - yMin)) * (yBottom - yTop);
  return { xLeft, xRight, yTop, yBottom, xMin, xMax, yMin, yMax, xScale, yScale };
}

function drawGrid(ctx, scales, colors, yTicks) {
  const { xLeft, xRight, yTop, yBottom, yScale } = scales;
  ctx.save();
  ctx.strokeStyle = colors?.grid ?? "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const t of yTicks) {
    const y = Math.round(yScale(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(xLeft, y);
    ctx.lineTo(xRight, y);
    ctx.stroke();
  }
  ctx.restore();
  // Solid plot frame on the y-axis edge so labels feel anchored.
  ctx.save();
  ctx.strokeStyle = colors?.grid ?? "#e5e7eb";
  ctx.lineWidth = 1;
  const xLine = Math.round(xLeft) + 0.5;
  ctx.beginPath();
  ctx.moveTo(xLine, yTop);
  ctx.lineTo(xLine, yBottom);
  ctx.stroke();
  ctx.restore();
}

function drawYAxisLabels(ctx, scales, ticks, colors) {
  ctx.save();
  ctx.font = "11px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors?.tickText ?? "#6b7280";
  for (const t of ticks) {
    const y = scales.yScale(t);
    ctx.fillText(`${Math.round(t)} dBm`, scales.xLeft - 8, y);
  }
  ctx.restore();
}

function drawRefLine(ctx, scales, ts, color) {
  const x = scales.xScale(ts);
  if (x < scales.xLeft || x > scales.xRight) return;
  ctx.save();
  ctx.strokeStyle = color ?? "#e5e7eb";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  const xLine = Math.round(x) + 0.5;
  ctx.moveTo(xLine, scales.yTop);
  ctx.lineTo(xLine, scales.yBottom);
  ctx.stroke();
  ctx.restore();
}

function drawBand(ctx, scales, hoveredPts, color, progress) {
  if (!hoveredPts.length || progress <= 0 || !color) return;
  // Caller pre-sorts by timestamp so we don't re-sort every rAF frame.
  const sp = hoveredPts.map((p) => ({
    x: scales.xScale(p.timestamp),
    rssi: p.rssi,
    hwDb: halfWidthForSnr(p.snr),
  }));

  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18 * progress;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 2]);

  if (sp.length === 1) {
    const p = sp[0];
    const r = ((scales.yScale(p.rssi - p.hwDb) - scales.yScale(p.rssi + p.hwDb)) / 2) * progress;
    ctx.beginPath();
    ctx.arc(p.x, scales.yScale(p.rssi), Math.max(2, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.45 * progress;
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Project to upper/lower yScales; halfWidthForSnr scaled by progress so the
  // band visibly grows outward from the centerline as the user hovers.
  const projected = sp.map((p) => ({
    x: p.x,
    yUp: scales.yScale(p.rssi + p.hwDb * progress),
    yDn: scales.yScale(p.rssi - p.hwDb * progress),
  }));
  const first = projected[0];
  const last = projected[projected.length - 1];
  const upper = [
    { x: scales.xLeft, y: first.yUp },
    ...projected.map((p) => ({ x: p.x, y: p.yUp })),
    { x: scales.xRight, y: last.yUp },
  ];
  const lower = [
    { x: scales.xRight, y: last.yDn },
    ...projected.slice().reverse().map((p) => ({ x: p.x, y: p.yDn })),
    { x: scales.xLeft, y: first.yDn },
  ];
  ctx.beginPath();
  catmullRomTo(ctx, upper);
  catmullRomTo(ctx, lower, false);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.45 * progress;
  ctx.stroke();
  ctx.restore();
}

function drawDots(ctx, points, scales, hoveredId, hoveredPacketId, dimProgress, pulses, nowMs) {
  // Two passes so dimmed dots paint underneath bright ones — important when
  // tracks overlap and the hovered track should visually rise above others.
  // Iterate the input array twice rather than partitioning into temp arrays
  // so we don't allocate per frame.
  ctx.save();
  // Tween dim opacity so other tracks fade in/out instead of snapping.
  const dimAlpha = 0.9 - 0.75 * dimProgress;
  ctx.globalAlpha = dimAlpha;
  for (const p of points) {
    if (hoveredId == null || p.trackId === hoveredId) continue;
    ctx.fillStyle = p.frameType === "ConfirmedUp" ? p.fillDark : p.fillLight;
    ctx.beginPath();
    ctx.arc(scales.xScale(p.timestamp), scales.yScale(p.rssi), DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.9;
  for (const p of points) {
    if (hoveredId != null && p.trackId !== hoveredId) continue;
    ctx.fillStyle = p.frameType === "ConfirmedUp" ? p.fillDark : p.fillLight;
    const r = p._id === hoveredPacketId ? DOT_RADIUS_HOVERED : DOT_RADIUS;
    ctx.beginPath();
    ctx.arc(scales.xScale(p.timestamp), scales.yScale(p.rssi), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Pulse rings on packets that entered the chart since last frame. Painted
  // last so they sit above all dots.
  if (pulses && pulses.size) {
    for (const p of points) {
      const start = pulses.get(p._id);
      if (start == null) continue;
      const t = (nowMs - start) / PULSE_DURATION_MS;
      if (t >= 1 || t < 0) continue;
      const color = p.frameType === "ConfirmedUp" ? p.fillDark : p.fillLight;
      drawPulse(ctx, scales.xScale(p.timestamp), scales.yScale(p.rssi), t, color);
    }
  }
}

// Cursor inside the current hover band? Used to keep hover sticky once a track
// is selected — the user can move through the band's full vertical extent
// without losing the highlight, only releasing when the cursor leaves the
// envelope. Returns false until the band has fully grown so initial hover
// entry still happens via dot-radius hit-test.
function pointInBand(cx, cy, hoveredPts, scales, progress) {
  if (!hoveredPts.length || progress <= 0) return false;
  if (cx < scales.xLeft || cx > scales.xRight) return false;
  // Caller pre-sorts by timestamp.
  let prev = null;
  let next = null;
  for (const p of hoveredPts) {
    const px = scales.xScale(p.timestamp);
    if (px <= cx) prev = { p, px };
    else { next = { p, px }; break; }
  }
  let rssi;
  let hwDb;
  if (prev && next) {
    const t = (cx - prev.px) / (next.px - prev.px);
    rssi = prev.p.rssi + t * (next.p.rssi - prev.p.rssi);
    const a = halfWidthForSnr(prev.p.snr);
    const b = halfWidthForSnr(next.p.snr);
    hwDb = a + t * (b - a);
  } else if (prev) {
    rssi = prev.p.rssi;
    hwDb = halfWidthForSnr(prev.p.snr);
  } else if (next) {
    rssi = next.p.rssi;
    hwDb = halfWidthForSnr(next.p.snr);
  } else {
    return false;
  }
  const yUp = scales.yScale(rssi + hwDb * progress);
  const yDn = scales.yScale(rssi - hwDb * progress);
  return cy >= yUp - 1 && cy <= yDn + 1;
}

function drawPulse(ctx, x, y, t, color) {
  // Ease-out so the pulse springs out fast then relaxes. alpha and radius
  // both animate from 0..1 of t.
  const eased = 1 - (1 - t) * (1 - t);
  const r = DOT_RADIUS + (PULSE_MAX_R - DOT_RADIUS) * eased;
  ctx.save();
  ctx.globalAlpha = (1 - eased) * 0.7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawFcntLabels(ctx, scales, hoveredPts, color, isDark, progress) {
  if (!hoveredPts.length || progress <= 0 || !color) return;
  ctx.save();
  ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.globalAlpha = progress;
  ctx.strokeStyle = isDark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.85)";
  ctx.fillStyle = color;
  for (const p of hoveredPts) {
    if (p.fcnt == null) continue;
    const x = scales.xScale(p.timestamp);
    const y = scales.yScale(p.rssi) - 8;
    ctx.strokeText(String(p.fcnt), x, y);
    ctx.fillText(String(p.fcnt), x, y);
  }
  ctx.restore();
}

// Relative time label for X-axis ticks. The right edge of the chart is
// always anchored to "now" (Date.now() / xRange.xMax), so the labels read
// as offsets into the past — easier to scan at a glance than HH:MM:SS,
// and shorter so we fit more ticks on a narrow viewport.
export function formatTimeTick(ts, now) {
  const diff = Math.max(0, now - ts);
  if (diff < 5_000) return "now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  const min = diff / 60_000;
  if (min < 60) return `${Math.round(min)}m ago`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// `~` prefix signals a rounded estimate — exact precision isn't useful for an
// observed inter-arrival interval.
function formatInterval(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `~${Math.round(ms / 1000)}s`;
  const min = ms / 60_000;
  if (min < 60) return `~${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `~${Math.round(h)}h`;
  return `~${Math.round(h / 24)}d`;
}

// When a hovered dot is past this fraction of the chart width, anchor the
// tooltip to its right edge so it doesn't clip off the chart.
const TOOLTIP_FLIP_THRESHOLD = 0.65;

function HoverTooltip({ hover }) {
  if (!hover) return null;
  const p = hover.payload;
  const netIdInfo = p.devAddr ? devAddrToNetId(p.devAddr) : null;
  const operator = netIdInfo?.netId ? netIdToOperator(netIdInfo.netId) : null;
  const label = `${operator ?? netIdInfo?.netId ?? "Unknown NetID"} · ${p.devAddr} · ${p.trackId}`;
  const flipRight = hover.x > hover.hostWidth * TOOLTIP_FLIP_THRESHOLD;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface-raised/90 px-3 py-2 text-xs shadow-soft "
      style={{
        left: flipRight ? undefined : hover.x + 12,
        right: flipRight ? `calc(100% - ${hover.x - 12}px)` : undefined,
        top: Math.max(0, hover.y - 48),
      }}
    >
      <div className="font-medium text-content-primary">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-content-secondary">
        <span>{new Date(p.timestamp).toLocaleTimeString()}</span>
        <span className="text-right">{p.rssi} dBm</span>
        {p.fcnt != null && <><span>FCnt</span><span className="text-right">{p.fcnt}</span></>}
        {p.snr != null && <><span>SNR</span><span className="text-right">{p.snr.toFixed(1)} dB</span></>}
        {p.sf && <><span>SF</span><span className="text-right">{p.sf}</span></>}
        {p.size != null && <><span>Size</span><span className="text-right">{p.size} B</span></>}
        {hover.intervalMs != null && (
          <><span>Interval</span><span className="text-right">{formatInterval(hover.intervalMs)}</span></>
        )}
      </div>
    </div>
  );
}

export default function PacketScatter({
  packets,
  segmenter,
  loading,
  netIdFilter = "all",
  trackFilter = "all",
  visibleTypes,
  xDomain,
  hover,
  setHover,
  onPickPacket,
}) {
  const isDark = useDarkMode();
  const hoveredId = hover?.trackId ?? null;
  const chartColors = useMemo(readChartColors, [isDark]);

  // Flat point list, gated by visibleTypes + filter chain. Joins/downlinks
  // live in the events bar instead, so they're skipped here.
  const visiblePoints = useMemo(() => {
    const out = [];
    for (const pkt of packets) {
      const tid = pkt._trackId;
      if (!tid || tid === "joins" || tid === "downlinks") continue;
      if (visibleTypes && pkt.frame_type && visibleTypes[pkt.frame_type] === false) continue;
      if (netIdFilter !== "all" && pkt._netId !== netIdFilter) continue;
      if (trackFilter !== "all" && tid !== trackFilter) continue;
      const netId = pkt._netId ?? null;
      out.push({
        timestamp: pkt.timestamp,
        rssi: pkt.rssi,
        devAddr: pkt.dev_addr,
        fcnt: pkt.fcnt,
        snr: pkt.snr,
        sf: pkt.spreading_factor,
        size: pkt.payload_size,
        frameType: pkt.frame_type,
        trackId: tid,
        netId,
        _id: pkt._id,
        _new: pkt._new === true,
        fillLight: colorForNetIdShade(netId, false, isDark),
        fillDark: colorForNetIdShade(netId, true, isDark),
      });
    }
    return out;
  }, [packets, isDark, visibleTypes, netIdFilter, trackFilter]);

  const trackColorById = useMemo(() => {
    const map = new Map();
    for (const p of visiblePoints) {
      if (!map.has(p.trackId)) {
        const dummyTrack = { netId: p.netId };
        map.set(p.trackId, colorForTrack(dummyTrack, isDark));
      }
    }
    return map;
  }, [visiblePoints, isDark]);

  // Pre-sorted by timestamp once per hover change; the sort is reused
  // every rAF frame inside drawBand and on every pointer move inside
  // pointInBand, so caching it here avoids an n·log·n on the hot path.
  const hoveredPoints = useMemo(() => {
    if (!hoveredId) return [];
    return visiblePoints
      .filter((p) => p.trackId === hoveredId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [hoveredId, visiblePoints]);

  // Y range with ±3 dB padding (mirrors recharts' "dataMin - 3" / "dataMax + 3").
  const yRange = useMemo(() => {
    if (visiblePoints.length === 0) return null;
    let yMin = Infinity, yMax = -Infinity;
    for (const p of visiblePoints) {
      if (p.rssi < yMin) yMin = p.rssi;
      if (p.rssi > yMax) yMax = p.rssi;
    }
    return { yMin: yMin - 3, yMax: yMax + 3 };
  }, [visiblePoints]);

  // xDomain prop wins; fall back to data extents so the chart still renders
  // when the parent hasn't computed a domain yet.
  const effXDomain = useMemo(() => {
    if (xDomain) return xDomain;
    if (visiblePoints.length === 0) return null;
    let xMin = Infinity, xMax = -Infinity;
    for (const p of visiblePoints) {
      if (p.timestamp < xMin) xMin = p.timestamp;
      if (p.timestamp > xMax) xMax = p.timestamp;
    }
    return [xMin, xMax === xMin ? xMax + 1 : xMax];
  }, [xDomain, visiblePoints]);

  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // contentRect (vs getBoundingClientRect) excludes padding, so size already
  // matches the canvas's inner area whatever the wrapper's responsive
  // padding ends up at.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = size.w;
  const innerH = size.h;

  const yTicks = useMemo(() => yRange ? niceTicks(yRange.yMin, yRange.yMax, 5) : [], [yRange]);

  // Live scales: xMax is always Date.now() so the chart visibly slides left
  // as time passes, even between SSE-delivered packets. xMin stays anchored
  // to the earliest visible packet (via effXDomain[0]).
  const getScales = useCallback(() => {
    if (!yRange || !effXDomain || !innerW || !innerH) return null;
    return buildScales({
      width: innerW,
      height: innerH,
      xDomain: [effXDomain[0], Date.now()],
      yMin: yRange.yMin,
      yMax: yRange.yMax,
    });
  }, [innerW, innerH, effXDomain, yRange]);

  // Animation state in refs so frames don't trigger React work.
  // - progress: hover-band tween 0..1
  // - seenIds / pulses: tracks new arrivals so we can ring-pulse them once
  const animRef = useRef({ progress: 0, raf: 0, lastT: 0 });
  // pulses: Map<_id, startMs> for active pulse rings.
  // processed: Set<_id> of packets we've already registered (or skipped because
  // they weren't new), so we don't re-pulse on every render.
  const seenRef = useRef({ pulses: new Map(), processed: new Set() });
  // Latest render inputs read by the rAF tick. Mirroring data through a ref
  // lets the rAF stay alive across React renders — its useEffect deps are
  // empty, so prop churn (xDomain ticks every 250ms, etc.) doesn't tear
  // down and restart the animation chain.
  const stateRef = useRef({});
  stateRef.current = {
    canvasRef, innerW, innerH, chartColors, yTicks, getScales,
    hover, hoveredId, hoveredPoints, trackColorById, visiblePoints, isDark,
  };

  // Pulse only packets that arrived via SSE while the user was watching —
  // the parent flags those with `_new: true`. Initial fetch packets carry
  // `_new: false` and don't pulse. Each id is processed once (start time
  // recorded on first sighting), so re-renders don't restart the animation.
  useEffect(() => {
    const cur = seenRef.current;
    const now = performance.now();
    for (const p of visiblePoints) {
      if (cur.processed.has(p._id)) continue;
      cur.processed.add(p._id);
      if (p._new) cur.pulses.set(p._id, now);
    }
    for (const [id, start] of cur.pulses) {
      if (now - start > PULSE_DURATION_MS) cur.pulses.delete(id);
    }
  }, [visiblePoints]);

  // Continuous rAF loop. Reads latest data from stateRef so the loop never
  // tears down — needed for buttery time-axis scrolling at 60fps.
  useEffect(() => {
    const tick = (t) => {
      const s = stateRef.current;
      const canvas = s.canvasRef.current;
      const scales = s.getScales();
      if (canvas && scales) {
        // Tween hover progress.
        const dt = animRef.current.lastT ? t - animRef.current.lastT : 16;
        animRef.current.lastT = t;
        const target = s.hoveredId ? 1 : 0;
        const cur = animRef.current.progress;
        const delta = dt / BAND_TWEEN_MS;
        animRef.current.progress = cur < target
          ? Math.min(target, cur + delta)
          : Math.max(target, cur - delta);

        const dpr = window.devicePixelRatio || 1;
        const w = s.innerW;
        const h = s.innerH;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        drawGrid(ctx, scales, s.chartColors, s.yTicks);
        drawYAxisLabels(ctx, scales, s.yTicks, s.chartColors);
        if (s.hover) drawRefLine(ctx, scales, s.hover.payload.timestamp, s.chartColors?.grid);
        const progress = animRef.current.progress;
        const hoverColor = s.hoveredId ? s.trackColorById.get(s.hoveredId) : null;
        if (s.hoveredId) drawBand(ctx, scales, s.hoveredPoints, hoverColor, progress);
        drawDots(
          ctx, s.visiblePoints, scales, s.hoveredId, s.hover?.payload?._id ?? null,
          progress, seenRef.current.pulses, performance.now(),
        );
        if (s.hoveredId) drawFcntLabels(ctx, scales, s.hoveredPoints, hoverColor, s.isDark, progress);
      }
      animRef.current.raf = requestAnimationFrame(tick);
    };
    animRef.current.lastT = 0;
    animRef.current.raf = requestAnimationFrame(tick);
    return () => {
      if (animRef.current.raf) cancelAnimationFrame(animRef.current.raf);
      animRef.current.raf = 0;
    };
  }, []);

  const setHoverFor = (pt, scales) => {
    const track = segmenter.tracks.get(pt.trackId);
    const intervalMs = track && track.count > 1
      ? (track.lastTs - track.firstTs) / (track.count - 1)
      : null;
    // x/y reported in HOST coords (canvas coords + the canvas's offset
    // inside the wrapper) so the absolute-positioned HoverTooltip lands at
    // the dot. Canvas inset is responsive (0 on mobile, 8 on sm+) so we
    // read offsetLeft/offsetTop instead of hard-coding.
    const canvas = canvasRef.current;
    const offsetLeft = canvas?.offsetLeft ?? 0;
    const offsetTop = canvas?.offsetTop ?? 0;
    setHover({
      source: "chart",
      trackId: pt.trackId,
      payload: pt,
      intervalMs,
      x: scales.xScale(pt.timestamp) + offsetLeft,
      y: scales.yScale(pt.rssi) + offsetTop,
      hostWidth: size.w,
    });
  };

  // Find the visiblePoints entry closest to canvas-local (cx, cy), or null
  // if nothing is within HIT_RADIUS. Pulled out so onPointerMove and onClick
  // (the touch-tap path) share the same hit logic.
  const hitTest = (cx, cy, scales) => {
    if (cx < scales.xLeft - HIT_RADIUS || cx > scales.xRight + HIT_RADIUS) return null;
    let bestPt = null;
    let bestD = HIT_RADIUS_SQ;
    for (const p of visiblePoints) {
      const dx = scales.xScale(p.timestamp) - cx;
      const dy = scales.yScale(p.rssi) - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        bestPt = p;
      }
    }
    return bestPt;
  };

  const onPointerMove = (e) => {
    const scales = getScales();
    if (!scales) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const progress = animRef.current.progress;

    // Sticky hover: once a track is selected the user can move freely within
    // its band envelope without losing the highlight. Switch the tooltip's
    // anchor to whichever dot in the same track is closest to the cursor.
    if (
      hover &&
      hover.source === "chart" &&
      pointInBand(cx, cy, hoveredPoints, scales, progress)
    ) {
      let bestPt = null;
      let bestD = Infinity;
      for (const p of hoveredPoints) {
        const dx = scales.xScale(p.timestamp) - cx;
        const dy = scales.yScale(p.rssi) - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          bestPt = p;
        }
      }
      if (bestPt && bestPt._id !== hover.payload._id) setHoverFor(bestPt, scales);
      return;
    }

    const hit = hitTest(cx, cy, scales);
    if (hit) {
      if (hover && hover.payload._id === hit._id) return;
      setHoverFor(hit, scales);
    } else if (hover && hover.source === "chart") {
      setHover(null);
    }
  };

  // Tracks the last pointer type so the click handler can skip the
  // pin-and-scroll for touch — auto-scrolling the page on a tap fights
  // the user's natural scroll gesture and feels jarring on mobile.
  const lastPointerTypeRef = useRef("mouse");
  const onPointerDown = (e) => {
    lastPointerTypeRef.current = e.pointerType;
  };

  // Tap path: on mouse, pointermove has already set hover before click runs.
  // On touch, pointermove may not fire before pointerup (a tap barely moves),
  // so do the hit-test here ourselves and set hover before pinning.
  const onClick = (e) => {
    const scales = getScales();
    if (!scales) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const hit = hitTest(cx, cy, scales);
    if (hit) {
      setHoverFor(hit, scales);
      // Touch-tap shows the tooltip + dims other tracks but doesn't pin
      // (which would scroll the page to the matching row).
      if (lastPointerTypeRef.current !== "touch") onPickPacket?.(hit._id);
    }
  };

  const hasData = visiblePoints.length > 0;

  return (
    <div
      ref={hostRef}
      className="relative h-64 px-0 pb-0 pt-3 sm:px-2"
      data-chart-host
      onMouseLeave={() => {
        if (hover && hover.source === "chart") setHover(null);
      }}
    >
      {loading ? (
        <div className="flex h-full items-center justify-center text-sm text-content-tertiary">
          Loading...
        </div>
      ) : !hasData ? (
        <div className="flex h-full items-center justify-center text-sm text-content-tertiary">
          No uplinks to chart yet.
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          // Inset matches the wrapper's responsive padding (px-0 → no horizontal
          // inset on mobile, px-2 → 8px on sm+). top-3 mirrors the wrapper's
          // pt-3. touch-action: pan-y keeps vertical page scroll working but
          // lets the chart capture horizontal touch drags so the user can
          // scrub through dots with a finger.
          className={`absolute left-0 right-0 top-3 sm:left-2 sm:right-2 ${
            hover?.source === "chart" ? "cursor-pointer" : ""
          }`}
          style={{ touchAction: "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={(e) => {
            // Touch end fires pointerleave; clearing hover there would cancel
            // a tap-to-pin before the click handler runs. Mouse exit still
            // clears as before.
            if (e.pointerType === "touch") return;
            if (hover && hover.source === "chart") setHover(null);
          }}
          onClick={onClick}
        />
      )}
      {hover && hover.source === "chart" && <HoverTooltip hover={hover} />}
    </div>
  );
}
