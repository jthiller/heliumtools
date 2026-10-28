import { memo, useEffect, useMemo, useRef, useState } from "react";
import useDarkMode from "../lib/useDarkMode.js";
import { readChartColors } from "../lib/chartColors.js";
import { PatternSheet, Swatch } from "./patterns.jsx";
import {
  FATES, FATE, fateColor, fmtHnt, fmtHntCompact, fmtShortDay, fmtDateTime, fmtDay, daysBetween, fmtDays,
  destinationText, outflowFate, seatTitle, shortAddress, toHnt,
} from "./format.js";

const DAY = 86_400;
const GUTTER_WIDE = 104; // seat labels
const GUTTER_NARROW = 64;
const RIGHT = 16;
const LANE_H = 92;
const UP_MAX = 34; // tallest emission bar
const DOWN_MAX = 26; // tallest outflow marker
const AXIS_H = 22;
const NARROW = 560; // below this the timeline fits the screen instead of scrolling

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function monthTicks(t0, t1) {
  const out = [];
  const d = new Date(t0 * 1000);
  let cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  while (cur < t1) {
    out.push(cur);
    const c = new Date(cur * 1000);
    cur = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1) / 1000;
  }
  return out;
}

const mixEntries = (mix) =>
  FATES.filter((f) => mix[f.kind] && BigInt(mix[f.kind]) > 0n).map((f) => ({ kind: f.kind, raw: mix[f.kind] }));

/**
 * One lane per seat on a shared UTC date axis. Emissions rise above each
 * lane's line, colored by where they went; outflows drop below it. Hovering
 * or focusing an emission highlights the outflows that carried it, and back.
 */
