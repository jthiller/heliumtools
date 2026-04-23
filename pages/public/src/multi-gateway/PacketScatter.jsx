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
} from "recharts";
import useDarkMode from "../lib/useDarkMode.js";
import { devAddrToNetId, netIdToOperator } from "../lib/lorawan.js";
import { readChartColors } from "../lib/chartColors.js";
import { colorForTrack, listTracks, BUCKET_IDS } from "./segmentation.js";

function isDownlinkTrack(id) {
  return id === BUCKET_IDS.downlinks;
}

function trackVisible(t, { showDownlinks, netIdFilter, trackFilter }) {
  if (isDownlinkTrack(t.id)) return showDownlinks && t.count > 0;
  if (netIdFilter !== "all" && t.netId !== netIdFilter) return false;
  if (trackFilter !== "all" && t.id !== trackFilter) return false;
  return true;
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

// Draw fcnt above each dot of the hovered track. Rendered as a separate
// Customized after Scatter so labels sit on top of dots; paint-order: stroke
// fill creates a halo so numbers stay legible over busy chart areas.
function FcntLabels({ hoveredId, pointsByTrack, color, isDark, xAxisMap, yAxisMap }) {
  if (!hoveredId || !color) return null;
  const pts = pointsByTrack.get(hoveredId);
  if (!pts || pts.length === 0) return null;
  const xScale = Object.values(xAxisMap || {})[0]?.scale;
  const yScale = Object.values(yAxisMap || {})[0]?.scale;
  if (!xScale || !yScale) return null;
  const halo = isDark ? "#000000" : "#ffffff";
  return (
    <g pointerEvents="none">
      {pts.map((p, i) => {
        if (p.fcnt == null) return null;
        const x = xScale(p.timestamp);
        const y = yScale(p.rssi) - 8;
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

// Render a filled, SNR-weighted band following the hovered track's packets.
// Band extends to the full chart width; thickness varies per packet based on SNR.
function BandOverlay({ hoveredId, pointsByTrack, color, xAxisMap, yAxisMap }) {
  if (!hoveredId || !color) return null;
  const pts = pointsByTrack.get(hoveredId);
  if (!pts || pts.length === 0) return null;
  const xScale = Object.values(xAxisMap || {})[0]?.scale;
  const yScale = Object.values(yAxisMap || {})[0]?.scale;
  if (!xScale || !yScale) return null;
  const [xLeft, xRight] = xScale.range();

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
  const label = p.trackId === BUCKET_IDS.downlinks
    ? "Downlinks"
    : `${operator ?? netIdInfo?.netId ?? "Unknown NetID"} · ${p.devAddr} · ${p.trackId}`;
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

  // Joins have no dev_addr/fcnt so they can't be segmented — never render them.
  // Downlinks stay as a single toggleable bucket, gated on the table's filter row.
  const showDownlinks =
    (visibleTypes?.UnconfirmedDown ?? false) ||
    (visibleTypes?.ConfirmedDown ?? false);

  const tracks = useMemo(() => {
    const all = listTracks(segmenter);
    all.push(segmenter.downlinks);
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmenter, packets]);

  const chartColors = useMemo(readChartColors, [isDark]);

  const netIdOptions = useMemo(() => {
    const set = new Set();
    for (const t of tracks) {
      if (isDownlinkTrack(t.id)) continue;
      if (t.netId) set.add(t.netId);
    }
    return [...set].sort();
  }, [tracks]);

  const trackOptions = useMemo(() => {
    const list = tracks.filter((t) => {
      if (isDownlinkTrack(t.id)) return false;
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
        trackId: tid,
      });
    }
    return map;
  }, [packets]);

  const filterOpts = { showDownlinks, netIdFilter, trackFilter };
  const visibleTracks = tracks.filter((t) => trackVisible(t, filterOpts));
  const hasData = visibleTracks.some((t) => (pointsByTrack.get(t.id)?.length ?? 0) > 0);

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-raised shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-content-primary">
          Estimated devices
          <span className="ml-2 text-xs font-normal text-content-tertiary">
            RSSI over time, one color per segmented device
          </span>
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
              <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />
              <Customized
                component={(props) => (
                  <BandOverlay
                    hoveredId={hoveredId}
                    pointsByTrack={pointsByTrack}
                    color={hoveredId ? colorForTrack(hoveredId, isDark) : null}
                    xAxisMap={props.xAxisMap}
                    yAxisMap={props.yAxisMap}
                  />
                )}
              />
              {visibleTracks.map((t) => (
                <Scatter
                  key={t.id}
                  name={t.devAddr ?? t.id}
                  data={pointsByTrack.get(t.id) ?? []}
                  fill={colorForTrack(t.id, isDark)}
                  fillOpacity={hoveredId == null || hoveredId === t.id ? 0.9 : 0.15}
                  onMouseEnter={() => setHoveredId(t.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  isAnimationActive={false}
                />
              ))}
              <Customized
                component={(props) => (
                  <FcntLabels
                    hoveredId={hoveredId}
                    pointsByTrack={pointsByTrack}
                    color={hoveredId ? colorForTrack(hoveredId, isDark) : null}
                    isDark={isDark}
                    xAxisMap={props.xAxisMap}
                    yAxisMap={props.yAxisMap}
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
