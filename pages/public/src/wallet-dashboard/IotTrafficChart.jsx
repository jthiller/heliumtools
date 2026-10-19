import { useMemo } from "react";
import { fmtCount, fmtDataDay, plural } from "./format.js";
import useDaySelect from "./ui/useDaySelect.js";

// Plot height (px) and the y-label gutter. The plot's top line is one "nice"
// max; every column is a stack of its OUIs, series[0] (the largest) at the
// baseline.
const PLOT = 128;
const GUTTER = 30;
// A segment shorter than this is dropped (the readout and the table still
// carry it); a day whose every segment is too short keeps a 2 px stub.
const MIN_SEG = 1.5;
const MISSING_STUB = 38;
const SEG_GAP = 2;

/** A series' color: its OUI slot (the OUI's rank within this Hotspot) from
 * the `--wd-oui-*` tokens, "Other" gray for the folded tail (slot null). */
export function seriesColor(slot) {
  return slot != null && slot >= 0 && slot < 5 ? `rgb(var(--wd-oui-${slot + 1}))` : "rgb(var(--wd-oui-other))";
}

/** Smallest clean round number at or above v (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ). */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const nice = mag >= 1 ? Math.round(step * mag) : step * mag;
    if (nice >= v - 1e-9) return nice;
  }
  return 10 * mag;
}

/** "4K", "3.5K", "600": the top tick. */
const tickText = (v) => (v >= 1000 ? `${Number((v / 1000).toFixed(1))}K` : String(Number(v.toFixed(4))));

/** What an empty day means: a confirmed zero only when the window's
 * unreported days are known (deriveTrafficDetail `missingKnown`). */
const emptyDayText = (missingKnown) => (missingKnown ? "No messages" : "No messages, or not reported");

/** "SkyNet IoT 2,920", one per series with messages that day. */
function dayParts(day, series) {
  return series.filter((s) => (day.values[s.key] || 0) > 0).map((s) => `${s.name} ${fmtCount(day.values[s.key])}`);
}

/** The polite announcement for a day read by keyboard (the bars are hidden from readers). */
function describeDay(day, series, missingKnown) {
  const date = fmtDataDay(day.day, { year: true });
  if (day.missing) return `${date}: no data reported.`;
  if (day.total === 0) return `${date}: ${emptyDayText(missingKnown).toLowerCase()}.`;
  return `${date}: ${plural(day.total, "message")}. ${dayParts(day, series).join(", ")}.`;
}

/**
 * One Hotspot's delivered messages per UTC day for 30 days, stacked by
 * operator (OUI), with the day it shows in a fixed readout above it (so
 * nothing below jumps). A day is always shown (`useDaySelect`: the latest
 * by default; hover previews, click or tap picks,
 * Left/Right/Home/End, Escape back to the default), and keyboard reading is
 * announced politely. An unreported day is the hatch, never a zero; a real
 * zero is a 2 px baseline. Colors are the `--wd-oui-*` tokens, and the per-OUI
 * table beside it is the chart's table view (some light colors are under
 * 3:1). Re-key it per Hotspot to reset the day.
 *
 * @param view  a "ready" result of deriveTrafficDetail
 */