function EmissionsTimeline({ summary, onOpen }) {
  const wrapRef = useRef(null);
  const measured = useWidth(wrapRef);
  const narrow = measured > 0 && measured < NARROW;
  const width = narrow ? measured : Math.max(NARROW, measured || 0);
  const GUTTER = narrow ? GUTTER_NARROW : GUTTER_WIDE;
  const dark = useDarkMode();
  const chart = useMemo(() => readChartColors(), [dark]);
  const [rawActive, setActive] = useState(null); // { lane, type: 'lot'|'out', index }
  // A refreshed summary can shrink a lane; a mark that no longer exists is no mark.
  const markOf = (a) => (a ? summary.lanes[a.lane]?.[a.type === "lot" ? "lots" : "outflows"]?.[a.index] ?? null : null);
  const active = markOf(rawActive) ? rawActive : null;
  const [focusLane, setFocusLane] = useState(null);

  const t0 = Math.floor(summary.fanout.createdAt / DAY) * DAY;
  const t1 = Math.max(Math.floor(Date.now() / 1000), (summary.indexedThrough?.t ?? t0) + DAY) + DAY / 2;
  const plotW = width - GUTTER - RIGHT;
  const x = (t) => GUTTER + ((t - t0) / (t1 - t0)) * plotW;
  const dayPx = (DAY / (t1 - t0)) * plotW;
  const barW = Math.max(2, Math.min(10, dayPx * 0.62));

  const maxLot = useMemo(() => {
    let m = 0;
    for (const lane of summary.lanes) for (const l of lane.lots) m = Math.max(m, toHnt(l.amount));
    return m || 1;
  }, [summary]);
  const maxOut = useMemo(() => {
    let m = 0;
    for (const lane of summary.lanes) for (const o of lane.outflows) m = Math.max(m, toHnt(o.amount));
    return m || 1;
  }, [summary]);

  const seatsByWallet = useMemo(() => Object.fromEntries(summary.seats.map((s) => [s.wallet, s])), [summary]);
  const height = AXIS_H + summary.lanes.length * LANE_H + 4;
  const ticks = monthTicks(t0, t1);

  // Links between the active mark and its counterparts on the same lane.
  const linked = useMemo(() => {
    if (!active) return null;
    const lane = summary.lanes[active.lane];
    if (!lane) return null;
    if (active.type === "lot") {
      return { lots: new Set([active.index]), outs: new Set(lane.outflows.map((o, i) => (o.lotIdx.includes(active.index) ? i : -1)).filter((i) => i >= 0)) };
    }
    return { lots: new Set(lane.outflows[active.index]?.lotIdx || []), outs: new Set([active.index]) };
  }, [active, summary]);

  const marksFor = (laneIdx) => {
    const lane = summary.lanes[laneIdx];
    return [
      ...lane.lots.map((l, i) => ({ type: "lot", index: i, t: l.t })),
      ...lane.outflows.map((o, i) => ({ type: "out", index: i, t: o.t })),
    ].sort((a, b) => a.t - b.t || (a.type === "lot" ? -1 : 1));
  };

  const onKeyDown = (laneIdx) => (e) => {
    const marks = marksFor(laneIdx);
    if (!marks.length) return;
    const pos = active?.lane === laneIdx ? marks.findIndex((m) => m.type === active.type && m.index === active.index) : -1;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? Math.min(marks.length - 1, pos + 1) : Math.max(0, pos < 0 ? marks.length - 1 : pos - 1);
      setActive({ lane: laneIdx, ...marks[next] });
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive({ lane: laneIdx, ...marks[e.key === "Home" ? 0 : marks.length - 1] });
    } else if (e.key === "Enter" && active?.lane === laneIdx) {
      openActive(active);
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  const openActive = (a) => {
    const lane = summary.lanes[a.lane];
    if (a.type === "lot") onOpen?.({ wallet: lane.wallet, lot: lane.lots[a.index].sig });
    else onOpen?.({ wallet: lane.wallet, tx: lane.outflows[a.index].sig });
  };

  const tip = active ? tooltipFor(active, summary, seatsByWallet, dark) : null;
  const tipX = active ? x(markOf(active).t) : 0;
  const kindsShown = useMemo(() => {
    const seen = new Set();
    for (const lane of summary.lanes) {
      for (const l of lane.lots) for (const k of Object.keys(l.mix)) seen.add(k);
      for (const o of lane.outflows) seen.add(outflowFate(o.kind));
    }
    return FATES.filter((f) => seen.has(f.kind));
  }, [summary]);
  const tipY = active ? AXIS_H + active.lane * LANE_H + (active.type === "lot" ? 8 : LANE_H - 6) : 0;

  return (
    <div className="relative">
      <PatternSheet dark={dark} />
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-content-secondary" aria-label="Colors">
        {kindsShown.map((f) => (
          <li key={f.kind} className="flex items-center gap-1.5">
            <Swatch kind={f.kind} dark={dark} />
            {f.label}
          </li>
        ))}
      </ul>
      {/* What the focused mark is, for screen readers (the tooltip is visual). */}
      <p className="sr-only" aria-live="polite">{active ? srText(active, summary, seatsByWallet) : ""}</p>
      <div ref={wrapRef} className="overflow-x-auto overscroll-x-contain">
        <svg
          width={width}
          height={height}
          className="block select-none"
          aria-label="Emissions timeline. Each seat is a group; use Tab to reach a seat and the arrow keys to move between its emissions and transfers."
          onMouseLeave={() => setActive(null)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setActive(null);
          }}
        >
          {/* month grid */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={AXIS_H - 4} y2={height} stroke={chart?.grid} strokeDasharray="2 4" />
              <text x={x(t) + 4} y={13} fontSize="11" fill={chart?.tickText} className="font-mono">
                {new Date(t * 1000).toLocaleString("en-US", { month: "short", timeZone: "UTC" })}
              </text>
            </g>
          ))}
          <text x={GUTTER} y={13} fontSize="11" fill={chart?.tickText} className="font-mono">{fmtShortDay(t0)}</text>

          {summary.lanes.map((lane, li) => {
            const seat = seatsByWallet[lane.wallet];
            const top = AXIS_H + li * LANE_H;
            const base = top + 8 + UP_MAX + 6;
            const dim = (type, i) => linked && !(type === "lot" ? linked.lots.has(i) : linked.outs.has(i)) && active?.lane === li;
            const labels = !narrow && lane.outflows.length <= 6 ? placeLabels(lane.outflows, x, width - RIGHT) : [];
            return (
              <g
                key={lane.wallet}
                tabIndex={0}
                role="group"
                aria-label={`${seat ? seatTitle(seat) : "Seat"}, ${lane.lots.length} emissions, ${lane.outflows.length} outgoing transfers. Use the arrow keys to move between them and Enter to open one.`}
                onKeyDown={onKeyDown(li)}
                onFocus={() => { setFocusLane(li); if (active?.lane !== li) setActive(null); }}
                onBlur={() => setFocusLane(null)}
                className="outline-none"
              >
                <rect x={1} y={top + 1} width={width - 2} height={LANE_H - 2} rx={10} fill="transparent" stroke={focusLane === li ? chart?.stroke : "transparent"} strokeWidth={2} />
                <line x1={GUTTER} x2={width - RIGHT} y1={base} y2={base} stroke={chart?.grid} />
                <text x={10} y={base - 6} fontSize="13" fontWeight="600" fill={chart?.tooltipText}>{seat ? seatTitle(seat) : "Seat"}</text>
                <text x={10} y={base + 12} fontSize="11" fill={chart?.tickText} className="font-mono">{narrow ? `${lane.wallet.slice(0, 4)}…` : shortAddress(lane.wallet)}</text>

                {lane.lots.map((lot, i) => {
                  const h = Math.max(3, (toHnt(lot.amount) / maxLot) * UP_MAX);
                  const total = Number(lot.amount) || 1;
                  let y = base;
                  const cx = x(lot.t);
                  return (
                    <g
                      key={`${lot.sig}:${i}`}
                      opacity={dim("lot", i) ? 0.25 : 1}
                      onMouseEnter={() => setActive({ lane: li, type: "lot", index: i })}
                      onClick={() => openActive({ lane: li, type: "lot", index: i })}
                      style={{ cursor: "pointer" }}
                    >
                      <rect x={cx - barW / 2 - 2} y={base - UP_MAX - 2} width={barW + 4} height={UP_MAX + 2} fill="transparent" />
                      {mixEntries(lot.mix).map(({ kind, raw }) => {
                        const seg = (Number(raw) / total) * h;
                        y -= seg;
                        return <rect key={kind} x={cx - barW / 2} y={y} width={barW} height={Math.max(seg, 0.5)} fill={fateColor(kind, dark)} />;
                      })}
                      {active?.lane === li && active.type === "lot" && active.index === i && (
                        <rect x={cx - barW / 2 - 2} y={base - h - 2} width={barW + 4} height={h + 2} fill="none" stroke={chart?.tooltipText} strokeWidth={1.5} rx={2} />
                      )}
                    </g>
                  );
                })}

                {lane.outflows.map((o, i) => {
                  const h = 6 + Math.sqrt(toHnt(o.amount) / maxOut) * (DOWN_MAX - 6);
                  const cx = x(o.t);
                  const color = fateColor(outflowFate(o.kind), dark);
                  const isActive = active?.lane === li && active.type === "out" && active.index === i;
                  return (
                    <g
                      key={`${o.sig}:${i}`}
                      opacity={dim("out", i) ? 0.25 : 1}
                      onMouseEnter={() => setActive({ lane: li, type: "out", index: i })}
                      onClick={() => openActive({ lane: li, type: "out", index: i })}
                      style={{ cursor: "pointer" }}
                    >
                      <rect x={cx - 5} y={base + 2} width={10} height={DOWN_MAX + 2} fill="transparent" />
                      <path d={`M${cx - 4},${base + 3} L${cx + 4},${base + 3} L${cx},${base + 3 + h} Z`} fill={color} stroke={isActive ? chart?.tooltipText : "none"} strokeWidth={1.5} />
                      {labels[i] && (
                        <text
                          x={labels[i].x}
                          textAnchor={labels[i].anchor}
                          y={base + 3 + Math.min(h, 16)}
                          fontSize="10.5"
                          fill={chart?.tickText}
                        >
                          {labels[i].text}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* today */}
          <line x1={x(Date.now() / 1000)} x2={x(Date.now() / 1000)} y1={AXIS_H - 4} y2={height} stroke={chart?.stroke} strokeOpacity={0.5} />
        </svg>
      </div>

      {tip && (
        <div
          className="pointer-events-none absolute z-10 w-72 rounded-xl bg-surface-raised p-3 text-xs shadow-soft-lg"
          style={{
            left: Math.min(Math.max(8, tipX - (wrapRef.current?.scrollLeft || 0) - 144), (measured || width) - 296),
            top: active.type === "lot" ? tipY - 8 : tipY + 10,
            transform: active.type === "lot" ? "translateY(-100%)" : "none",
          }}
          aria-hidden="true"
        >
          {tip}
        </div>
      )}
    </div>
  );
}

// Outflow labels, placed left to right without overlapping: right of the
// marker when it fits, else left of it, else none (the tooltip still has it).
function placeLabels(outflows, x, maxX) {
  const CHAR_W = 6;
  const placed = [];
  let lastRight = -Infinity;
  outflows.forEach((o, i) => {
    const text = `${fmtHntCompact(o.amount)} · ${shortDestination(o)}`;
    const w = text.length * CHAR_W;
    const cx = x(o.t);
    const nextX = i + 1 < outflows.length ? x(outflows[i + 1].t) - 6 : maxX;
    if (cx + 7 + w <= Math.min(nextX, maxX) && cx + 7 > lastRight) {
      placed[i] = { text, x: cx + 7, anchor: "start" };
      lastRight = cx + 7 + w + 6;
    } else if (cx - 7 - w > lastRight) {
      placed[i] = { text, x: cx - 7, anchor: "end" };
      lastRight = cx + 6;
    }
  });
  return placed;
}

function shortDestination(o) {
  if (o.kind === "swapped") return "Swapped";
  if (o.kind === "exchange" || o.kind === "exchange_deposit") return o.label?.org || "Exchange";
  if (o.kind === "vehnt") return "veHNT";
  return o.label?.name || "Wallet";
}

function srText(active, summary, seatsByWallet) {
  const lane = summary.lanes[active.lane];
  const seat = seatsByWallet[lane.wallet];
  const who = seat ? seatTitle(seat) : "Seat";
  if (active.type === "lot") {
    const lot = lane.lots[active.index];
    const parts = mixEntries(lot.mix).map(({ kind, raw }) => `${FATE[kind]?.label ?? kind} ${fmtHnt(raw)}`).join(", ");
    return `${who}, emission of ${fmtHnt(lot.amount)} on ${fmtDateTime(lot.t)}: ${parts}. Press Enter for the full path.`;
  }
  const o = lane.outflows[active.index];
  return `${who}, ${fmtHnt(o.amount)} sent out on ${fmtDateTime(o.t)}: ${destinationText(o)}. Press Enter to open it.`;
}

function tooltipFor(active, summary, seatsByWallet, dark) {
  const lane = summary.lanes[active.lane];
  const seat = seatsByWallet[lane.wallet];
  if (active.type === "lot") {
    const lot = lane.lots[active.index];
    const parts = mixEntries(lot.mix);
    return (
      <>
        <p className="font-semibold text-content">{fmtHnt(lot.amount)} emitted to {seat ? seatTitle(seat) : "the seat"}</p>
        <p className="mt-0.5 text-content-tertiary">{fmtDateTime(lot.t)}</p>
        <ul className="mt-2 space-y-1">
          {parts.map(({ kind, raw }) => (
            <li key={kind} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-content-secondary">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: fateColor(kind, dark) }} />
                {FATE[kind]?.label ?? kind}
              </span>
              <span className="font-mono tabular-nums text-content">{fmtHnt(raw, { unit: false })}</span>
            </li>
          ))}
        </ul>
        {lot.firstLeftAt && (
          <p className="mt-2 text-content-tertiary">
            First left the wallet {fmtDay(lot.firstLeftAt)}, {fmtDays(daysBetween(lot.t, lot.firstLeftAt))}.
          </p>
        )}
        <p className="mt-2 text-content-tertiary">Click or press Enter for the full path.</p>
      </>
    );
  }
  const o = lane.outflows[active.index];
  return (
    <>
      <p className="font-semibold text-content">{fmtHnt(o.amount)} out of {seat ? seatTitle(seat) : "the seat"}</p>
      <p className="mt-0.5 text-content-tertiary">{fmtDateTime(o.t)}</p>
      <p className="mt-2 text-content-secondary">{destinationText(o)}</p>
      <p className="mt-1 text-content-tertiary">
        Carried {o.lotIdx.length} {o.lotIdx.length === 1 ? "emission" : "emissions"} (oldest first).
      </p>
    </>
  );
}

export default memo(EmissionsTimeline);
