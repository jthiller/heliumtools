import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDarkMode from "../lib/useDarkMode.js";
import { readChartColors } from "../lib/chartColors.js";
import { JOIN_FRAME_TYPES, DOWNLINK_FRAME_TYPES } from "../lib/lorawan.js";
import { packetMatchesFilters } from "./filters.js";
import { parseSpreadingFactor, loraAirtimeMs } from "./airtime.js";
import { colorForNetIdShade } from "./PacketScatter.jsx";
import { JOIN_COLOR, DOWN_COLOR } from "./EventsBar.jsx";

// Spectrum waterfall: X = frequency (MHz), Y = wall-clock time. Each packet
// draws a rectangle at its true spectrum bounds — `[freq - bw/2, freq + bw/2]`
// in MHz — so a 500 kHz transmission physically overlaps its neighboring
// 125 kHz channels, the way it does on the air. Newest at bottom (SDR
// convention). Hover/click coordinate with the scatter and table via the
// shared `hover` state.
//
// X axis is piecewise: when packets cluster on widely-separated bands (e.g.
// US915 uplinks at 902–915 MHz vs downlinks at 923–928 MHz), the dead air
// in between is compressed to a fixed-width visual break so each cluster
// gets its own readable region. Single-cluster Hotspots see one continuous
// axis with no break.

const PLOT_TOP = 8;
// Tick label area below the plot.
const PLOT_BOTTOM_PAD = 18;
// Spectrum has no Y-axis labels or axis line, so the gutters can be tiny.
const PLOT_LEFT = 4;
const PLOT_RIGHT = 4;

// User-selectable timeframe. "max" follows the buffer; "1h" only shows up
// when the buffer actually holds an hour of history.
const TIMEFRAME_OPTIONS = [
  { id: "1m", label: "1m", ms: 60_000 },
  { id: "15m", label: "15m", ms: 15 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "max", label: "max", ms: Infinity },
];
const DEFAULT_TIMEFRAME = "1m";
const DEFAULT_TIME_WINDOW_MS = 60_000;

// Frequency clustering: gaps wider than this between adjacent visible
// channels start a new cluster (axis break).
const CLUSTER_GAP_MHZ = 5;
// Pixel gap rendered between adjacent clusters.
const BREAK_GAP_PX = 14;
// Buckets for deduping floating-point noise on nominally-same channels.
const CHANNEL_BUCKET_MHZ = 0.05;

// RSSI → opacity. Floor keeps -130 dBm packets faintly visible.
const RSSI_FLOOR_DBM = -130;
const RSSI_CEIL_DBM = -50;
const OPACITY_FLOOR = 0.25;
const OPACITY_CEIL = 0.95;

// US915 sub-band 2 uplink range — fallback when no packets are visible.
const DEFAULT_FREQ_DOMAIN = [902.3, 914.9];

const MIN_RECT_W_PX = 1.5;
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

// Bucket observed channel center frequencies (one entry per unique channel),
// recording the widest BW seen on each so axis labels and edge padding are
// stable.
function computeChannels(visiblePackets) {
  const map = new Map();
  for (const p of visiblePackets) {
    const key = Math.round(p.frequency / CHANNEL_BUCKET_MHZ) * CHANNEL_BUCKET_MHZ;
    const cur = map.get(key);
    if (!cur) map.set(key, { freq: p.frequency, bwKHz: p.bwKHz });
    else if (p.bwKHz > cur.bwKHz) cur.bwKHz = p.bwKHz;
  }
  return [...map.values()].sort((a, b) => a.freq - b.freq);
}

// Group channels into contiguous clusters separated by gaps wider than
// CLUSTER_GAP_MHZ, padded outward by half the widest BW so a 500 kHz signal
// at a cluster edge isn't clipped.
function computeClusters(channels) {
  if (channels.length === 0) {
    return [{ fMin: DEFAULT_FREQ_DOMAIN[0], fMax: DEFAULT_FREQ_DOMAIN[1], channels: [] }];
  }
  let bwMaxKHz = 0;
  for (const c of channels) if (c.bwKHz > bwMaxKHz) bwMaxKHz = c.bwKHz;
  const pad = Math.max(0.05, bwMaxKHz / 2 / 1000);
  const clusters = [];
  let cur = { fMin: channels[0].freq, fMax: channels[0].freq, channels: [channels[0]] };
  for (let i = 1; i < channels.length; i++) {
    const ch = channels[i];
    if (ch.freq - cur.fMax > CLUSTER_GAP_MHZ) {
      clusters.push({ fMin: cur.fMin - pad, fMax: cur.fMax + pad, channels: cur.channels });
      cur = { fMin: ch.freq, fMax: ch.freq, channels: [ch] };
    } else {
      cur.fMax = ch.freq;
      cur.channels.push(ch);
    }
  }
  clusters.push({ fMin: cur.fMin - pad, fMax: cur.fMax + pad, channels: cur.channels });
  return clusters;
}

