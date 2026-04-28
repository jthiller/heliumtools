import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDarkMode from "../lib/useDarkMode.js";
import { readChartColors } from "../lib/chartColors.js";
import { JOIN_FRAME_TYPES, DOWNLINK_FRAME_TYPES } from "../lib/lorawan.js";
import { packetMatchesFilters } from "./filters.js";
import { parseSpreadingFactor, loraAirtimeMs } from "./airtime.js";
import {
  colorForNetIdShade,
  niceTicks,
  plotLeftFor,
  PLOT_RIGHT,
} from "./PacketScatter.jsx";
import { JOIN_COLOR, DOWN_COLOR } from "./EventsBar.jsx";

// Spectrum waterfall: X = frequency (MHz), Y = wall-clock time. Each packet
// draws a rectangle whose width = bandwidth and height = LoRa time-on-air.
// Newest at bottom (SDR convention). Hover/click coordinate with the scatter
// and table via the shared `hover` state.
//
// X axis is piecewise: when packets cluster on widely-separated bands (e.g.
// US915 uplinks at 902–915 MHz and downlinks at 923–928 MHz), the dead air
// in between is compressed to a fixed-width visual break so each cluster
// gets its own readable region.

const PLOT_TOP = 8;
const PLOT_BOTTOM_PAD = 18;

// Sliding time-axis window. The chart is most useful for "what's happening
// right now"; older packets stay in the table and the scatter.
const TIME_WINDOW_MAX_MS = 15 * 60 * 1000;
const DEFAULT_TIME_WINDOW_MS = 60_000;

// Frequency clustering: gaps wider than this between adjacent visible
// frequencies start a new cluster.
const CLUSTER_GAP_MHZ = 5;
// Pixel gap rendered between adjacent clusters on the X axis.
const BREAK_GAP_PX = 14;

// RSSI → opacity. Floor keeps -130 dBm packets faintly visible.
const RSSI_FLOOR_DBM = -130;
const RSSI_CEIL_DBM = -50;
const OPACITY_FLOOR = 0.25;
const OPACITY_CEIL = 0.95;

// US915 sub-band 2 uplink range — fallback when no packets are visible.
const DEFAULT_FREQ_DOMAIN = [902.3, 914.9];

const MIN_RECT_W_PX = 2;
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

// Build frequency clusters: contiguous ranges of activity separated by gaps
// wider than CLUSTER_GAP_MHZ. Each cluster is padded by half-bandwidth so
// edge rectangles aren't clipped.
function computeFreqClusters(visiblePackets) {
  if (visiblePackets.length === 0) {
    return [{ fMin: DEFAULT_FREQ_DOMAIN[0], fMax: DEFAULT_FREQ_DOMAIN[1] }];
  }
  const freqs = visiblePackets.map((p) => p.frequency).sort((a, b) => a - b);
  let bwMaxKHz = 0;
  for (const p of visiblePackets) if (p.bwKHz > bwMaxKHz) bwMaxKHz = p.bwKHz;
  const pad = Math.max(0.05, bwMaxKHz / 2 / 1000);
  const clusters = [];
  let cMin = freqs[0];
  let cMax = freqs[0];
  for (let i = 1; i < freqs.length; i++) {
    if (freqs[i] - cMax > CLUSTER_GAP_MHZ) {
      clusters.push({ fMin: cMin - pad, fMax: cMax + pad });
      cMin = freqs[i];
    }
    cMax = freqs[i];
  }
  clusters.push({ fMin: cMin - pad, fMax: cMax + pad });
  return clusters;
}

