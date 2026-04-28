import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDarkMode from "../lib/useDarkMode.js";
import { readChartColors } from "../lib/chartColors.js";
import { JOIN_FRAME_TYPES, DOWNLINK_FRAME_TYPES } from "../lib/lorawan.js";
import { packetMatchesFilters } from "./filters.js";
import { parseSpreadingFactor, loraAirtimeMs } from "./airtime.js";
import {
  colorForNetIdShade,
  plotLeftFor,
  PLOT_RIGHT,
} from "./PacketScatter.jsx";
import { JOIN_COLOR, DOWN_COLOR } from "./EventsBar.jsx";

// Spectrum waterfall: X = discrete LoRaWAN channels (one column per unique
// frequency observed), Y = wall-clock time. Each packet draws a rectangle
// filling its channel column; height = LoRa time-on-air. Newest at bottom
// (SDR convention). Hover/click coordinate with the scatter and table via
// the shared `hover` state.
//
// Column widths are proportional to bandwidth, so a 500 kHz downlink column
// is visibly wider than a 125 kHz uplink column. Helium gateways are 8-ch,
// so we typically end up with up to 8 uplink columns plus any downlink
// channels seen.

const PLOT_TOP = 8;
// Tick label area below the plot.
const PLOT_BOTTOM_PAD = 18;

// User-selectable timeframe. "max" follows the buffer; "1h" only shows up
// when the buffer actually holds an hour of history.
const TIMEFRAME_OPTIONS = [
  { id: "1m", label: "1m", ms: 60_000 },
  { id: "15m", label: "15m", ms: 15 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "max", label: "max", ms: Infinity },
];
const DEFAULT_TIMEFRAME = "15m";
const DEFAULT_TIME_WINDOW_MS = 60_000;

// Frequency quantization: bucket size used to dedupe floating-point noise
// across packets nominally on the same channel. Narrower than any LoRaWAN
// channel spacing (≥100 kHz everywhere we care about).
const CHANNEL_BUCKET_MHZ = 0.05;
// Pixel gap rendered between adjacent channel columns.
const COLUMN_GAP_PX = 4;

// RSSI → opacity. Floor keeps -130 dBm packets faintly visible.
const RSSI_FLOOR_DBM = -130;
const RSSI_CEIL_DBM = -50;
const OPACITY_FLOOR = 0.25;
const OPACITY_CEIL = 0.95;

const MIN_RECT_H_PX = 2;

function rssiToOpacity(rssi) {
  if (!Number.isFinite(rssi)) return OPACITY_CEIL;
  const t = Math.max(0, Math.min(1, (rssi - RSSI_FLOOR_DBM) / (RSSI_CEIL_DBM - RSSI_FLOOR_DBM)));
  return OPACITY_FLOOR + (OPACITY_CEIL - OPACITY_FLOOR) * t;
}

function colorForPkt(pkt, isDark) {
  if (JOIN_FRAME_TYPES.has(pkt.frame_type)) return isDark ? JOIN_COLOR.dark : JOIN_COLOR.light;
  if (DOWNLINK_FRAME_TYPES.has(pkt.frame_type)) return isDark ? DOWN_COLOR.dark : DOWN_COLOR.light;
  const confirmed = pkt.frame_type === "ConfirmedUp";
  return colorForNetIdShade(pkt._netId ?? null, confirmed, isDark);
}

// Group visible packets into discrete channels, keyed by frequency rounded
// to CHANNEL_BUCKET_MHZ. Each channel records the BW we'll allocate width
// to (max BW seen, so a channel that hosts both 125 kHz uplinks and 500 kHz
// SF8 traffic gets a 500 kHz column).
function computeChannels(visiblePackets) {
  const map = new Map();
  for (const p of visiblePackets) {
    const key = Math.round(p.frequency / CHANNEL_BUCKET_MHZ) * CHANNEL_BUCKET_MHZ;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { freq: p.frequency, bwKHz: p.bwKHz });
    } else if (p.bwKHz > cur.bwKHz) {
      cur.bwKHz = p.bwKHz;
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => a.freq - b.freq);
}

