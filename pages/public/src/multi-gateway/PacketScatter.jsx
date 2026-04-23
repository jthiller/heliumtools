import { useEffect, useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Customized,
  ResponsiveContainer,
  useActiveTooltipDataPoints,
} from "recharts";
// useXAxis/useYAxis return the internal d3 scale functions recharts uses for
// its own dot placement. Not exposed from recharts' public index; deep-import
// to guarantee our band/label overlays use the exact same projection as the
// dots they annotate.
import { useXAxis, useYAxis } from "recharts/es6/hooks";
import useDarkMode from "../lib/useDarkMode.js";
import { devAddrToNetId, netIdToOperator } from "../lib/lorawan.js";
import { readChartColors } from "../lib/chartColors.js";
import { dominantFrameType, listTracks } from "./segmentation.js";

function trackVisible(t, { netIdFilter, trackFilter }) {
  if (netIdFilter !== "all" && t.netId !== netIdFilter) return false;
  if (trackFilter !== "all" && t.id !== trackFilter) return false;
  return true;
}

function colorForTrack(track, isDark) {
  const palette = isDark ? FRAME_TYPE_HEX_DARK : FRAME_TYPE_HEX_LIGHT;
  const mode = dominantFrameType(track);
  return palette[mode] ?? (isDark ? "#d1d5db" : "#9ca3af");
}

// Per-packet dot colour — mirrors the FRAME_TYPES palette in MultiGateway.jsx
// (emerald / sky / violet families) so the chart reads the same as the table.
// Tailwind classes can't be used as SVG fills, so we hard-code the matching
// hex values. Dark-mode variants are lighter to stay legible on dark surfaces.
const FRAME_TYPE_HEX_LIGHT = {
  UnconfirmedUp: "#10b981",      // emerald-500
  ConfirmedUp: "#047857",        // emerald-700 (darker = confirmed)
  UnconfirmedDown: "#38bdf8",    // sky-400
  ConfirmedDown: "#0284c7",      // sky-600
  JoinRequest: "#8b5cf6",        // violet-500
  JoinAccept: "#6d28d9",         // violet-700
  RejoinRequest: "#a78bfa",      // violet-400
  Proprietary: "#9ca3af",        // gray-400
};
const FRAME_TYPE_HEX_DARK = {
  UnconfirmedUp: "#34d399",      // emerald-400
  ConfirmedUp: "#10b981",        // emerald-500
  UnconfirmedDown: "#7dd3fc",    // sky-300
  ConfirmedDown: "#38bdf8",      // sky-400
  JoinRequest: "#a78bfa",        // violet-400
  JoinAccept: "#8b5cf6",         // violet-500
  RejoinRequest: "#c4b5fd",      // violet-300
  Proprietary: "#d1d5db",        // gray-300
};

function colorForFrameType(frameType, isDark) {
  const palette = isDark ? FRAME_TYPE_HEX_DARK : FRAME_TYPE_HEX_LIGHT;
  return palette[frameType] ?? (isDark ? "#d1d5db" : "#9ca3af");
}

// SNR → half-band size (dB). LoRaWAN SNR floor is ~-20 dB (below demodulation
// limit); +10 dB is effectively excellent. Low SNR = more uncertain reception
// = wider band.
const SNR_BEST = 10;
const SNR_WORST = -20;
const HALF_WIDTH_MIN_DB = 1.5;
const HALF_WIDTH_MAX_DB = 10;

function halfWidthForSnr(snr) {
  if (snr == null || !Number.isFinite(snr)) return HALF_WIDTH_MAX_DB / 2;
  const t = Math.max(0, Math.min(1, (snr - SNR_WORST) / (SNR_BEST - SNR_WORST)));
  return HALF_WIDTH_MAX_DB - (HALF_WIDTH_MAX_DB - HALF_WIDTH_MIN_DB) * t;
}

// Catmull-Rom cubic-bezier interpolation through screen-space points.
// Endpoints duplicate the adjacent neighbour so tangents are well-defined.
function catmullRomPath(points) {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

// recharts drives tooltip state off its own internal active-index, not our
// <Scatter> onMouseEnter. Using that state as the source of truth for
// hoveredId keeps the tooltip, band, and fcnt labels all pointing at the
// same dot — otherwise a custom-shape circle and a series-level handler
// can resolve to different packets.
function HoverSync({ onChange }) {
  const points = useActiveTooltipDataPoints();
  const trackId = points?.[0]?.trackId ?? null;
  useEffect(() => {
    onChange(trackId);
  }, [trackId, onChange]);
  return null;
}

// `<Customized>` in recharts 3.x doesn't pass scales as props — pull them from
// the same hooks recharts uses internally to place dots, so our overlay and
// the dots share a single projection.
function useChartScales() {
  const xAxis = useXAxis(0);
  const yAxis = useYAxis(0);
  return useMemo(() => {
    const xScale = xAxis?.scale;
    const yScale = yAxis?.scale;
    if (!xScale || !yScale || typeof xScale.range !== "function") return null;
    const [xLeft, xRight] = xScale.range();
    return { xScale, yScale, xLeft, xRight };
  }, [xAxis, yAxis]);
}

// Draw fcnt above each dot of the hovered track. paint-order: stroke fill
// creates a halo so numbers stay legible over busy chart areas.
function FcntLabels({ hoveredId, pointsByTrack, color, isDark }) {
  const scales = useChartScales();
  if (!hoveredId || !color || !scales) return null;
  const pts = pointsByTrack.get(hoveredId);
  if (!pts || pts.length === 0) return null;
  const halo = isDark ? "#000000" : "#ffffff";
  return (
    <g pointerEvents="none">
      {pts.map((p, i) => {
        if (p.fcnt == null) return null;
        const x = scales.xScale(p.timestamp);
        const y = scales.yScale(p.rssi) - 8;
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            fontSize={10}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontWeight={600}
            fill={color}
            stroke={halo}
            strokeWidth={3}
            strokeOpacity={0.85}
            style={{ paintOrder: "stroke fill" }}
          >
            {p.fcnt}
          </text>
        );
      })}
    </g>
  );
}