function buildScales({ width, height, clusters, timeDomain }) {
  if (!width || !height) return null;
  const xLeft = plotLeftFor(width);
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
    const out = { fMin: c.fMin, fMax: c.fMax, xStart: cursor, xEnd: cursor + w };
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

// Per-cluster ticks. niceTicks gets one call per cluster so labels stay
// inside the cluster's pixel range and breaks read as real splits.
function ticksForClusters(clusters) {
  const out = [];
  for (const c of clusters) {
    const range = c.fMax - c.fMin;
    const count = Math.max(2, Math.min(6, Math.round(range / 2) + 2));
    for (const t of niceTicks(c.fMin, c.fMax, count)) {
      if (t >= c.fMin && t <= c.fMax) out.push(t);
    }
  }
  return out;
}

function drawGrid(ctx, scales, colors, fTicks) {
  const { xLeft, xRight, yTop, yBottom, xScale, clusters } = scales;
  ctx.save();
  ctx.strokeStyle = colors?.grid ?? "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const f of fTicks) {
    const x = Math.round(xScale(f)) + 0.5;
    if (x < xLeft - 0.5 || x > xRight + 0.5) continue;
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

  // Break markers between clusters: a pair of small diagonals straddling
  // the bottom axis line so the visual gap reads as "skipped band".
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

function drawAxisLabels(ctx, scales, fTicks, colors) {
  ctx.save();
  ctx.font = "11px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillStyle = colors?.tickText ?? "#6b7280";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const f of fTicks) {
    const x = scales.xScale(f);
    if (x < scales.xLeft - 1 || x > scales.xRight + 1) continue;
    ctx.fillText(`${f.toFixed(1)}`, x, scales.yBottom + 4);
  }
  ctx.textAlign = "right";
  ctx.fillText("MHz", scales.xRight, scales.yBottom + 4);
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

  const clusters = useMemo(() => computeFreqClusters(visiblePackets), [visiblePackets]);

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

  const fTicks = useMemo(() => {
    if (!innerW) return [];
    const probe = buildScales({ width: innerW, height: 1, clusters, timeDomain: [0, 1] });
    return probe ? ticksForClusters(probe.clusters) : [];
  }, [innerW, clusters]);

  // Stable rect geometry: x/w only depend on freq + width, not time. Cached
  // here and reused every rAF frame; the tick recomputes y/h live so the
  // waterfall scrolls smoothly.
  const rectsBase = useMemo(() => {
    if (!innerW || !clusters.length) return [];
    const probe = buildScales({ width: innerW, height: 1, clusters, timeDomain: [0, 1] });
    if (!probe) return [];
    const out = [];
    for (const p of visiblePackets) {
      const halfBwMhz = p.bwKHz / 2 / 1000;
      const xLeft = probe.xScale(p.frequency - halfBwMhz);
      const xRight = probe.xScale(p.frequency + halfBwMhz);
      const x = Math.min(xLeft, xRight);
      const w = Math.abs(xRight - xLeft);
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

  // 15-min sliding window, anchored to Date.now() per frame so the
  // waterfall scrolls live. Shrinks naturally when the buffer holds less
  // than 15 minutes of data.
  const earliestPacketTs = useMemo(() => {
    if (visiblePackets.length === 0) return null;
    let t = Infinity;
    for (const p of visiblePackets) if (p.timestamp < t) t = p.timestamp;
    return t;
  }, [visiblePackets]);

  const getScales = useCallback(() => {
    if (!innerW || !innerH) return null;
    const now = Date.now();
    const cutoff = now - TIME_WINDOW_MAX_MS;
    const tMin = earliestPacketTs == null
      ? now - DEFAULT_TIME_WINDOW_MS
      : Math.max(earliestPacketTs, cutoff);
    return buildScales({
      width: innerW,
      height: innerH,
      clusters,
      timeDomain: [tMin, now],
    });
  }, [innerW, innerH, clusters, earliestPacketTs]);

  const stateRef = useRef({});
  stateRef.current = {
    canvasRef, innerW, innerH, chartColors, fTicks, getScales, rectsBase,
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
        drawGrid(ctx, scales, s.chartColors, s.fTicks);
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
        drawAxisLabels(ctx, scales, s.fTicks, s.chartColors);
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
      {hover && hover.source === "spectrum" && <HoverTooltip hover={hover} />}
    </div>
  );
}
