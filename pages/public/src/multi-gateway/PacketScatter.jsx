import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Customized,
  ResponsiveContainer,
  usePlotArea,
  useXAxisDomain,
  useYAxisDomain,
} from "recharts";
import useDarkMode from "../lib/useDarkMode.js";
import { devAddrToNetId, netIdToOperator } from "../lib/lorawan.js";
import { readChartColors } from "../lib/chartColors.js";
import { listTracks } from "./segmentation.js";

function trackVisible(t, { netIdFilter, trackFilter }) {
  if (netIdFilter !== "all" && t.netId !== netIdFilter) return false;
  if (trackFilter !== "all" && t.id !== trackFilter) return false;
  return true;
}

function colorForTrack(track, isDark) {
  const palette = isDark ? NETID_FAMILIES_DARK : NETID_FAMILIES_LIGHT;
  const [light, dark] = palette[familyForNetId(track?.netId)];
  // Band uses the light shade to sit quietly behind the dots (which may be
  // either shade) without clashing.
  return light;
}

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
// Order matters — first key is reserved for Helium, rest are assigned to
// other NetIDs in insertion order via djb2 hash.
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

// Confirmed uplinks use the darker shade; unconfirmed / everything else
// stays on the lighter shade.
function colorForPacket(point) {
  return point.frameType === "ConfirmedUp" ? point.fillDark : point.fillLight;
}

function swatchColorForNetId(netId, isDark) {
  return colorForNetIdShade(netId, false, isDark);
}

// Tiny custom <select> replacement so we can render a colour swatch next to
// each option — native <option> elements don't support complex children.
function ColoredSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const selected = options.find((o) => o.value === value) ?? options[0];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
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
          role="listbox"
          className="absolute right-0 z-20 mt-1 max-h-56 min-w-full overflow-y-auto rounded-md border border-border bg-surface-raised py-1 text-xs shadow-soft"
        >
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex cursor-pointer items-center gap-2 whitespace-nowrap px-2 py-1 hover:bg-surface-inset ${
                o.value === value ? "text-content-primary" : "text-content-secondary"
              }`}
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
          ))}
        </ul>
      )}
    </div>
  );
}

// When a hovered dot is past this fraction of the chart width, anchor the
// tooltip to its right edge so it doesn't clip off the chart.
const TOOLTIP_FLIP_THRESHOLD = 0.65;

// SNR → half-band size (dB). LoRaWAN SNR floor is ~-20 dB (below demodulation
// limit); +10 dB is effectively excellent. Low SNR = more uncertain reception
// = wider band.
const SNR_BEST = 10;
const SNR_WORST = -20;
const HALF_WIDTH_MIN_DB = 1.5;
const HALF_WIDTH_MAX_DB = 10;

function halfWidthForSnr(snr) {
  // Unknown SNR → widest band (max uncertainty). Matches "worst case" default.
  if (snr == null || !Number.isFinite(snr)) return HALF_WIDTH_MAX_DB;
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

// `<Customized>` in recharts 3.x doesn't pass scales as props. Build linear
// scales from the public-API domain + plot-area hooks (matching recharts'
// default numeric axis), so overlays project the same as the dots.
function useChartScales() {
  const plot = usePlotArea();
  const xDomain = useXAxisDomain();
  const yDomain = useYAxisDomain();
  return useMemo(() => {
    if (!plot || !xDomain || !yDomain) return null;
    const [xMin, xMax] = xDomain;
    const [yMin, yMax] = yDomain;
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax === xMin) return null;
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax === yMin) return null;
    const xScale = (v) => plot.x + ((v - xMin) / (xMax - xMin)) * plot.width;
    const yScale = (v) => plot.y + plot.height - ((v - yMin) / (yMax - yMin)) * plot.height;
    return { xScale, yScale, xLeft: plot.x, xRight: plot.x + plot.width };
  }, [plot, xDomain, yDomain]);
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

// Human-readable gap between consecutive packets in a track. `~` prefix
// signals a rounded estimate — exact precision isn't useful for an
// observed interval.
function formatInterval(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `~${Math.round(ms / 1000)}s`;
  const min = ms / 60_000;
  if (min < 60) return `~${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `~${Math.round(h)}h`;
  return `~${Math.round(h / 24)}d`;
}