function buildScales({ width, height, clusters, timeDomain }) {
  if (!width || !height) return null;
  const xLeft = PLOT_LEFT;
  const xRight = width - PLOT_RIGHT;
  const yTop = PLOT_TOP;
  const yBottom = height - PLOT_BOTTOM_PAD;
  const usableWidth = xRight - xLeft;
  if (usableWidth <= 0) return null;
  const [tMin, tMax] = timeDomain;
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax === tMin) return null;
  if (!clusters.length) return null;

  const nGaps = Math.max(0, clusters.length - 1);
  const totalRange = clusters.reduce((s, c) => s + (c.fMax - c.fMin), 0);
  if (totalRange <= 0) return null;
  const pxPerMHz = (usableWidth - nGaps * BREAK_GAP_PX) / totalRange;
  if (pxPerMHz <= 0) return null;

  let cursor = xLeft;
  const placed = clusters.map((c, i) => {
    const w = (c.fMax - c.fMin) * pxPerMHz;
    const out = {
      fMin: c.fMin,
      fMax: c.fMax,
      channels: c.channels,
      xStart: cursor,
      xEnd: cursor + w,
    };
    cursor = out.xEnd + (i < clusters.length - 1 ? BREAK_GAP_PX : 0);
    return out;
  });

  const xScale = (mhz) => {
    for (const c of placed) {
      if (mhz >= c.fMin && mhz <= c.fMax) {
        return c.xStart + (mhz - c.fMin) / (c.fMax - c.fMin) * (c.xEnd - c.xStart);
      }
    }
    if (mhz < placed[0].fMin) return placed[0].xStart;
    return placed[placed.length - 1].xEnd;
  };
  const yScale = (ts) => yTop + ((ts - tMin) / (tMax - tMin)) * (yBottom - yTop);
  return { xLeft, xRight, yTop, yBottom, tMin, tMax, clusters: placed, xScale, yScale };
}