// Filled, SNR-weighted band following the hovered track's packets.
// Extends to the full chart width; thickness varies per packet based on SNR.
function BandOverlay({ hoveredId, pointsByTrack, color }) {
  const scales = useChartScales();
  if (!hoveredId || !color || !scales) return null;
  const pts = pointsByTrack.get(hoveredId);
  if (!pts || pts.length === 0) return null;
  const { xScale, yScale, xLeft, xRight } = scales;

  const sorted = [...pts].sort((a, b) => a.timestamp - b.timestamp);
  const sp = sorted.map((p) => {
    const hwDb = halfWidthForSnr(p.snr);
    return {
      x: xScale(p.timestamp),
      yUp: yScale(p.rssi + hwDb),
      yDn: yScale(p.rssi - hwDb),
    };
  });

  const first = sp[0];
  const last = sp[sp.length - 1];
  const upperPts = [
    { x: xLeft, y: first.yUp },
    ...sp.map((p) => ({ x: p.x, y: p.yUp })),
    { x: xRight, y: last.yUp },
  ];
  const lowerPts = [
    { x: xLeft, y: first.yDn },
    ...sp.map((p) => ({ x: p.x, y: p.yDn })),
    { x: xRight, y: last.yDn },
  ];

  const upperD = catmullRomPath(upperPts);
  const lowerReversed = [...lowerPts].reverse();
  const lowerD = catmullRomPath(lowerReversed).replace(/^M /, "L ");
  const d = `${upperD} ${lowerD} Z`;

  return (
    <path
      d={d}
      fill={color}
      fillOpacity={0.18}
      stroke={color}
      strokeOpacity={0.45}
      strokeWidth={1}
      strokeDasharray="4 2"
      pointerEvents="none"
    />
  );
}

function formatTimeTick(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const netIdInfo = p.devAddr ? devAddrToNetId(p.devAddr) : null;
  const operator = netIdInfo?.netId ? netIdToOperator(netIdInfo.netId) : null;
  const label = `${operator ?? netIdInfo?.netId ?? "Unknown NetID"} · ${p.devAddr} · ${p.trackId}`;
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs shadow-soft">
      <div className="font-medium text-content-primary">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-content-secondary">
        <span>{new Date(p.timestamp).toLocaleTimeString()}</span>
        <span className="text-right">{p.rssi} dBm</span>
        {p.fcnt != null && <><span>FCnt</span><span className="text-right">{p.fcnt}</span></>}
        {p.snr != null && <><span>SNR</span><span className="text-right">{p.snr.toFixed(1)} dB</span></>}
        {p.sf && <><span>SF</span><span className="text-right">{p.sf}</span></>}
      </div>
    </div>
  );
}

