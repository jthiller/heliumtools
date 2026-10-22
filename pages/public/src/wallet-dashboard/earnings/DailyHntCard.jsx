import { memo } from "react";
import { Btn2, Card, CardHead, DayBars, DayBarsHint, Disclosure, Skeleton } from "../ui/index.js";
import { fmtBytes, fmtCount, fmtDataDay, fmtHnt, fmtUsd, plural } from "../format.js";
import { DAY_MISSING_NOTE } from "../copy.js";

const tok = (v) => fmtHnt(v, "stat");
const dayFull = (day) => fmtDataDay(day, { year: true });
const gapWord = (state) => (state === "missing" ? "no data" : state === "failed" ? "couldn't load" : "loading");

/**
 * "HNT per day" (WdEarnings): the fleet's HNT from Mobile data transfer per
 * UTC day for the 7 days, read through `ui/DayBars` (a day is always shown in
 * the fixed readout above the bars: the first gap, else the latest; hover,
 * tap or the arrow keys read another). Missing days are hatched, a day that
 * failed is an outlined well, a loading day pulses; none is drawn as 0 and
 * the total counts only the days with data. Bars grow on a live rewards
 * arrival only (`growKey`). The section keys it by wallet, so the day being
 * read resets per wallet. `failed`: nothing to chart, because the earnings check
 * ("mobile") or the Hotspot list ("fleet") failed, with `onRetry` for it
 * when there is one; `onRetryMobile` retries the days that couldn't load, and
 * the figures that couldn't update (`freshness.earningsNote`, under the total).
 * `loading`: the Hotspot list hasn't loaded, so the chart waits as Summary's
 * Earned column does.
 */
