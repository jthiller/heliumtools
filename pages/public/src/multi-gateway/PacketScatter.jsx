import { useEffect, useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import useDarkMode from "../lib/useDarkMode.js";
import { devAddrToNetId, netIdToOperator } from "../lib/lorawan.js";
import { readChartColors } from "../lib/chartColors.js";
import { colorForTrack, listTracks, BUCKET_IDS } from "./segmentation.js";

function isJoinTrack(id) {
  return id === BUCKET_IDS.joins;
}
function isDownlinkTrack(id) {
  return id === BUCKET_IDS.downlinks;
}

// Single-source-of-truth predicate: does a given track pass the user's
// frame-type filter (Joins on/off, Downlinks on/off) and the NetID/track filters?
function trackVisible(t, { showJoins, showDownlinks, netIdFilter, trackFilter }) {
  if (isJoinTrack(t.id)) return showJoins && t.count > 0;
  if (isDownlinkTrack(t.id)) return showDownlinks && t.count > 0;
  if (netIdFilter !== "all" && t.netId !== netIdFilter) return false;
  if (trackFilter !== "all" && t.id !== trackFilter) return false;
  return true;
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
  const label = p.trackId === BUCKET_IDS.joins
    ? "Join frames"
    : p.trackId === BUCKET_IDS.downlinks
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

  // Joins/Downlinks buckets on the chart mirror the table filter checkboxes.
  const showJoins =
    (visibleTypes?.JoinRequest ?? false) ||
    (visibleTypes?.JoinAccept ?? false) ||
    (visibleTypes?.RejoinRequest ?? false) ||
    (visibleTypes?.Proprietary ?? false);
  const showDownlinks =
    (visibleTypes?.UnconfirmedDown ?? false) ||
    (visibleTypes?.ConfirmedDown ?? false);

  const tracks = useMemo(() => {
    const all = listTracks(segmenter);
    all.push(segmenter.joins, segmenter.downlinks);
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmenter, packets]);

  const chartColors = useMemo(readChartColors, [isDark]);

  // NetID options built from live tracks
  const netIdOptions = useMemo(() => {
    const set = new Set();
    for (const t of tracks) {
      if (isJoinTrack(t.id) || isDownlinkTrack(t.id)) continue;
      if (t.netId) set.add(t.netId);
    }
    return [...set].sort();
  }, [tracks]);

  // Track options, filtered by the current NetID selection
  const trackOptions = useMemo(() => {
    const list = tracks.filter((t) => {
      if (isJoinTrack(t.id) || isDownlinkTrack(t.id)) return false;
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

  const filterOpts = { showJoins, showDownlinks, netIdFilter, trackFilter };
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
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
