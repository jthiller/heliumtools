import useDaySelect from "./useDaySelect.js";

// Share of the plot height the top tick sits at, leaving room above the
// tallest bar for its direct label.
const BAND = 0.84;
// Height of a stub (missing, failed, loading), as a share of the plot.
const STUB = BAND * 0.35;

const SIZES = {
  // Earnings "HNT per day": 184 px plot (156 on phones), every tick labelled.
  l: {
    plot: "h-[156px] md:h-[184px]",
    inset: "left-[34px] md:left-11",
    axis: "mt-2 ml-[34px] md:ml-11",
    tickLabel: "-left-[34px] w-7 md:-left-11 md:w-9",
    tickTop: "border-wd-line-2",
    tickBase: "border-wd-line",
    cols: "gap-0.5",
    bar: "w-[62%] max-w-6",
    label: "text-[11px] leading-4 md:text-xs",
    x: "text-xs leading-4",
    readout: "min-h-[94px] flex-col justify-center gap-0.5 px-3 py-2 md:min-h-16 md:px-3.5 md:py-0",
    allTicks: true,
  },
  // A Hotspot's 7 days in the detail: 112 px plot, a dashed top tick over a
  // control-colored baseline, and a one-line readout that wraps.
  m: {
    plot: "h-28",
    inset: "left-10",
    axis: "mt-1.5 ml-10",
    tickLabel: "-left-10 w-[34px]",
    tickTop: "border-dashed border-wd-line",
    tickBase: "border-wd-control",
    cols: "gap-1.5",
    bar: "w-full max-w-9",
    label: "text-[11px] leading-[14px]",
    x: "text-[11px] leading-[14px]",
    readout: "min-h-10 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-3 py-[9px]",
    allTicks: false,
  },
};

// The keyboard path, said once at the end of every chart's name.
const KEYS_HINT = "Use the left and right arrow keys to read each day.";

// en-US like every other figure on the page (format.js).
const LOCALE = "en-US";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayFmt = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", timeZone: "UTC" });
const fullLabel = (d) => d.label ?? (DAY_RE.test(d.day ?? "") ? dayFmt.format(new Date(`${d.day}T00:00:00Z`)) : String(d.day ?? ""));
const shortLabel = (d, i) => d.short ?? (i > 0 && DAY_RE.test(d.day ?? "") ? String(Number(d.day.slice(8, 10))) : fullLabel(d));
const valueOf = (d) => d.value ?? d.hnt ?? 0;
const fmt2 = (v) => v.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A nice scale over `max`: the smallest step of 1, 2, 2.5 or 5 × 10^k with at most 3 steps above 0. */
function niceScale(max) {
  if (!(max > 0)) return { step: 1, steps: 1 };
  const mag = Math.floor(Math.log10(max));
  let best = null;
  for (let e = mag - 1; e <= mag + 1; e++) {
    for (const f of [1, 2, 2.5, 5]) {
      const step = f * 10 ** e;
      const steps = Math.ceil(max / step - 1e-9);
      if (steps <= 3 && (best === null || step < best.step)) best = { step, steps };
    }
  }
  return best ?? { step: max, steps: 1 };
}

const decimalsOf = (step) => Math.min(4, (String(Number(step.toPrecision(6))).split(".")[1] ?? "").length);

// A day's row of the screen-reader table, as one sentence.
const rowSentence = (row) => (row ? `${row[0]}: ${row.slice(1).filter((c) => c != null && c !== "").join(", ")}` : "");

/**
 * Interactive per-day bars (oldest left), the shared chart of Earnings and the
 * Hotspot detail. `days` are `{ day, value | hnt, state }` with state ok,
 * missing (a hatch, never 0), failed (an outlined well), loading (a pulsing
 * stub); an ok 0 is a 2 px baseline. One nice scale (at most 3 steps), direct
 * labels on the latest and the max day only, the shown day ringed.
 *
 * A day is always shown (`useDaySelect`: hover previews, click or tap picks,
 * Left/Right/Home/End, Escape back to the default) and read in the fixed
 * height `readout(day, { index, selected, preview, keyboard })` above the
 * bars, so nothing below jumps. `label` names the chart and its window
 * ("HNT earned per day from Mobile data transfer, Oct 8 to Oct 14 (UTC)");
 * the arrow-key sentence is appended here. Keyboard reading is announced
 * politely (`announce(day, i)`, default: that day's `srTable` row); `srTable`
 * (`{ caption, columns, rows }`, first cell the row header) is the chart's
 * table view. Pass `selectModel` (a useDaySelect result) to own the
 * selection, e.g. to reset it per wallet. `growKey` (a live arrival seq)
 * replays the bars growing in, staggered 40 ms; never under reduced motion.
 * `size` "l" (Earnings) or "m" (detail); `formatLabel` formats direct labels
 * (the detail passes its 4-decimal day format).
 */
