import { useEffect, useMemo, useRef, useState } from "react";
import useDarkMode from "../lib/useDarkMode.js";
import { readChartColors } from "../lib/chartColors.js";
import { formatTimeTick } from "./PacketScatter.jsx";

// Two-lane timeline of join + downlink events. Shares its X axis with
// PacketScatter so the vertical correlation cursor lines up across both.
//
// We don't render through recharts here because the bar has no Y dimension
// and the markers are tiny — a plain SVG keeps the surface simple. The trick
// to staying aligned with the chart's X scale is mirroring its plot-area
// margins (yAxis width + chart margin.left on the left, chart margin.right
// on the right). If those margins change in PacketScatter, update them here.

const LANE_H = 14;
const MARKER_R = 4;
const VPAD = 6;
const TICK_H = 18; // axis labels live here, below the markers
const TOTAL_H = LANE_H * 2 + VPAD * 2 + TICK_H;
const TICK_COUNT = 5; // evenly spaced across the visible time range

const PLOT_LEFT = 78;   // recharts YAxis width 70 + ScatterChart margin.left 8
const PLOT_RIGHT = 16;  // ScatterChart margin.right

const JOIN_TYPES = new Set(["JoinRequest", "JoinAccept", "RejoinRequest", "Proprietary"]);
const DOWN_TYPES = new Set(["UnconfirmedDown", "ConfirmedDown"]);

// Joins/downlinks aren't device-correlatable so they stay on a fixed palette
// rather than the NetID family used by uplink dots.
const JOIN_COLOR = { light: "#8b5cf6", dark: "#a78bfa" }; // violet 500 / 400
const DOWN_COLOR = { light: "#0ea5e9", dark: "#38bdf8" }; // sky 500 / 400

const trianglePath = (cx, cy, r) =>
  `M ${cx - r} ${cy - r} L ${cx + r} ${cy - r} L ${cx} ${cy + r} Z`;
const diamondPath = (cx, cy, r) =>
  `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;

function buildHover(pkt) {
  return {
    source: "events",
    trackId: null,
    payload: { ...pkt, devAddr: pkt.dev_addr, frameType: pkt.frame_type },
    intervalMs: null,
  };
}

function Lane({ events, y, fill, shape, hover, setHover, xScale }) {
  return events.map((pkt) => {
    const cx = xScale(pkt.timestamp);
    const dim = hover && hover.source === "events" && hover.payload._id !== pkt._id;
    return (
      <path
        key={pkt._id}
        d={shape(cx, y, MARKER_R)}
        fill={fill}
        fillOpacity={dim ? 0.25 : 0.85}
        onMouseEnter={() => setHover(buildHover(pkt))}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: "pointer" }}
      />
    );
  });
}

export default function EventsBar({ packets, visibleTypes, xDomain, hover, setHover }) {
  const isDark = useDarkMode();
  const chartColors = useMemo(readChartColors, [isDark]);
  const svgRef = useRef(null);
  const [svgWidth, setSvgWidth] = useState(0);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width));
    ro.observe(el);
    setSvgWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Domain comes from the parent so it's identical to the scatter's. If the
  // parent passes nothing (no uplinks visible), fall back to packet extents
  // so the bar can still render its joins/downlinks meaningfully.
  const xRange = useMemo(() => {
    if (xDomain) return { xMin: xDomain[0], xMax: xDomain[1] };
    if (packets.length === 0) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const p of packets) {
      if (p.timestamp < xMin) xMin = p.timestamp;
      if (p.timestamp > xMax) xMax = p.timestamp;
    }
    if (xMin === xMax) xMax = xMin + 1;
    return { xMin, xMax };
  }, [packets, xDomain]);

  const events = useMemo(() => {
    const joins = [];
    const downs = [];
    for (const pkt of packets) {
      const t = pkt.frame_type;
      if (!t) continue;
      if (visibleTypes && visibleTypes[t] === false) continue;
      if (JOIN_TYPES.has(t)) joins.push(pkt);
      else if (DOWN_TYPES.has(t)) downs.push(pkt);
    }
    return { joins, downs };
  }, [packets, visibleTypes]);

  const hasEvents = xRange && (events.joins.length > 0 || events.downs.length > 0);
  const joinY = VPAD + LANE_H / 2;
  const downY = VPAD + LANE_H + LANE_H / 2;
  const joinFill = isDark ? JOIN_COLOR.dark : JOIN_COLOR.light;
  const downFill = isDark ? DOWN_COLOR.dark : DOWN_COLOR.light;
  const xScale = (ts) => {
    if (!xRange) return PLOT_LEFT;
    const t = (ts - xRange.xMin) / (xRange.xMax - xRange.xMin);
    // Clamp inner width so the scale stays sane while the SVG is being sized
    // (initial layout, narrow containers) — otherwise the term goes negative
    // and markers fly off to the left.
    const innerWidth = Math.max(1, svgWidth - PLOT_LEFT - PLOT_RIGHT);
    return PLOT_LEFT + t * innerWidth;
  };
  const cursorX = hover && xRange ? xScale(hover.payload.timestamp) : null;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={TOTAL_H}
      className="block border-t border-border"
    >
      {svgWidth > 0 && hasEvents && (
        <>
          <line
            x1={PLOT_LEFT} x2={svgWidth - PLOT_RIGHT}
            y1={joinY} y2={joinY}
            stroke={chartColors?.grid} strokeOpacity={0.4} strokeWidth={0.5}
          />
          <line
            x1={PLOT_LEFT} x2={svgWidth - PLOT_RIGHT}
            y1={downY} y2={downY}
            stroke={chartColors?.grid} strokeOpacity={0.4} strokeWidth={0.5}
          />
          <text
            x={PLOT_LEFT - 6} y={joinY + 3}
            textAnchor="end" fontSize={10}
            fill={chartColors?.tickText}
          >Joins</text>
          <text
            x={PLOT_LEFT - 6} y={downY + 3}
            textAnchor="end" fontSize={10}
            fill={chartColors?.tickText}
          >Downs</text>

          {cursorX != null && (
            <line
              x1={cursorX} x2={cursorX} y1={0} y2={TOTAL_H}
              stroke={chartColors?.grid} strokeDasharray="3 3"
            />
          )}

          <Lane events={events.joins} y={joinY} fill={joinFill} shape={trianglePath} hover={hover} setHover={setHover} xScale={xScale} />
          <Lane events={events.downs} y={downY} fill={downFill} shape={diamondPath} hover={hover} setHover={setHover} xScale={xScale} />

          {/* Time-axis tick labels for the whole chart+events stack — the
              chart hides its own X labels so they only render here. */}
          {Array.from({ length: TICK_COUNT }, (_, i) => {
            const t = i / (TICK_COUNT - 1);
            const ts = xRange.xMin + t * (xRange.xMax - xRange.xMin);
            const x = xScale(ts);
            return (
              <text
                key={i}
                x={x}
                y={TOTAL_H - 4}
                textAnchor={i === 0 ? "start" : i === TICK_COUNT - 1 ? "end" : "middle"}
                fontSize={11}
                fill={chartColors?.tickText}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {formatTimeTick(ts)}
              </text>
            );
          })}
        </>
      )}
    </svg>
  );
}