export default function IotTrafficChart({ view }) {
  const { days, series, missingKnown } = view;
  const n = days.length;
  const selDays = useMemo(() => days.map((d) => ({ day: d.day, state: d.missing ? "missing" : "ok" })), [days]);
  // The latest day by default, even when an earlier one went unreported
  // (the hatch and the legend already show those).
  const sel = useDaySelect(selDays, { defaultIndex: n - 1 });

  const top = useMemo(() => niceMax(Math.max(0, ...days.map((d) => d.total))), [days]);
  const columns = useMemo(() => {
    const scale = PLOT / top;
    return days.map((d) => {
      if (d.missing) return { kind: "missing", segs: [] };
      if (d.total === 0) return { kind: "zero", segs: [] };
      let segs = series
        .map((s) => ({ key: s.key, slot: s.slot, h: (d.values[s.key] || 0) * scale }))
        .filter((s) => s.h >= MIN_SEG);
      if (!segs.length) {
        const main = series.reduce((m, s) => ((d.values[s.key] || 0) > (d.values[m.key] || 0) ? s : m));
        segs = [{ key: main.key, slot: main.slot, h: 2 }];
      }
      // Each segment above the first gives up its gap, so the column's height stays true.
      return { kind: "ok", segs: segs.map((s, i) => ({ ...s, h: Math.max(1, Math.round(s.h - (i > 0 ? SEG_GAP : 0))) })) };
    });
  }, [days, series, top]);

  const active = sel.index;
  const shown = active >= 0 ? days[active] : null;
  const first = days[0]?.day;
  const last = days[n - 1]?.day;
  const name = `Daily messages by OUI, ${fmtDataDay(first)} to ${fmtDataDay(last)} (UTC): ${fmtCount(view.total)} total. Use the left and right arrow keys to read each day.`;
  const mid = Math.floor(n / 2);

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div
        aria-hidden="true"
        className="flex min-h-10 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-lg bg-wd-well px-3 py-[9px]"
      >
        {shown && (
          <>
            <span className="text-wd-sm font-semibold text-wd-ink">{fmtDataDay(shown.day, { year: true })}</span>
            <span className="font-display text-wd-s font-semibold text-wd-ink">
              {shown.missing ? "No data reported" : shown.total === 0 ? emptyDayText(missingKnown) : plural(shown.total, "message")}
            </span>
            {!shown.missing && shown.total > 0 && (
              <span className="text-wd-sm text-wd-ink-2">{dayParts(shown, series).join(" · ")}</span>
            )}
          </>
        )}
      </div>

      <div role="group" tabIndex={0} aria-label={name} {...sel.handlers} className="touch-pan-y rounded-lg">
        <div aria-hidden="true" className="relative" style={{ height: PLOT, marginLeft: GUTTER }}>
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-wd-line">
            <span className="absolute -top-2 w-[25px] text-right text-[10px] font-medium leading-4 tabular-nums text-wd-ink-3" style={{ left: -GUTTER }}>
              {tickText(top)}
            </span>
          </div>
          <span className="absolute bottom-0 w-[25px] translate-y-1/2 text-right text-[10px] font-medium leading-4 text-wd-ink-3" style={{ left: -GUTTER }}>
            0
          </span>
          <div className="absolute inset-0 flex items-end gap-0.5 border-b border-wd-control">
            {columns.map((c, i) => {
              const on = i === active;
              return (
                <div
                  key={days[i].day}
                  {...sel.dayProps(i)}
                  className={`flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end rounded-t-[3px] ${on ? "bg-wd-well" : ""}`}
                >
                  <div
                    className={`flex w-full max-w-6 flex-col-reverse gap-0.5 ${
                      on ? "ring-[1.5px] ring-wd-ink ring-offset-2 ring-offset-surface-raised" : ""
                    }`}
                  >
                    {c.kind === "missing" ? (
                      <i className="wd-hatch block w-full opacity-80" style={{ height: MISSING_STUB }} />
                    ) : c.kind === "zero" ? (
                      <i className="block h-0.5 w-full bg-wd-control" />
                    ) : (
                      c.segs.map((s, j) => (
                        <i
                          key={s.key}
                          className={`block w-full ${j === c.segs.length - 1 ? "rounded-t-sm" : ""}`}
                          style={{ height: s.h, background: seriesColor(s.slot) }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div
          aria-hidden="true"
          className="flex justify-between pt-[5px] text-[10px] font-medium leading-[14px] text-wd-ink-3"
          style={{ marginLeft: GUTTER }}
        >
          <span>{fmtDataDay(first)}</span>
          {n > 2 && <span>{fmtDataDay(days[mid]?.day)}</span>}
          <span>{fmtDataDay(last)}</span>
        </div>
      </div>

      {/* Always mounted: a live region announces only text that changes in place. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {sel.keyboard && shown ? describeDay(shown, series, missingKnown) : ""}
      </div>
    </div>
  );
}

/** Legend key for an unreported day: the same hatch as the chart's mark. */
export function MissingDayKey({ className = "" }) {
  return <span aria-hidden="true" className={`wd-hatch inline-block h-2.5 w-2.5 shrink-0 rounded-[3px] ${className}`} />;
}