// We render our own tooltip instead of recharts' <Tooltip> because a custom
// shape fn breaks the per-item hover wiring recharts' tooltip relies on —
// without owned dot elements, its shared={false} path can't resolve which
// dot is active.
function HoverTooltip({ hover }) {
  if (!hover) return null;
  const p = hover.payload;
  const netIdInfo = p.devAddr ? devAddrToNetId(p.devAddr) : null;
  const operator = netIdInfo?.netId ? netIdToOperator(netIdInfo.netId) : null;
  const label = `${operator ?? netIdInfo?.netId ?? "Unknown NetID"} · ${p.devAddr} · ${p.trackId}`;
  const flipRight = hover.x > hover.hostWidth * TOOLTIP_FLIP_THRESHOLD;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface-raised px-3 py-2 text-xs shadow-soft"
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

export default function PacketScatter({ packets, segmenter, loading }) {
  const isDark = useDarkMode();
  // `hover` carries both the trackId (for band + label colouring + dimming)
  // and the full payload/screen-coords we need to render our own tooltip.
  const [hover, setHover] = useState(null);
  const hoveredId = hover?.trackId ?? null;
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

  // Disambiguate when two NetIDs resolve to the same operator name (e.g.,
  // Helium's 000024 and 00003C both display as "Helium").
  const netIdSelectOptions = useMemo(() => {
    const operatorCounts = new Map();
    for (const id of netIdOptions) {
      const op = netIdToOperator(id) ?? id;
      operatorCounts.set(op, (operatorCounts.get(op) ?? 0) + 1);
    }
    return [
      { value: "all", label: "All", swatch: null },
      ...netIdOptions.map((id) => {
        const op = netIdToOperator(id) ?? id;
        const label = operatorCounts.get(op) > 1 ? `${op} · ${id}` : op;
        return { value: id, label, swatch: swatchColorForNetId(id, isDark) };
      }),
    ];
  }, [netIdOptions, isDark]);

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

  // Group packets into per-track arrays for recharts Scatter series. Bake
  // NetID + colour onto each point so the per-dot shape fn doesn't re-parse
  // the devAddr or recompute the palette on every hover-triggered re-render.
  const pointsByTrack = useMemo(() => {
    const map = new Map();
    for (const pkt of packets) {
      const tid = pkt._trackId;
      if (!tid) continue;
      if (!map.has(tid)) map.set(tid, []);
      const netId = pkt.dev_addr ? devAddrToNetId(pkt.dev_addr)?.netId : null;
      const point = {
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
      };
      point.fillLight = colorForNetIdShade(netId, false, isDark);
      point.fillDark = colorForNetIdShade(netId, true, isDark);
      map.get(tid).push(point);
    }
    return map;
  }, [packets, isDark]);

  const filterOpts = { netIdFilter, trackFilter };
  const visibleTracks = tracks.filter((t) => trackVisible(t, filterOpts));
  const hasData = visibleTracks.some((t) => (pointsByTrack.get(t.id)?.length ?? 0) > 0);

  const deviceCount = tracks.filter((t) => t.count > 0).length;

  // One stable shape fn across all Scatter series — opacity/color derive from
  // the dot's own payload so the closure only changes on hover/theme, not per
  // track. Handlers live here so the band keys off the exact dot the cursor
  // is on, not recharts' series-level hitbox.
  const dotShape = useCallback(
    (dotProps) => {
      const dimmed = hoveredId != null && hoveredId !== dotProps.payload.trackId;
      return (
        <circle
          cx={dotProps.cx}
          cy={dotProps.cy}
          r={4}
          fill={colorForPacket(dotProps.payload)}
          fillOpacity={dimmed ? 0.15 : 0.9}
          onMouseEnter={(e) => {
            const dotRect = e.currentTarget.getBoundingClientRect();
            const hostRect = e.currentTarget
              .closest("[data-chart-host]")
              ?.getBoundingClientRect();
            if (!hostRect) return;
            const track = segmenter.tracks.get(dotProps.payload.trackId);
            const intervalMs =
              track && track.count > 1
                ? (track.lastTs - track.firstTs) / (track.count - 1)
                : null;
            setHover({
              trackId: dotProps.payload.trackId,
              payload: dotProps.payload,
              intervalMs,
              x: dotRect.left + dotRect.width / 2 - hostRect.left,
              y: dotRect.top + dotRect.height / 2 - hostRect.top,
              hostWidth: hostRect.width,
            });
          }}
          onMouseLeave={() => setHover(null)}
          style={{ cursor: "pointer" }}
        />
      );
    },
    [hoveredId, segmenter],
  );
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
            <ColoredSelect
              value={netIdFilter}
              onChange={setNetIdFilter}
              options={netIdSelectOptions}
            />
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

      <div
        className="relative h-64 px-2 py-3"
        data-chart-host
        // Safari occasionally drops SVG <circle> mouseleave when the cursor
        // exits the dot into blank space fast. Belt-and-suspenders: clear on
        // the chart host's mouseleave too so the tooltip always dismisses.
        onMouseLeave={() => setHover(null)}
      >
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
              {hover && (
                <ReferenceLine
                  x={hover.payload.timestamp}
                  stroke={chartColors?.grid}
                  strokeDasharray="3 3"
                  ifOverflow="hidden"
                />
              )}
              <Customized
                component={() => (
                  <BandOverlay
                    hoveredId={hoveredId}
                    pointsByTrack={pointsByTrack}
                    color={hoveredId ? trackColorById.get(hoveredId) ?? null : null}
                  />
                )}
              />
              {visibleTracks.map((t) => (
                <Scatter
                  key={t.id}
                  name={t.devAddr ?? t.id}
                  data={pointsByTrack.get(t.id) ?? []}
                  // Fill per-packet by frame type (see dotShape); track
                  // identity shows via the hover band instead.
                  shape={dotShape}
                  isAnimationActive={false}
                />
              ))}
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
        {hover && <HoverTooltip hover={hover} />}
      </div>
    </div>
  );
}