export function DayBars({
  days,
  readout,
  srTable,
  label,
  selectModel,
  announce,
  size = "l",
  formatLabel = fmt2,
  growKey = 0,
  className = "",
  readoutClassName = "",
}) {
  const own = useDaySelect(days);
  const sel = selectModel ?? own;
  const S = SIZES[size] ?? SIZES.l;
  const n = days.length;

  const ok = days.map((d, i) => (d.state === "ok" ? i : -1)).filter((i) => i >= 0);
  const max = Math.max(0, ...ok.map((i) => valueOf(days[i])));
  const { step, steps } = niceScale(max);
  const top = step * steps;
  const pct = (v) => `${((v / top) * BAND * 100).toFixed(2)}%`;
  const dec = decimalsOf(step);
  // No day above 0 (or none loaded): the baseline alone, never an invented scale.
  const tickValues = !(max > 0) ? [0] : S.allTicks ? Array.from({ length: steps + 1 }, (_, i) => step * i) : [0, top];
  // Direct labels: the latest day and the max day (a tie goes to the latest).
  const latest = days[n - 1]?.state === "ok" ? n - 1 : -1;
  let maxIdx = latest;
  for (const i of ok) if (valueOf(days[i]) > (maxIdx >= 0 ? valueOf(days[maxIdx]) : 0)) maxIdx = i;
  const labelled = new Set([latest, maxIdx]);

  const active = sel.index;
  const shown = active >= 0 ? days[active] : null;
  const rows = srTable?.rows ?? [];
  const spoken = sel.keyboard && shown ? (announce ? announce(shown, active) : rowSentence(rows[active])) : "";
  const name = label ? `${String(label).replace(/[\s.]+$/, "")}. ${KEYS_HINT}` : KEYS_HINT;

  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <div
        aria-hidden="true"
        className={`flex rounded-lg bg-wd-well ${S.readout} ${readoutClassName}`}
      >
        {shown && readout?.(shown, {
          index: active,
          selected: active === sel.selectedIndex,
          preview: sel.previewIndex != null,
          keyboard: sel.keyboard,
        })}
      </div>

      <div
        role="group"
        tabIndex={0}
        aria-label={name}
        {...sel.handlers}
        className={`relative mt-3.5 touch-pan-y rounded-lg ${S.plot}`}
      >
        {tickValues.map((v, i) => (
          <div
            key={v}
            aria-hidden="true"
            className={`absolute right-0 h-0 border-t ${S.inset} ${i === 0 ? S.tickBase : S.tickTop}`}
            style={{ bottom: pct(v) }}
          >
            <span className={`absolute -top-2 text-right text-[11px] font-medium leading-4 tabular-nums text-wd-ink-3 ${S.tickLabel}`}>
              {v.toLocaleString(LOCALE, { maximumFractionDigits: dec })}
            </span>
          </div>
        ))}
        <div aria-hidden="true" className={`absolute inset-y-0 right-0 flex ${S.inset} ${S.cols}`}>
          {days.map((d, i) => {
            // A day still loading isn't ringed (the latest stub is the default pick).
            const on = i === active && d.state !== "loading";
            const v = valueOf(d);
            let bar;
            let style;
            if (d.state === "ok" && v > 0) {
              bar = "rounded-t bg-wd-mobile";
              style = { height: pct(v) };
              if (growKey > 0) {
                bar += " origin-bottom motion-safe:animate-bar-grow";
                style.animationDelay = `${ok.indexOf(i) * 40}ms`;
              }
            } else if (d.state === "ok") {
              bar = "h-[2px] bg-wd-control";
            } else {
              style = { height: `${(STUB * 100).toFixed(1)}%` };
              bar =
                d.state === "missing"
                  ? "wd-hatch rounded-t-sm"
                  : d.state === "failed"
                    ? "rounded-t-sm border-[1.5px] border-b-0 border-wd-control bg-wd-well"
                    : "rounded-t-sm bg-wd-line motion-safe:animate-pulse";
            }
            return (
              <div
                key={d.day ?? i}
                {...sel.dayProps(i)}
                className={`flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1 rounded-t-md text-wd-ink ${
                  on ? "bg-[color-mix(in_srgb,currentColor_4%,transparent)]" : ""
                }`}
              >
                <span className={`min-h-4 whitespace-nowrap font-display font-semibold tabular-nums ${S.label}`}>
                  {labelled.has(i) ? formatLabel(v) : ""}
                </span>
                <div
                  key={growKey > 0 && d.state === "ok" ? `${growKey}:${d.day ?? i}` : undefined}
                  className={`min-h-[2px] shrink-0 ${S.bar} ${bar} ${
                    on ? "ring-[1.5px] ring-wd-ink ring-offset-2 ring-offset-surface-raised" : ""
                  }`}
                  style={style}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div aria-hidden="true" className={`flex ${S.axis} ${S.cols}`}>
        {days.map((d, i) => (
          <span
            key={d.day ?? i}
            className={`min-w-0 flex-1 whitespace-nowrap text-center font-medium ${S.x} ${
              i === active ? "font-semibold text-wd-ink" : "text-wd-ink-3"
            }`}
          >
            <span className="max-md:hidden">{fullLabel(d)}</span>
            <span className="md:hidden">{shortLabel(d, i)}</span>
          </span>
        ))}
      </div>

      {/* Always mounted: a live region announces only text that changes in place. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {spoken}
      </div>
      {srTable && (
        // On a wrapper: a table ignores sr-only's 1 px width and would widen the page.
        <div className="sr-only">
          <table>
            <caption>{srTable.caption}</caption>
            <thead>
              <tr>
                {srTable.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  <th scope="row">{row[0]}</th>
                  {row.slice(1).map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The chart's input hint under the bars: arrows on desktop, taps on phones. */
export function DayBarsHint({ className = "" }) {
  return (
    <span aria-hidden="true" className={`text-wd-cap text-wd-ink-3 ${className}`}>
      <span className="max-md:hidden">Use ← → to read each day</span>
      <span className="md:hidden">Tap a day to read it</span>
    </span>
  );
}

export default DayBars;
