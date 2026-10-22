import { memo } from "react";
import { ArrivalFlash, Card, Disclosure, InfoTip, Skeleton } from "../ui/index.js";
import { fmtBytes, fmtCount, fmtDataDay, plural } from "../format.js";
import { CountUp } from "../arrivalMotion.jsx";
import { USERS_NOTE } from "../copy.js";

/** "50.3" + "GB" for a byte figure (the unit is set at half size). */
function splitBytes(v) {
  const s = fmtBytes(v);
  const i = s.lastIndexOf(" ");
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ""];
}

function Stat({ label, tip, wide, busy, children }) {
  return (
    <div
      aria-busy={busy ? true : undefined}
      className={`flex min-w-0 flex-col gap-1 xl:py-[18px] xl:first:pt-0 xl:last:pb-0 xl:[&+&]:border-t xl:[&+&]:border-wd-line-2 ${
        wide ? "max-md:col-span-2" : ""
      }`}
    >
      <dt className="flex items-center gap-1.5 font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-3">
        {label}
        {tip}
      </dt>
      {children}
    </div>
  );
}

const Unit = ({ children }) => <span className="ml-[0.22em] text-[0.5em] font-semibold tracking-normal text-wd-ink-3">{children}</span>;
const Big = ({ children, unit, flash }) => (
  <dd className="relative m-0 rounded-md font-display text-wd-m font-semibold text-wd-ink">
    <ArrivalFlash flashKey={flash} />
    {children}
    {unit && <Unit>{unit}</Unit>}
  </dd>
);

/** A byte figure's number and its unit from the same frame, so a count-up across GB to TB never shows "950 TB". */
function bytesFrame(v) {
  const [n, unit] = splitBytes(v);
  return (
    <>
      <span className="tabular-nums">{n}</span>
      {unit && <Unit>{unit}</Unit>}
    </>
  );
}
const Cap = ({ children }) => <dd className="m-0 text-wd-cap text-wd-ink-3">{children}</dd>;
const Sm = ({ children }) => <dd className="m-0 text-[13px] leading-[18px] text-wd-ink-2">{children}</dd>;

/**
 * The facts beside "HNT per day" (WdEarnings side card, a `dl`): Rewarded
 * data (the bytes the latest day's HNT paid for, and over the 7 days), Users
 * served on the usage day (its own day, named every time; "Not reported" when
 * no Hotspot has a row, never 0) and Hotspots rewarded on the latest day.
 * Stacked from 1280 px, three across below, two on phones. Figures count up
 * and wash on a live arrival (`flashes`: rewards and usage arrival keys).
 * `showData` false (nothing to chart) leaves Users served alone; `failed`
 * says it couldn't load either; `loading` holds the day figures until the
 * Hotspot list loads.
 */
