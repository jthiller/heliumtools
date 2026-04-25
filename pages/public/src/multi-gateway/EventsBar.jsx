import { useEffect, useMemo, useRef, useState } from "react";
import useDarkMode from "../lib/useDarkMode.js";
import { readChartColors } from "../lib/chartColors.js";
import { formatTimeTick, PLOT_LEFT, PLOT_RIGHT, PULSE_DURATION_MS } from "./PacketScatter.jsx";

// Two-lane timeline of join + downlink events. Shares its X axis with
// PacketScatter — PLOT_LEFT and PLOT_RIGHT come from there so the chart's
// plot area and the events bar line up to the pixel.

const LANE_H = 14;
const MARKER_R = 4;
const VPAD = 6;
const TICK_H = 18; // axis labels live here, below the markers
const TICK_COUNT = 5; // evenly spaced across the visible time range

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

  // Pulse rings for joins/downs that arrive via SSE (parent flags those with
  // `_new: true`). Mirrors the chart's animation so chart and events bar
  // signal new data the same way. Each `_id` is processed once.
  const [pulses, setPulses] = useState([]);
  const seenRef = useRef(new Set());
  useEffect(() => {
    const newOnes = [];
    const allEvents = [...events.joins, ...events.downs];
    for (const pkt of allEvents) {
      if (seenRef.current.has(pkt._id)) continue;
      seenRef.current.add(pkt._id);
      if (pkt._new) {
        newOnes.push({
          id: pkt._id,
          timestamp: pkt.timestamp,
          lane: JOIN_TYPES.has(pkt.frame_type) ? "joins" : "downlinks",
        });
      }
    }
    if (!newOnes.length) return;
    setPulses((prev) => [...prev, ...newOnes]);
    const ids = new Set(newOnes.map((n) => n.id));
    const tid = setTimeout(() => {
      setPulses((prev) => prev.filter((p) => !ids.has(p.id)));
    }, PULSE_DURATION_MS + 50);
    return () => clearTimeout(tid);
  }, [events]);

  // Collapse lanes that have nothing to show. Tick labels (the chart's only
  // X-axis labels) must keep rendering even when both lanes are empty.
  const visibleLanes = [
    { label: "Joins", events: events.joins, fill: isDark ? JOIN_COLOR.dark : JOIN_COLOR.light, shape: trianglePath },
    { label: "Downlinks", events: events.downs, fill: isDark ? DOWN_COLOR.dark : DOWN_COLOR.light, shape: diamondPath },
  ].filter((l) => l.events.length > 0);
  const lanesTopPad = visibleLanes.length > 0 ? VPAD : 0;
  const totalH = lanesTopPad + visibleLanes.length * LANE_H + TICK_H;
  visibleLanes.forEach((l, i) => {
    l.y = lanesTopPad + i * LANE_H + LANE_H / 2;
  });
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
    // px-2 must mirror PacketScatter's chart wrapper inset so plot bounds line up.
    <div className="border-t border-border px-2">
      <svg
        ref={svgRef}
        width="100%"
        height={totalH}
        className="block"
      >
        {svgWidth > 0 && xRange && (
          <>
            {visibleLanes.map((l) => (
              <g key={l.label}>
                <line
                  x1={PLOT_LEFT} x2={svgWidth - PLOT_RIGHT}
                  y1={l.y} y2={l.y}
                  stroke={chartColors?.grid} strokeOpacity={0.4} strokeWidth={0.5}
                />
                <text
                  x={PLOT_LEFT - 6} y={l.y + 3}
                  textAnchor="end" fontSize={10}
                  fill={chartColors?.tickText}
                >{l.label}</text>
                <Lane events={l.events} y={l.y} fill={l.fill} shape={l.shape} hover={hover} setHover={setHover} xScale={xScale} />
              </g>
            ))}

            {pulses.map((p) => {
              const lane = visibleLanes.find((l) => l.label.toLowerCase() === p.lane);
              if (!lane) return null;
              return (
                <circle
                  key={p.id}
                  cx={xScale(p.timestamp)}
                  cy={lane.y}
                  r={MARKER_R}
                  fill="none"
                  stroke={lane.fill}
                  strokeWidth={2}
                  className="eventsbar-pulse"
                />
              );
            })}

            {cursorX != null && (
              <line
                x1={cursorX} x2={cursorX} y1={0} y2={totalH}
                stroke={chartColors?.grid} strokeDasharray="3 3"
              />
            )}

            {/* The chart hides its own X labels — these are the only time-axis
                labels for the chart+events stack. */}
            {Array.from({ length: TICK_COUNT }, (_, i) => {
              const t = i / (TICK_COUNT - 1);
              const ts = xRange.xMin + t * (xRange.xMax - xRange.xMin);
              const x = xScale(ts);
              return (
                <text
                  key={i}
                  x={x}
                  y={totalH - 4}
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
    </div>
  );
}