function buildScales({ width, height, channels, timeDomain }) {
  if (!width || !height) return null;
  const xLeft = plotLeftFor(width);
  const xRight = width - PLOT_RIGHT;
  const yTop = PLOT_TOP;
  const yBottom = height - PLOT_BOTTOM_PAD;
  const usableWidth = xRight - xLeft;
  if (usableWidth <= 0) return null;
  const [tMin, tMax] = timeDomain;
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax === tMin) return null;
  if (!channels.length) return null;

  // Strict bandwidth-proportional widths: every column gets the same
  // pixels-per-kHz, so a 500 kHz downlink column is exactly 4× the width
  // of a 125 kHz uplink column. The user reads column width as bandwidth
  // directly.
  const nGaps = Math.max(0, channels.length - 1);
  const totalGap = nGaps * COLUMN_GAP_PX;
  const totalBw = channels.reduce((s, c) => s + c.bwKHz, 0);
  if (totalBw <= 0) return null;
  const pxPerKHz = (usableWidth - totalGap) / totalBw;
  if (pxPerKHz <= 0) return null;

  let cursor = xLeft;
  const placed = channels.map((c, i) => {
    const w = c.bwKHz * pxPerKHz;
    const out = {
      key: c.key,
      freq: c.freq,
      bwKHz: c.bwKHz,
      xStart: cursor,
      xEnd: cursor + w,
    };
    cursor = out.xEnd + (i < channels.length - 1 ? COLUMN_GAP_PX : 0);
    return out;
  });
  const byKey = new Map(placed.map((c) => [c.key, c]));

  const yScale = (ts) => yTop + ((ts - tMin) / (tMax - tMin)) * (yBottom - yTop);
  const channelForFreq = (freq) => {
    const key = Math.round(freq / CHANNEL_BUCKET_MHZ) * CHANNEL_BUCKET_MHZ;
    return byKey.get(key) ?? null;
  };
  return {
    xLeft, xRight, yTop, yBottom, tMin, tMax,
    channels: placed,
    channelForFreq,
    yScale,
  };
}

function drawGrid(ctx, scales, colors) {
  const { xLeft, yTop, yBottom, channels } = scales;
  // Light vertical separators at column boundaries.
  ctx.save();
  ctx.strokeStyle = colors?.grid ?? "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (let i = 0; i < channels.length - 1; i++) {
    const x = Math.round((channels[i].xEnd + channels[i + 1].xStart) / 2) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBottom);
    ctx.stroke();
  }
  ctx.restore();
  // Solid y-axis line.
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

function drawAxisLabels(ctx, scales, colors) {
  ctx.save();
  ctx.font = "11px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillStyle = colors?.tickText ?? "#6b7280";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // One label per column. If two adjacent columns would overlap, drop the
  // even-indexed labels so the surviving ones still read as channel marks.
  const labels = scales.channels.map((c) => ({
    text: c.freq.toFixed(1),
    x: (c.xStart + c.xEnd) / 2,
  }));
  ctx.font = "11px ui-sans-serif, system-ui, -apple-system, sans-serif";
  let widthEstimate = 0;
  for (const l of labels) widthEstimate = Math.max(widthEstimate, ctx.measureText(l.text).width);
  const minSpacing = widthEstimate + 6;
  let lastX = -Infinity;
  let stride = 1;
  if (labels.length > 1 && (labels[1].x - labels[0].x) < minSpacing) stride = 2;
  for (let i = 0; i < labels.length; i++) {
    if (i % stride !== 0) continue;
    const l = labels[i];
    if (l.x - lastX < minSpacing) continue;
    ctx.fillText(l.text, l.x, scales.yBottom + 4);
    lastX = l.x;
  }
  ctx.textAlign = "right";
  ctx.fillText("MHz", scales.xRight, scales.yBottom + 4);
  ctx.restore();
}

function drawRects(ctx, rects, scales, hoveredId, dimOthers) {
  const { yTop, yBottom } = scales;
  ctx.save();
  for (const r of rects) {
    if (r.y == null) continue;
    if (r.y + r.h < yTop || r.y > yBottom) continue;
    const y = Math.max(yTop, r.y);
    const yEnd = Math.min(yBottom, r.y + r.h);
    if (yEnd <= y) continue;
    const h = Math.max(MIN_RECT_H_PX, yEnd - y);
    const isHovered = hoveredId !== null && r.id === hoveredId;
    const alphaScale = dimOthers && !isHovered ? 0.35 : 1;
    ctx.fillStyle = r.color;
    ctx.globalAlpha = r.opacity * alphaScale;
    ctx.fillRect(r.x, y, r.w, h);
    if (isHovered) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.5, y + 0.5, r.w - 1, h - 1);
    }
  }
  ctx.restore();
}