function drawGrid(ctx, scales, colors) {
  const { yTop, yBottom, xScale, clusters } = scales;
  // Light dashed verticals at each labeled channel center.
  ctx.save();
  ctx.strokeStyle = colors?.grid ?? "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const c of clusters) {
    for (const ch of c.channels) {
      const x = Math.round(xScale(ch.freq)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBottom);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Diagonal-slash break markers between clusters so the axis gap reads as
  // "skipped band", not "no data".
  if (clusters.length > 1) {
    ctx.save();
    ctx.strokeStyle = colors?.tickText ?? "#6b7280";
    ctx.lineWidth = 1;
    for (let i = 0; i < clusters.length - 1; i++) {
      const xMid = (clusters[i].xEnd + clusters[i + 1].xStart) / 2;
      for (const dx of [-3, 3]) {
        ctx.beginPath();
        ctx.moveTo(xMid + dx - 3, yBottom + 6);
        ctx.lineTo(xMid + dx + 3, yBottom - 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function drawAxisLabels(ctx, scales, colors) {
  ctx.save();
  ctx.font = "11px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillStyle = colors?.tickText ?? "#6b7280";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labels = [];
  for (const c of scales.clusters) {
    for (const ch of c.channels) {
      labels.push({ text: ch.freq.toFixed(1), x: scales.xScale(ch.freq) });
    }
  }
  let widthEstimate = 0;
  for (const l of labels) widthEstimate = Math.max(widthEstimate, ctx.measureText(l.text).width);
  const minSpacing = widthEstimate + 6;
  let lastX = -Infinity;
  for (const l of labels) {
    if (l.x - lastX < minSpacing) continue;
    ctx.fillText(l.text, l.x, scales.yBottom + 4);
    lastX = l.x;
  }
  ctx.restore();
}

function drawRects(ctx, rects, scales, hoveredId, dimOthers) {
  const { xLeft, xRight, yTop, yBottom } = scales;
  ctx.save();
  for (const r of rects) {
    if (r.y == null) continue;
    if (r.y + r.h < yTop || r.y > yBottom) continue;
    if (r.x + r.w < xLeft || r.x > xRight) continue;
    const x = Math.max(xLeft, r.x);
    const xEnd = Math.min(xRight, r.x + r.w);
    if (xEnd <= x) continue;
    const y = Math.max(yTop, r.y);
    const yEnd = Math.min(yBottom, r.y + r.h);
    if (yEnd <= y) continue;
    const w = Math.max(MIN_RECT_W_PX, xEnd - x);
    const h = Math.max(MIN_RECT_H_PX, yEnd - y);
    const isHovered = hoveredId !== null && r.id === hoveredId;
    const alphaScale = dimOthers && !isHovered ? 0.35 : 1;
    ctx.fillStyle = r.color;
    ctx.globalAlpha = r.opacity * alphaScale;
    ctx.fillRect(x, y, w, h);
    if (isHovered) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
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
  const clusters = useMemo(() => computeClusters(channels), [channels]);

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

  // Stable rect geometry: x/w come from the packet's true frequency bounds
  // (`freq ± bw/2`), so a 500 kHz signal physically overlaps adjacent
  // 125 kHz channels — the way it does on the air. Cached here and reused
  // every rAF frame; the tick recomputes y/h live.
  const rectsBase = useMemo(() => {
    if (!innerW || !clusters.length) return [];
    const probe = buildScales({ width: innerW, height: 1, clusters, timeDomain: [0, 1] });
    if (!probe) return [];
    const out = [];
    for (const p of visiblePackets) {
      const halfBwMhz = p.bwKHz / 2 / 1000;
      const xL = probe.xScale(p.frequency - halfBwMhz);
      const xR = probe.xScale(p.frequency + halfBwMhz);
      const x = Math.min(xL, xR);
      const w = Math.abs(xR - xL);
      out.push({
        id: p._id,
        timestamp: p.timestamp,
        airtimeMs: p.airtimeMs,
        x,
        w,
        color: colorForPkt(p.ref, isDark),
        opacity: rssiToOpacity(p.ref.rssi),
        ref: p.ref,
      });
    }
    return out;
  }, [visiblePackets, clusters, innerW, isDark]);

  const earliestPacketTs = useMemo(() => {
    if (visiblePackets.length === 0) return null;
    let t = Infinity;
    for (const p of visiblePackets) if (p.timestamp < t) t = p.timestamp;
    return t;
  }, [visiblePackets]);

  const [timeframeId, setTimeframeId] = useState(DEFAULT_TIMEFRAME);
  const timeframeMs = (TIMEFRAME_OPTIONS.find((t) => t.id === timeframeId) ?? TIMEFRAME_OPTIONS[1]).ms;

  const bufferSpanMs = earliestPacketTs == null ? 0 : Date.now() - earliestPacketTs;

  // A finite window only earns a button once the buffer can actually fill
  // it — otherwise it would show the same view as "max" and clutter the
  // selector. "max" always stays available.
  const visibleTimeframeOptions = useMemo(
    () => TIMEFRAME_OPTIONS.filter((opt) => opt.ms === Infinity || bufferSpanMs >= opt.ms),
    [bufferSpanMs],
  );

  // Fall back to "max" if the current selection just dropped out of range
  // (e.g., user previously picked "1h" and the buffer aged below an hour).
  // Skip while the buffer is empty so the initial default isn't silently
  // overridden during the cold-load window.
  useEffect(() => {
    if (visiblePackets.length === 0) return;
    if (!visibleTimeframeOptions.some((opt) => opt.id === timeframeId)) {
      setTimeframeId("max");
    }
  }, [visibleTimeframeOptions, timeframeId, visiblePackets.length]);

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
      clusters,
      timeDomain: [tMin, now],
    });
  }, [innerW, innerH, clusters, earliestPacketTs, timeframeMs]);

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
      className="relative h-64 sm:h-full"
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
          className={`absolute inset-0 ${
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
        <div
          role="group"
          aria-label="Time window"
          className="absolute right-3 top-3 z-10 flex items-center gap-px rounded-full border border-border/70 bg-surface-raised/85 p-0.5 text-[11px] font-medium tabular-nums shadow-soft backdrop-blur"
        >
          {visibleTimeframeOptions.map((opt) => {
            const active = opt.id === timeframeId;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTimeframeId(opt.id)}
                className={`min-w-[2rem] rounded-full px-2 py-0.5 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  active
                    ? "bg-accent-surface text-accent-text"
                    : "text-content-tertiary hover:text-content-secondary"
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