export default memo(function EarningsFacts({ wallet, loading, money, mobile, activity, flashes, showData, failed }) {
  const e = money.earned;
  const latest = e.latest;
  const days = e.days;
  const lastDay = days.length ? days[days.length - 1].day : latest.day;
  const ok = days.filter((d) => d.state === "ok");
  const loadingAny = days.some((d) => d.state === "loading");
  const full = ok.length === days.length;
  const range = days.length ? `${fmtDataDay(days[0].day)} to ${fmtDataDay(lastDay)} (UTC)` : "";
  const span = full ? ` in the 7 days to ${fmtDataDay(lastDay)} (UTC)` : `, over ${plural(ok.length, "day")} with data, ${range}`;
  const latestOk = latest.state === "ok";
  // "of N Mobile Hotspots" needs the Hotspot list (`loading` until it's in).
  const dataReady = !loading && days.length > 0 && (latestOk || latest.state === "missing");

  const usage = mobile.usage;
  const usageFailed = !usage && (mobile.failed?.usage || failed);
  // The saved paint can hold the usage block before the Hotspot list is in:
  // its per-Hotspot count reads 0 until then, which isn't "Not reported".
  const usageWaiting = (!usage && !usageFailed) || (Boolean(usage) && loading && usage.hotspots === 0);
  const coverage = usage?.coverage;

  let rewardedRange = null;
  if (ok.length) {
    const counts = ok.map((d) => d.rewarded ?? 0);
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    rewardedRange = `${lo === hi ? `${fmtCount(lo)} each day` : `${fmtCount(lo)} to ${fmtCount(hi)} a day`}${span}`;
  }

  return (
    <Card>
      <dl className="m-0 grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-x-6 xl:flex xl:flex-col xl:gap-0">
        {showData && (
          <Stat label="Rewarded data" busy={!dataReady}>
            {!dataReady ? (
              <>
                <dd className="m-0">
                  <Skeleton w={92} h={30} />
                  <span className="sr-only">Loading</span>
                </dd>
                <dd className="m-0">
                  <Skeleton w={160} h={14} className="mt-1 max-w-full" />
                </dd>
              </>
            ) : latestOk ? (
              <>
                <Big flash={flashes.rewards}>
                  <CountUp key={wallet} value={latest.bytes} trigger={flashes.rewards} format={bytesFrame} />
                </Big>
                <Cap>{fmtDataDay(latest.day)} (UTC). The data that day&apos;s HNT paid for.</Cap>
                <Sm>{loadingAny ? "Loading earlier days…" : `${fmtBytes(e.weekBytes)}${span}`}</Sm>
              </>
            ) : (
              <>
                <dd className="m-0 text-[13px] leading-[18px] text-wd-ink-2">No data</dd>
                <Cap>{fmtDataDay(latest.day)} (UTC). Not published yet.</Cap>
                {!loadingAny && ok.length > 0 && <Sm>{`${fmtBytes(e.weekBytes)}${span}`}</Sm>}
              </>
            )}
          </Stat>
        )}
        <Stat label="Users served" tip={<InfoTip label="users served">{USERS_NOTE}</InfoTip>} busy={usageWaiting}>
          {usage && !usageWaiting ? (
            <>
              {usage.hotspots > 0 ? (
                <Big flash={flashes.usage}>
                  <span className="tabular-nums">
                    <CountUp key={wallet} value={usage.users} trigger={flashes.usage} format={(v) => fmtCount(Math.round(v))} />
                  </span>
                </Big>
              ) : (
                <dd className="m-0 text-[13px] leading-[18px] text-wd-ink-2">Not reported</dd>
              )}
              <Cap>{fmtDataDay(usage.day)} (UTC)</Cap>
              {usage.hotspots > 0 && coverage && coverage.reported < coverage.rewarded && (
                <Sm>
                  From {fmtCount(coverage.reported)} of {plural(coverage.rewarded, "rewarded Hotspot")}
                </Sm>
              )}
            </>
          ) : usageFailed ? (
            <>
              <dd className="m-0 text-[13px] leading-[18px] text-wd-ink-2">Couldn&apos;t load usage.</dd>
              {activity?.tables?.usage?.error && (
                <dd className="m-0">
                  <Disclosure summary="Details" className="text-wd-cap">
                    <span className="block pt-1">{String(activity.tables.usage.error)}</span>
                  </Disclosure>
                </dd>
              )}
            </>
          ) : (
            <>
              <dd className="m-0">
                <Skeleton w={92} h={30} />
                <span className="sr-only">Loading</span>
              </dd>
              <dd className="m-0">
                <Skeleton w={160} h={14} className="mt-1 max-w-full" />
              </dd>
            </>
          )}
        </Stat>
        {showData && (
          <Stat label="Hotspots rewarded" wide busy={!dataReady}>
            {!dataReady ? (
              <>
                <dd className="m-0">
                  <Skeleton w={92} h={30} />
                  <span className="sr-only">Loading</span>
                </dd>
                <dd className="m-0">
                  <Skeleton w={160} h={14} className="mt-1 max-w-full" />
                </dd>
              </>
            ) : latestOk ? (
              <>
                <Big unit={`of ${fmtCount(latest.of)}`}>{fmtCount(latest.rewarded ?? 0)}</Big>
                <Cap>Mobile Hotspots, {fmtDataDay(latest.day)} (UTC)</Cap>
                <Sm>{loadingAny ? "Loading earlier days…" : rewardedRange}</Sm>
              </>
            ) : (
              <>
                <dd className="m-0 text-[13px] leading-[18px] text-wd-ink-2">No data</dd>
                <Cap>Mobile Hotspots, {fmtDataDay(latest.day)} (UTC)</Cap>
                {!loadingAny && rewardedRange && <Sm>{rewardedRange}</Sm>}
              </>
            )}
          </Stat>
        )}
      </dl>
    </Card>
  );
});