export default function PacketScatter({ packets, segmenter, visibleTypes, loading }) {
  const isDark = useDarkMode();
  const [hoveredId, setHoveredId] = useState(null);
  const [netIdFilter, setNetIdFilter] = useState("all");
  const [trackFilter, setTrackFilter] = useState("all");

  // Only uplink device tracks are charted. Joins have no dev_addr/fcnt so they
  // can't be segmented; downlinks have no meaningful RSSI on the gateway side.
  const tracks = useMemo(() => {
    return listTracks(segmenter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmenter, packets]);

  const trackColorById = useMemo(() => {
    const map = new Map();
    for (const t of tracks) map.set(t.id, colorForTrack(t, isDark));
    return map;
  }, [tracks, isDark]);

  const chartColors = useMemo(readChartColors, [isDark]);

  const netIdOptions = useMemo(() => {
    const set = new Set();
    for (const t of tracks) if (t.netId) set.add(t.netId);
    return [...set].sort();
  }, [tracks]);

  const trackOptions = useMemo(() => {
    const list = tracks.filter((t) => {
      if (netIdFilter !== "all" && t.netId !== netIdFilter) return false;
      return t.count > 0;
    });
    list.sort((a, b) => b.count - a.count);
    return list;
  }, [tracks, netIdFilter]);

  // If the selected device disappears (NetID filter changed, or track was evicted), reset.
  useEffect(() => {
    if (trackFilter !== "all" && !trackOptions.some((t) => t.id === trackFilter)) {
      setTrackFilter("all");
    }
  }, [trackOptions, trackFilter]);

  // Group packets into per-track arrays for recharts Scatter series
  const pointsByTrack = useMemo(() => {
    const map = new Map();
    for (const pkt of packets) {
      const tid = pkt._trackId;
      if (!tid) continue;
      if (!map.has(tid)) map.set(tid, []);
      map.get(tid).push({
        timestamp: pkt.timestamp,
        rssi: pkt.rssi,
        devAddr: pkt.dev_addr,
        fcnt: pkt.fcnt,
        snr: pkt.snr,
        sf: pkt.spreading_factor,
        frameType: pkt.frame_type,
        trackId: tid,
      });
    }
    return map;
  }, [packets]);

  const filterOpts = { netIdFilter, trackFilter };
  const visibleTracks = tracks.filter((t) => trackVisible(t, filterOpts));
  const hasData = visibleTracks.some((t) => (pointsByTrack.get(t.id)?.length ?? 0) > 0);

  const deviceCount = tracks.filter((t) => t.count > 0).length;
  const spanLabel = useMemo(() => {
    if (packets.length === 0) return null;
    let minTs = Infinity, maxTs = -Infinity;
    for (const p of packets) {
      if (p.timestamp < minTs) minTs = p.timestamp;
      if (p.timestamp > maxTs) maxTs = p.timestamp;
    }
    const ms = maxTs - minTs;
    if (ms < 60_000) return "<1 min";
    const min = Math.round(ms / 60_000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min - h * 60;
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }, [packets]);

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-raised shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-content-primary">
          {deviceCount === 1 ? "1 Estimated Device" : `${deviceCount} Estimated Devices`}
          {spanLabel && (
            <span className="ml-2 text-xs font-normal text-content-tertiary">
              ({spanLabel})
            </span>
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-content-secondary">
            NetID
            <select
              value={netIdFilter}
              onChange={(e) => setNetIdFilter(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary focus:border-accent focus:outline-none"
            >
              <option value="all">All</option>
              {netIdOptions.map((id) => (
                <option key={id} value={id}>
                  {netIdToOperator(id) ?? id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-content-secondary">
            Device
            <select
              value={trackFilter}
              onChange={(e) => setTrackFilter(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary focus:border-accent focus:outline-none"
            >
              <option value="all">All</option>
              {trackOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.devAddr} · {t.id} (n={t.count}, ~{Math.round(t.rssiMean)} dBm)
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="h-64 px-2 py-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-content-tertiary">
            Loading...
          </div>
        ) : !hasData ? (
          <div className="flex h-full items-center justify-center text-sm text-content-tertiary">
            No packets to chart yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors?.grid} />
              <XAxis
                type="number"
                dataKey="timestamp"
                domain={["dataMin", "dataMax"]}
                tickFormatter={formatTimeTick}
                tick={{ fontSize: 11, fill: chartColors?.tickText }}
                stroke={chartColors?.grid}
                minTickGap={48}
              />
              <YAxis
                type="number"
                dataKey="rssi"
                domain={["dataMin - 3", "dataMax + 3"]}
                tick={{ fontSize: 11, fill: chartColors?.tickText }}
                stroke={chartColors?.grid}
                unit=" dBm"
                width={70}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ strokeDasharray: "3 3" }}
                shared={false}
                trigger="hover"
              />
              <Customized
                component={() => (
                  <BandOverlay
                    hoveredId={hoveredId}
                    pointsByTrack={pointsByTrack}
                    color={hoveredId ? trackColorById.get(hoveredId) ?? null : null}
                  />
                )}
              />
              {visibleTracks.map((t) => {
                const dimmed = hoveredId != null && hoveredId !== t.id;
                const opacity = dimmed ? 0.15 : 0.9;
                return (
                  <Scatter
                    key={t.id}
                    name={t.devAddr ?? t.id}
                    data={pointsByTrack.get(t.id) ?? []}
                    // Fill per-packet by frame type — mirrors the table's
                    // palette. Track identity still shows via the hover band.
                    shape={(dotProps) => (
                      <circle
                        cx={dotProps.cx}
                        cy={dotProps.cy}
                        r={4}
                        fill={colorForFrameType(dotProps.payload.frameType, isDark)}
                        fillOpacity={opacity}
                      />
                    )}
                    isAnimationActive={false}
                  />
                );
              })}
              <Customized component={() => <HoverSync onChange={setHoveredId} />} />
              <Customized
                component={() => (
                  <FcntLabels
                    hoveredId={hoveredId}
                    pointsByTrack={pointsByTrack}
                    color={hoveredId ? trackColorById.get(hoveredId) ?? null : null}
                    isDark={isDark}
                  />
                )}
              />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