export default memo(function DailyHntCard({ loading, money, mobile, activity, freshness, growKey, failed, onRetry, onRetryMobile }) {
  const e = money.earned;
  const days = e.days;
  const range = days.length ? `${fmtDataDay(days[0].day)} to ${fmtDataDay(days[days.length - 1].day)} (UTC)` : null;
  const of = mobile.mobileTotal;
  const ofText = (n) => `${fmtCount(n ?? 0)} of ${plural(of, "Mobile Hotspot")}`;

  if (failed) {
    const reason = activity?.tables?.rewards?.error;
    return (
      <Card wdCard="earnings-chart" className="flex flex-col gap-3.5">
        <CardHead title="HNT per day" />
        {/* A failed Hotspot list is announced once, by Summary's status line (ui/FleetError). */}
        <div role={failed === "fleet" ? undefined : "alert"} className="flex flex-col items-start gap-2.5 pb-1 pt-2">
          <p className="m-0 text-sm font-semibold text-wd-ink">Couldn&apos;t load earnings.</p>
          <div className="flex w-full flex-col items-stretch gap-2 md:w-auto md:flex-row md:items-center md:gap-3">
            {onRetry && (
              <Btn2 onClick={onRetry} aria-label={failed === "fleet" ? "Retry loading Hotspots" : "Retry earnings"}>
                Retry
              </Btn2>
            )}
            {failed === "fleet" && (
              <span className="text-wd-cap text-wd-ink-2">
                {onRetry ? "They load with the Hotspot list." : "They load with the Hotspot list. Retry above."}
              </span>
            )}
            {reason && failed !== "fleet" && (
              <Disclosure summary="Details" className="text-wd-cap">
                <span className="block pt-1.5">{String(reason)}</span>
              </Disclosure>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Until the Hotspot list loads, a saved paint's days have no "of N Mobile Hotspots".
  if (loading || !days.length) {
    return (
      <Card wdCard="earnings-chart" busy className="flex flex-col gap-3.5">
        <CardHead title="HNT per day" />
        <span className="sr-only">Loading</span>
        <Skeleton className="h-[94px] w-full rounded-lg md:h-16" />
        <Skeleton className="h-[156px] w-full rounded-lg md:h-[184px]" />
        <Skeleton h={14} className="w-[45%]" />
      </Card>
    );
  }

  const ok = days.filter((d) => d.state === "ok");
  const loadingAny = days.some((d) => d.state === "loading");
  // The days shown couldn't update (the latest check failed): said once, with its Retry.
  const stale = freshness.earningsNote;
  const missing = days.filter((d) => d.state === "missing").length;
  const failedDays = days.filter((d) => d.state === "failed").length;
  const priced = ok.filter((d) => d.usd != null);
  const sumUsd = priced.reduce((s, d) => s + d.usd, 0);
  let total = "";
  let totalUsd = "";
  let gap = "";
  if (loadingAny) totalUsd = "Loading earlier days…";
  else {
    total =
      ok.length === days.length
        ? `${days.length}-day total: ${tok(e.weekHnt)} HNT`
        : `Total over ${plural(ok.length, "day")} with data: ${tok(e.weekHnt ?? 0)} HNT`;
    if (priced.length) {
      totalUsd =
        priced.length === ok.length
          ? ` · ${fmtUsd(sumUsd)} at each day's price`
          : ` · ${fmtUsd(sumUsd)} at each day's price, over the ${plural(priced.length, "day")} with a price`;
    }
    const gp = [];
    if (missing) gp.push(`no data for ${plural(missing, "day")}`);
    if (failedDays) gp.push(`couldn't load ${plural(failedDays, "day")}`);
    gap = gp.join(", ");
    gap = gap.charAt(0).toUpperCase() + gap.slice(1);
  }

  const readout = (d) => {
    if (d.state === "ok") {
      return (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
            <span className="font-semibold text-wd-ink">{fmtDataDay(d.day)} (UTC)</span>
            <span className="font-display text-base font-semibold leading-[22px] tracking-[-0.02em] text-wd-ink md:text-wd-s">
              {tok(d.hnt)} HNT
            </span>
            {d.usd != null && (
              <span className="text-[13px] leading-[18px] text-wd-ink-2 max-md:basis-full">{fmtUsd(d.usd)} at that day&apos;s price</span>
            )}
            {freshness.asOf && <span className="text-wd-cap text-wd-ink-2">{freshness.asOf}</span>}
          </div>
          <div className="flex min-h-[18px] flex-col text-wd-cap text-wd-ink-2 md:flex-row md:flex-wrap md:gap-x-1.5 md:text-[13px] md:leading-[18px]">
            <span>{fmtBytes(d.bytes)} rewarded</span>
            <span className="max-md:hidden">·</span>
            <span>{ofText(d.rewarded)} rewarded</span>
          </div>
        </>
      );
    }
    if (d.state === "missing") {
      return (
        <>
          <span className="font-semibold text-wd-ink">No data for {fmtDataDay(d.day)} (UTC)</span>
          <span className="text-[13px] leading-[18px] text-wd-ink-2">{DAY_MISSING_NOTE}</span>
        </>
      );
    }
    if (d.state === "failed") {
      return (
        <>
          <span className="font-semibold text-wd-ink">Couldn&apos;t load {fmtDataDay(d.day)} (UTC)</span>
          <span className="text-[13px] leading-[18px] text-wd-ink-2">Left out of the total until it loads.</span>
        </>
      );
    }
    return (
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="font-semibold text-wd-ink">{fmtDataDay(d.day)} (UTC)</span>
        <span className="text-[13px] leading-[18px] text-wd-ink-2">Loading…</span>
      </div>
    );
  };

  const srTable = {
    caption: "HNT earned per day from Mobile data transfer (UTC)",
    columns: ["Day", "HNT", "USD at that day's price", "Rewarded data", "Mobile Hotspots rewarded"],
    rows: days.map((d) => [
      dayFull(d.day),
      d.state === "ok" ? tok(d.hnt) : d.state === "missing" ? "No data" : d.state === "failed" ? "Couldn't load" : "Loading",
      d.state === "ok" && d.usd != null ? fmtUsd(d.usd) : "",
      d.state === "ok" ? fmtBytes(d.bytes) : "",
      d.state === "ok" ? ofText(d.rewarded) : "",
    ]),
  };
  const announce = (d) =>
    d.state === "ok"
      ? `${dayFull(d.day)}: ${tok(d.hnt)} HNT${d.usd != null ? `, ${fmtUsd(d.usd)}` : ""}, ${ofText(d.rewarded)} rewarded`
      : `${dayFull(d.day)}: ${gapWord(d.state)}`;

  return (
    <Card wdCard="earnings-chart" busy={loadingAny} className="flex flex-col gap-3.5">
      <CardHead title="HNT per day" right={range} />
      <DayBars
        days={days}
        readout={readout}
        srTable={srTable}
        announce={announce}
        label={`HNT earned per day from Mobile data transfer, ${range}`}
        growKey={growKey}
        formatLabel={(v) => fmtHnt(v, "list")}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-[13px] leading-[18px]">
          {total && <span className="font-semibold text-wd-ink">{total}</span>}
          <span className="text-wd-ink-2">{totalUsd}</span>
          {gap && (
            <div className="mt-1.5 flex flex-col items-stretch gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
              <span className="text-wd-ink-2">{gap}</span>
              {failedDays > 0 && !stale && (
                <Btn2 onClick={onRetryMobile} aria-label="Retry the days that couldn't load">
                  Retry
                </Btn2>
              )}
            </div>
          )}
          {stale && (
            <div className="mt-1.5 flex flex-col items-stretch gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
              <span className="text-wd-ink-2">{stale}</span>
              <Btn2 onClick={onRetryMobile} aria-label="Retry earnings">
                Retry
              </Btn2>
            </div>
          )}
        </div>
        <DayBarsHint />
      </div>
    </Card>
  );
});