function HoverTooltip({ hover }) {
  const p = hover.payload;
  const flipRight = hover.x > hover.hostWidth / 2;
  const label = p.dev_addr || p.frame_type || "Packet";
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface-raised px-2 py-1 text-xs shadow-soft"
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
        <span>Freq</span>
        <span className="text-right">{p.frequency?.toFixed(1)} MHz</span>
        {p.spreading_factor && <><span>SF/BW</span><span className="text-right">{p.spreading_factor}</span></>}
        {p.payload_size != null && <><span>Size</span><span className="text-right">{p.payload_size} B</span></>}
        <span>Airtime</span>
        <span className="text-right">{p._airtimeMs.toFixed(1)} ms</span>
      </div>
    </div>
  );
}

export default function SpectrumChart({
  packets,
  loading,
  netIdFilter = "all",
  trackFilter = "all",
  visibleTypes,
  hover,
  setHover,
  onPickPacket,
}) {
  const isDark = useDarkMode();
  const chartColors = useMemo(readChartColors, [isDark]);

  // Lean per-packet rows. Color/opacity move into rectsBase below so dark
  // mode toggles don't churn this memo.
  const visiblePackets = useMemo(() => {
    const out = [];
    for (const pkt of packets) {
      if (!packetMatchesFilters(pkt, { visibleTypes, netIdFilter, trackFilter })) continue;
      if (!Number.isFinite(pkt.frequency) || !Number.isFinite(pkt.payload_size)) continue;
      const sfbw = parseSpreadingFactor(pkt.spreading_factor);
      if (!sfbw) continue;
      const airtimeMs = loraAirtimeMs(sfbw.sf, sfbw.bw, pkt.payload_size, {
        // Downlinks omit the PHY CRC; everything else has it.
        crcOn: !DOWNLINK_FRAME_TYPES.has(pkt.frame_type),
      });
      if (!(airtimeMs > 0)) continue;
      out.push({
        _id: pkt._id,
        timestamp: pkt.timestamp,
        frequency: pkt.frequency,
        bwKHz: sfbw.bw,
        airtimeMs,
        ref: pkt,
      });
    }
    return out;
  }, [packets, visibleTypes, netIdFilter, trackFilter]);

  const channels = useMemo(() => computeChannels(visiblePackets), [visiblePackets]);

  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

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

  // Stable rect geometry: x/w come from the packet's channel column, which
  // only depends on visiblePackets + width. Cached here so the rAF tick can
  // just refresh y/h.
  const rectsBase = useMemo(() => {
    if (!innerW || !channels.length) return [];
    const probe = buildScales({ width: innerW, height: 1, channels, timeDomain: [0, 1] });
    if (!probe) return [];
    const out = [];
    for (const p of visiblePackets) {
      const col = probe.channelForFreq(p.frequency);
      if (!col) continue;
      out.push({
        id: p._id,
        timestamp: p.timestamp,
        airtimeMs: p.airtimeMs,
        x: col.xStart,
        w: col.xEnd - col.xStart,
        color: colorForPkt(p.ref, isDark),
        opacity: rssiToOpacity(p.ref.rssi),
        ref: p.ref,
      });
    }
    return out;
  }, [visiblePackets, channels, innerW, isDark]);

  // 15-min sliding window, anchored to Date.now() per frame so the
  // waterfall scrolls live. Shrinks naturally when the buffer holds less
  // than 15 minutes of data.
  const earliestPacketTs = useMemo(() => {
    if (visiblePackets.length === 0) return null;
    let t = Infinity;
    for (const p of visiblePackets) if (p.timestamp < t) t = p.timestamp;
    return t;
  }, [visiblePackets]);

  const [timeframeId, setTimeframeId] = useState(DEFAULT_TIMEFRAME);
  const timeframeMs = (TIMEFRAME_OPTIONS.find((t) => t.id === timeframeId) ?? TIMEFRAME_OPTIONS[1]).ms;

  // Buffer span drives which timeframe options are offered. ~10 min slack on
  // the 1h cutoff so the option doesn't flicker while the buffer fills.
  const bufferSpanMs = useMemo(() => {
    if (earliestPacketTs == null) return 0;
    return Date.now() - earliestPacketTs;
  }, [earliestPacketTs]);

  const visibleTimeframeOptions = useMemo(
    () => TIMEFRAME_OPTIONS.filter((opt) => opt.id !== "1h" || bufferSpanMs >= 50 * 60_000),
    [bufferSpanMs],
  );

  const getScales = useCallback(() => {
    if (!innerW || !innerH) return null;
    const now = Date.now();
    let tMin;
    if (timeframeMs === Infinity) {
      tMin = earliestPacketTs ?? (now - DEFAULT_TIME_WINDOW_MS);
    } else {
      const cutoff = now - timeframeMs;
      tMin = earliestPacketTs == null ? cutoff : Math.max(earliestPacketTs, cutoff);
    }
    return buildScales({
      width: innerW,
      height: innerH,
      channels,
      timeDomain: [tMin, now],
    });
  }, [innerW, innerH, channels, earliestPacketTs, timeframeMs]);

  const stateRef = useRef({});
  stateRef.current = {
    canvasRef, innerW, innerH, chartColors, getScales, rectsBase,
    hover,
  };

  const rafRef = useRef(0);
  useEffect(() => {
    const tick = () => {
      const s = stateRef.current;
      const canvas = s.canvasRef.current;
      const scales = s.getScales();
      if (canvas && scales) {
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
        drawGrid(ctx, scales, s.chartColors);
        // y/h updated in place each frame; x/w were cached at memo-time.
        for (const r of s.rectsBase) {
          const yBottomEdge = scales.yScale(r.timestamp);
          const yTopEdge = scales.yScale(r.timestamp - r.airtimeMs);
          r.y = Math.min(yBottomEdge, yTopEdge);
          r.h = Math.max(Math.abs(yBottomEdge - yTopEdge), MIN_RECT_H_PX);
        }
        const externalHoverId = s.hover && s.hover.source !== "spectrum"
          ? s.hover.payload?._id ?? null
          : null;
        const hoveredId = s.hover && s.hover.source === "spectrum"
          ? s.hover.payload._id
          : externalHoverId;
        const dimOthers = hoveredId !== null;
        drawRects(ctx, s.rectsBase, scales, hoveredId, dimOthers);
        drawAxisLabels(ctx, scales, s.chartColors);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, []);

  // Walk in reverse so the newest rectangle wins on overlap.
  const hitTest = (cx, cy) => {
    const rects = stateRef.current.rectsBase;
    if (!rects) return null;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (
        r.y != null
        && cx >= r.x && cx <= r.x + r.w
        && cy >= r.y && cy <= r.y + r.h
      ) return r;
    }
    return null;
  };

  const setHoverFor = (rect) => {
    const canvas = canvasRef.current;
    const offsetLeft = canvas?.offsetLeft ?? 0;
    const offsetTop = canvas?.offsetTop ?? 0;
    setHover({
      source: "spectrum",
      trackId: null,
      payload: { ...rect.ref, _airtimeMs: rect.airtimeMs },
      intervalMs: null,
      x: rect.x + rect.w / 2 + offsetLeft,
      y: rect.y + offsetTop,
      hostWidth: size.w,
    });
  };

  const onPointerMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const hit = hitTest(cx, cy);
    if (hit) {
      if (hover && hover.source === "spectrum" && hover.payload._id === hit.id) return;
      setHoverFor(hit);
    } else if (hover && hover.source === "spectrum") {
      setHover(null);
    }
  };

  const lastPointerTypeRef = useRef("mouse");
  const onPointerDown = (e) => {
    lastPointerTypeRef.current = e.pointerType;
  };

  const onClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const hit = hitTest(cx, cy);
    if (hit) {
      setHoverFor(hit);
      if (lastPointerTypeRef.current !== "touch") onPickPacket?.(hit.id);
    }
  };

  const hasData = visiblePackets.length > 0;

  return (
    <div
      ref={hostRef}
      className="relative h-64 px-0 pb-0 pt-3 sm:px-2"
      data-chart-host
      onMouseLeave={() => {
        if (hover && hover.source === "spectrum") setHover(null);
      }}
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
        <canvas
          ref={canvasRef}
          className={`absolute left-0 right-0 top-3 sm:left-2 sm:right-2 ${
            hover?.source === "spectrum" ? "cursor-pointer" : ""
          }`}
          style={{ touchAction: "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={(e) => {
            if (e.pointerType === "touch") return;
            if (hover && hover.source === "spectrum") setHover(null);
          }}
          onClick={onClick}
        />
      )}
      {hasData && visibleTimeframeOptions.length > 1 && (
        <div className="absolute right-2 top-2 z-10 flex overflow-hidden rounded-md border border-border bg-surface text-[11px] shadow-soft">
          {visibleTimeframeOptions.map((opt) => {
            const active = opt.id === timeframeId;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTimeframeId(opt.id)}
                className={`px-2 py-0.5 ${
                  active
                    ? "bg-accent text-white"
                    : "text-content-secondary hover:bg-surface-inset"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
      {hover && hover.source === "spectrum" && <HoverTooltip hover={hover} />}
    </div>
  );
}
