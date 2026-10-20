import { memo, useMemo } from "react";
import { Btn2, Card, InfoTip, Progress, Skeleton, useDaySelect } from "../ui/index.js";
import { fmtCount, plural, ONBOARDED_NOTE } from "../format.js";
import { NET, datedText, hotspotOnboardedAt, monthSplit, singleMonthText, timelineOf } from "./aboutModel.js";
import { HotspotName } from "./Composition.jsx";

const CAP = "text-wd-cap text-wd-ink-3";
// The selected month's ring: a raised gap, then an ink line.
const RING = "shadow-[0_0_0_2px_rgb(var(--color-surface-raised)),0_0_0_3.5px_rgb(var(--wd-ink))]";
const seg = (n) => (n > 0 ? { flex: `${n} 1 0px`, minHeight: 1 } : { flex: "0 0 0px" });

function readoutOf(m) {
  if (!m) return "";
  return m.count ? `${plural(m.count, "Hotspot")}${monthSplit(m) ? ` · ${monthSplit(m)}` : ""}` : "No Hotspots";
}

/** The monthly chart: readout, stacked bars, axis, sr table; ←/→ read, a click or Enter filters the list. */
function Chart({ model, onShow }) {
  const { months, top, axis, range, legend } = model;
  const sel = useDaySelect(months);
  const shown = months[sel.index] ?? null;
  const filterBy = (m) => {
    if (m?.count > 0) onShow({ month: m.month });
  };
  const onKeyDown = (e) => {
    if ((e.key === "Enter" || e.key === " ") && shown) {
      e.preventDefault();
      filterBy(shown);
      return;
    }
    sel.handlers.onKeyDown(e);
  };
  const readout = readoutOf(shown);
  const label = `Hotspots onboarded per month, ${range}`;
  return (
    <>
      <div
        aria-hidden="true"
        className="flex min-h-10 flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg bg-wd-well px-3 py-[9px] text-wd-sm"
      >
        <span className="font-semibold text-wd-ink">{shown ? `${shown.full} (UTC)` : ""}</span>
        <span className="text-wd-ink-2">{readout}</span>
        <span className="ml-auto flex items-center gap-3.5 text-wd-cap text-wd-ink-2 max-md:ml-0 max-md:w-full">
          {legend.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <i className={`inline-block h-2.5 w-2.5 rounded-[3px] ${NET[k].fill}`} />
              {NET[k].label}
            </span>
          ))}
        </span>
      </div>
      <div
        role="group"
        tabIndex={0}
        aria-label={`${label}. Use the left and right arrow keys to read each month, and Enter to show that month in the list.`}
        onKeyDown={onKeyDown}
        onMouseLeave={sel.handlers.onMouseLeave}
        onBlur={sel.handlers.onBlur}
        className="relative flex flex-1 flex-col rounded-lg"
      >
        <div aria-hidden="true" className="relative ml-9 min-h-[144px] flex-1 max-md:ml-7">
          <div className="absolute inset-x-0 top-6 border-t border-dashed border-wd-line">
            <span className="absolute -left-9 -top-[9px] w-7 text-right text-[11px] font-medium leading-4 text-wd-ink-3 max-md:-left-7 max-md:w-[22px]">
              {fmtCount(top)}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 top-6 flex items-end gap-0.5">
            {months.map((m, i) => {
              const dp = sel.dayProps(i);
              const on = i === sel.index;
              return (
                <div
                  key={m.month}
                  onPointerEnter={dp.onPointerEnter}
                  onClick={() => {
                    dp.onClick();
                    filterBy(m);
                  }}
                  className={`relative flex h-full min-w-0 flex-1 items-end justify-center ${m.count ? "cursor-pointer" : ""}`}
                >
                  <div
                    className={`flex w-full max-w-6 flex-none flex-col overflow-hidden ${
                      m.count ? "min-h-[2px] rounded-t-[3px]" : "bg-wd-control"
                    } ${on ? RING : ""}`}
                    style={{ height: m.count ? `${m.height.toFixed(2)}%` : 2 }}
                  >
                    {m.count > 0 && (
                      <>
                        <i className="block w-full bg-wd-mobile" style={seg(m.mobile)} />
                        <i className="block w-full bg-wd-iot" style={seg(m.iot)} />
                      </>
                    )}
                  </div>
                  {m.label && (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-display text-xs font-semibold leading-[14px] text-wd-ink"
                      style={{ bottom: `calc(${m.height.toFixed(2)}% + 5px)` }}
                    >
                      {m.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div aria-hidden="true" className="relative ml-9 mt-2 h-4 max-md:ml-7">
          {axis.map((a) => (
            <span key={a.key} className="absolute top-0 whitespace-nowrap text-[11px] font-medium leading-4 text-wd-ink-3" style={a.style}>
              {a.text}
            </span>
          ))}
        </div>
        {/* sr-only on a wrapper: a table ignores width: 1px and would widen the page. */}
        <div className="sr-only">
          <table>
            <caption>{label}</caption>
            <thead>
              <tr>
                <th scope="col">Month (UTC)</th>
                <th scope="col">Mobile</th>
                <th scope="col">IoT</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{m.full}</th>
                  <td>{fmtCount(m.mobile)}</td>
                  <td>{fmtCount(m.iot)}</td>
                  <td>{fmtCount(m.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="sr-only" aria-live="polite">
          {sel.keyboard && shown ? `${shown.full} (UTC): ${readout}` : ""}
        </span>
      </div>
    </>
  );
}

/**
 * About: Onboarding over time. A continuous monthly axis (UTC, zero months
 * kept), each month stacked Mobile over IoT, read with the arrow keys and
 * selected to filter the list by onboard month (`month`). One month reads as
 * a sentence; while onboard dates load, the progress and a skeleton in the
 * chart's place (the chart appears once every date is in, so it never
 * reshuffles).
 */
export default memo(function OnboardingTimeline({ wallet, onboarding, list, onShow, onOpenHotspot, className = "" }) {
  const total = list.counts.total;
  const loading = !onboarding.done;
  const model = useMemo(() => (onboarding.done ? timelineOf(onboarding.stats, total) : null), [onboarding.done, onboarding.stats, total]);
  const single = model?.single ? singleMonthText(onboarding.stats, total) : null;
  const firstName = single ? hotspotOnboardedAt(list, onboarding.stats.oldest) : null;
  const lastName = single ? hotspotOnboardedAt(list, onboarding.stats.newest) : null;
  const caption = loading ? "By month (UTC)" : model ? (model.single ? `${model.months[0].full} (UTC)` : model.range) : null;
  const { done: pDone = 0, total: pTotal = 0 } = onboarding.progress || {};
  const progressText = `Checking onboard dates: ${fmtCount(pDone)} of ${plural(pTotal || total, "Hotspot")}…`;
  // Lookups that failed read as no date in the chart: said, with a Retry for just those.
  const failed = loading ? 0 : (onboarding.failed ?? 0);
  const failure =
    failed > 0 || onboarding.retrying ? (
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
        <span className="text-wd-sm text-wd-ink-2">
          {onboarding.retrying
            ? `Retrying onboard dates for ${plural(failed, "Hotspot")}…`
            : model
              ? `Couldn't read onboard dates for ${plural(failed, "Hotspot")}. They're left out of the chart.`
              : "Couldn't read onboard dates."}
        </span>
        {!onboarding.retrying && onboarding.retry && (
          <Btn2 onClick={onboarding.retry} aria-label="Retry onboard dates">
            Retry
          </Btn2>
        )}
      </div>
    ) : null;

  return (
    <Card
      as="article"
      aria-labelledby="about-time-title"
      busy={loading}
      wdCard="onboarding-timeline"
      className={`flex flex-col gap-4 ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <h3 id="about-time-title" className="m-0 font-display text-wd-title font-semibold text-wd-ink">
            Onboarding over time
          </h3>
          <InfoTip label="onboard dates">{ONBOARDED_NOTE}</InfoTip>
        </div>
        {caption && <span className={CAP}>{caption}</span>}
      </div>

      {loading && (
        <>
          <div className="flex flex-col gap-2 rounded-lg bg-wd-well px-3 py-2.5">
            <span className="text-wd-sm text-wd-ink-2">{progressText}</span>
            {pTotal > 0 && <Progress label="Checking onboard dates" now={pDone} max={pTotal} valueText={progressText} className="!bg-wd-line" />}
          </div>
          <div aria-hidden="true" className="ml-9 flex min-h-[144px] flex-1 items-stretch border-b-2 border-wd-line max-md:ml-7">
            <Skeleton w="100%" style={{ borderRadius: "6px 6px 0 0" }} />
          </div>
          <span className={CAP}>The chart appears once every onboard date is in.</span>
        </>
      )}

      {!loading && !model && !failure && <p className="m-0 text-sm text-wd-ink-2">No onboard dates found.</p>}
      {!model && failure}

      {model && !model.single && (
        <>
          <Chart key={wallet} model={model} onShow={onShow} />
          {failure}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
            <span className={CAP}>{datedText(model.dated, total)}</span>
            <span className={`${CAP} max-md:hidden`}>Use ← → to read each month. Select one to filter the list.</span>
            <span className={`${CAP} md:hidden`}>Tap a month to read it and filter the list.</span>
          </div>
        </>
      )}

      {model?.single && (
        <>
          <div className="flex flex-col gap-1.5 pb-0.5 pt-1">
            <span className="font-display text-wd-s font-semibold tracking-[-0.02em] text-wd-ink">{single.head}</span>
            {single.sub && <span className="text-wd-sm text-wd-ink-2">{single.sub}</span>}
            {firstName && lastName && firstName.key !== lastName.key && (
              <span className="text-wd-sm text-wd-ink-2">
                First <HotspotName item={firstName} onOpenHotspot={onOpenHotspot} className="text-accent-text hover:underline" />, latest{" "}
                <HotspotName item={lastName} onOpenHotspot={onOpenHotspot} className="text-accent-text hover:underline" />.
              </span>
            )}
          </div>
          <span className={CAP}>{datedText(model.dated, total)}</span>
          {failure}
          <p className={`m-0 ${CAP}`}>{ONBOARDED_NOTE}</p>
        </>
      )}
    </Card>
  );
});
