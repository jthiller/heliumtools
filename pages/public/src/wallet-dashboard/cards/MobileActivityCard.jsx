import { memo, useState } from "react";
import { Card, Skeleton, NameCallout, InfoTip, CountRow, TimeAgo } from "./primitives.jsx";
import { fmtBytes, fmtCount, fmtDataDay, fmtToken, fmtUsd, plural, truncateString } from "../format.js";
import { MOBILE_ISSUES, MOBILE_ISSUE_ORDER } from "../mobileFormat.js";
import { ArrivalFlash, CountUp, useArrivalFlashes } from "../arrivalMotion.jsx";

const TITLE = "Mobile activity";
const NAMES_SHOWN = 4;
const CHART_H = 64; // px, plot only
const BAR_MAX = 24; // px: thin marks, the band's leftover is air
const BAR_SHARE = "62%"; // of a day's column, below BAR_MAX
const STUB_H = Math.round(CHART_H * 0.35); // "no data" / loading stubs

// What each table is called in an error note.
const TABLE_LABEL = {
  rewards: "earnings",
  usage: "usage",
  bans: "bans",
  heartbeats: "heartbeats",
  invalidHeartbeats: "rejected heartbeats",
  speedtests: "speedtests",
};

const STATUS_META = {
  live: { label: "Live", dot: "bg-emerald-500" },
  loading: { label: "Checking", dot: "bg-amber-500", pulse: true },
  paused: { label: "Paused", dot: "bg-content-tertiary" },
  error: { label: "Couldn't check", dot: "bg-rose-500" },
};

// "No data" hatch for a day missing from the table: never drawn as a zero.
const HATCH = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgb(var(--color-content-tertiary) / 0.55) 0 1px, transparent 1px 5px)",
};

// The screen-reader table's words for a day without a value.
const DAY_STATE_TEXT = { missing: "No data", failed: "Couldn't load", loading: "Loading" };
const nameOf = (hotspot) => hotspot.name || truncateString(hotspot.entityKey);
// Small earners keep their digits (0.0034, not 0).
const fmtHnt = (v) => fmtToken(v, { max: v > 0 && v < 0.1 ? 4 : 2 });
const fmtWhole = (v) => fmtCount(Math.round(v));

/** "Live · checked 1 min ago"; the dot pings once per live arrival. Phones
 * show the state alone (the time stays for screen readers), so the title
 * keeps its line. */
function LiveStatus({ phase, checkedAt, ping }) {
  const meta = STATUS_META[phase] || STATUS_META.loading;
  // Re-checking over shown (saved or earlier) data.
  const label = meta === STATUS_META.loading && checkedAt ? "Updating" : meta.label;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-content-secondary">
      <span className="relative flex h-2 w-2">
        {/* Mounted whatever the phase, so it replays only when `ping` (an
            arrival) changes, never when the tab returns; its last frame is
            invisible. */}
        {ping > 0 && (
          <span
            key={ping}
            aria-hidden="true"
            className="absolute hidden h-full w-full rounded-full bg-emerald-500 opacity-75 motion-safe:inline-flex motion-safe:animate-ping-once"
          />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot} ${meta.pulse ? "motion-safe:animate-pulse" : ""}`}
        />
      </span>
      {label}
      {checkedAt ? (
        <span className="sr-only font-normal text-content-tertiary sm:not-sr-only">
          {" "}
          · checked <TimeAgo at={checkedAt} />
        </span>
      ) : null}
    </span>
  );
}

/** Small inset figure (rewarded data, users served), with an optional note. */
function MiniStat({ label, info, flash, sub, children }) {
  return (
    <div className="relative rounded-lg bg-surface-inset px-3 py-2">
      <ArrivalFlash flashKey={flash} />
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
        {label}
        {info && <InfoTip text={info} label={`About ${label.toLowerCase()}`} />}
      </div>
      <div className="mt-0.5 font-display text-lg font-semibold tabular-nums text-content">{children}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-content-tertiary">{sub}</div>}
    </div>
  );
}

/** One day's bar: HNT to scale, a hatch for a day with no data, a quiet stub
 * while it loads (still, once loading it failed). Grows in (staggered) when a
 * new day lands. */
function DayBar({ day, max, hot, grow, index }) {
  if (day.state === "missing") {
    return <div className="rounded-t-sm opacity-80" style={{ ...HATCH, height: STUB_H, width: BAR_SHARE, maxWidth: BAR_MAX }} />;
  }
  if (day.state !== "ok") {
    return (
      <div
        className={`rounded-t-sm bg-surface-inset ${day.state === "loading" ? "motion-safe:animate-pulse" : ""}`}
        style={{ height: STUB_H, width: BAR_SHARE, maxWidth: BAR_MAX }}
      />
    );
  }
  if (!(day.hnt > 0)) return null; // a real zero: nothing above the baseline
  return (
    <div
      className={`rounded-t transition-colors ${hot ? "bg-mobile" : "bg-mobile/70"} ${
        grow ? "origin-bottom motion-safe:animate-bar-grow" : ""
      }`}
      style={{
        height: Math.max(2, Math.round((day.hnt / max) * CHART_H)),
        width: BAR_SHARE,
        maxWidth: BAR_MAX,
        animationDelay: grow ? `${index * 40}ms` : undefined,
      }}
    />
  );
}

/** A day as one plain sentence, for the screen-reader announcement. */
function dayText(d) {
  const day = fmtDataDay(d.day, { year: true });
  if (d.state === "missing") return `${day}: no data`;
  if (d.state === "failed") return `${day}: couldn't load`;
  if (d.state !== "ok") return `${day}: loading`;
  const usd = d.priceUsd != null ? `, ${fmtUsd(d.hnt * d.priceUsd)}` : "";
  return `${day}: ${fmtHnt(d.hnt)} HNT${usd}, ${plural(d.hotspots, "Hotspot")} rewarded`;
}

/**
 * Fleet HNT per UTC day, oldest left. Hover, tap or focus + Left/Right reads
 * a day in the two lines below (announced to screen readers when read by
 * keyboard); the screen-reader table carries every value.
 */
function WeekBars({ days, growKey, weekHnt, daysLoaded }) {
  const [active, setActive] = useState(null);
  const [keyboard, setKeyboard] = useState(false);
  const series = [...days].reverse();
  const n = series.length;
  const max = Math.max(0, ...series.filter((d) => d.state === "ok").map((d) => d.hnt)) || 1;
  const first = series[0]?.day;
  const last = series[n - 1]?.day;
  const loading = series.some((d) => d.state === "loading");
  const failedDays = series.filter((d) => d.state === "failed").length;
  const missing = series.filter((d) => d.state === "missing").length;
  const point = (i) => {
    setKeyboard(false);
    setActive(i);
  };

  const onKeyDown = (e) => {
    let next;
    if (e.key === "ArrowLeft") next = active == null ? n - 1 : Math.max(0, active - 1);
    else if (e.key === "ArrowRight") next = active == null ? n - 1 : Math.min(n - 1, active + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape" && active != null) {
      e.stopPropagation();
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setKeyboard(true);
    setActive(next);
  };

  // Two fixed lines, so nothing clips in a narrow column and the bars don't
  // jump between the total and a day.
  const a = active != null ? series[active] : null;
  let line1;
  let line2 = null;
  if (a) {
    if (a.state === "missing") line1 = `${fmtDataDay(a.day)}: no data`;
    else if (a.state === "failed") line1 = `${fmtDataDay(a.day)}: couldn't load`;
    else if (a.state !== "ok") line1 = `${fmtDataDay(a.day)}: loading…`;
    else {
      line1 = (
        <>
          {fmtDataDay(a.day)}: <span className="font-medium text-content">{fmtHnt(a.hnt)} HNT</span>
          {a.priceUsd != null && ` · ${fmtUsd(a.hnt * a.priceUsd)}`}
        </>
      );
      line2 = `${plural(a.hotspots, "Hotspot")} rewarded`;
    }
  } else if (loading) {
    line1 = "Loading earlier days…";
  } else {
    line1 = (
      <>
        {daysLoaded === n ? `${n}-day total` : `Total over ${plural(daysLoaded, "day")} with data`}:{" "}
        <span className="font-medium text-content">{fmtHnt(weekHnt)} HNT</span>
      </>
    );
    const gaps = [
      missing > 0 && `No data for ${plural(missing, "day")}`,
      failedDays > 0 && `couldn't load ${plural(failedDays, "day")}`,
    ].filter(Boolean);
    if (gaps.length) line2 = gaps.join(", ").replace(/^c/, "C");
  }

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`HNT earned per day from data transfer, ${fmtDataDay(first)} to ${fmtDataDay(last)} (UTC). Use the left and right arrow keys to read each day.`}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}
      className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
    >
      <div
        aria-hidden="true"
        className="flex items-end gap-0.5 border-b border-border"
        style={{ height: CHART_H, touchAction: "pan-y" }}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
      >
        {series.map((d, i) => (
          // The whole column (gap included) is the hit target.
          <div
            key={growKey ? `${growKey}:${d.day}` : d.day}
            className={`flex h-full flex-1 items-end justify-center rounded-t ${active === i ? "bg-content/[0.05]" : ""}`}
            onPointerEnter={() => point(i)}
            onPointerDown={() => point(i)}
          >
            <DayBar day={d} max={max} hot={active === i} grow={growKey > 0} index={i} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between text-[10px] text-content-tertiary">
        <span>{fmtDataDay(first)}</span>
        <span>{fmtDataDay(last)} (UTC)</span>
      </div>
      <div aria-hidden="true" className="mt-1 h-8 text-xs leading-4 tabular-nums text-content-secondary">
        <div className="truncate">{line1}</div>
        {line2 && <div className="truncate text-content-tertiary">{line2}</div>}
      </div>
      {/* Always mounted (a live region announces only text that changes in
          place); speaks only for keyboard reading, so polls stay quiet. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {keyboard && a ? dayText(a) : ""}
      </div>
      {/* The table view, for screen readers. On a wrapper: a table ignores
          sr-only's 1px width and would widen the page. */}
      <div className="sr-only">
        <table>
          <caption>HNT earned per day from data transfer (UTC)</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">HNT</th>
              <th scope="col">Hotspots rewarded</th>
            </tr>
          </thead>
          <tbody>
            {series.map((d) => (
              <tr key={d.day}>
                <th scope="row">{fmtDataDay(d.day, { year: true })}</th>
                <td>{d.state === "ok" ? fmtHnt(d.hnt) : DAY_STATE_TEXT[d.state] ?? "Loading"}</td>
                <td>{d.state === "ok" ? fmtCount(d.hotspots) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Latest-day HNT headline, the 7-day bars, the data rewarded that day, and
 * the usage day's users served. */
function Earnings({ mobile, tables, flashes }) {
  const { rewards, usage } = mobile;
  const latest = rewards?.latest;
  const latestOk = latest?.state === "ok";
  // A failed check with nothing to show reads as failed, never a skeleton
  // that pulses forever (`mobile.failed` also covers a worker that failed).
  const rewardsError = tables.rewards?.state === "error" ? tables.rewards.error || "" : null;
  const usageError = tables.usage?.state === "error" ? tables.usage.error || "" : null;
  const rewardsFailed = rewardsError != null || mobile.failed.rewards;
  const usageFailed = usageError != null || mobile.failed.usage;

  let headline;
  if (latestOk) {
    headline = (
      <div className="min-w-0 flex-1 basis-[170px]">
        <div className="font-display text-3xl font-semibold tabular-nums text-content">
          <CountUp value={latest.hnt} trigger={flashes.tables.rewards} format={fmtHnt} />
          <span className="ml-1.5 text-xl font-medium text-content-tertiary">HNT</span>
        </div>
        <div className="mt-1 text-sm text-content-secondary">Earned from data transfer</div>
        <div className="text-xs text-content-tertiary">
          {latest.priceUsd != null && <>{fmtUsd(latest.hnt * latest.priceUsd)} at that day&apos;s HNT price · </>}
          {fmtCount(latest.hotspots)} of {plural(mobile.mobileTotal, "Hotspot")} rewarded
        </div>
      </div>
    );
  } else if (rewardsFailed) {
    headline = <p className="text-sm text-content-tertiary">Couldn&apos;t load earnings. {rewardsError}</p>;
  } else {
    headline = (
      <div className="min-w-0 flex-1 basis-[170px]">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="mt-2 h-4 w-40" />
      </div>
    );
  }

  // Users served come from the usage report: name its day when it isn't the
  // HNT's, and say when it has no row for some of the day's rewarded Hotspots.
  const coverage = usage?.coverage;
  const usageNote = usage
    ? [
        usage.day !== latest?.day ? `${fmtDataDay(usage.day)} (UTC)` : null,
        coverage && coverage.reported < coverage.rewarded
          ? `From ${fmtCount(coverage.reported)} of ${plural(coverage.rewarded, "rewarded Hotspot")}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="min-w-0 flex-1 basis-[260px]">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        {headline}
        {rewards?.days?.length > 0 && (
          <div className="min-w-0 flex-[1.4] basis-[190px]">
            <WeekBars
              days={rewards.days}
              growKey={flashes.tables.rewards || 0}
              weekHnt={rewards.weekHnt}
              daysLoaded={rewards.daysLoaded}
            />
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {latestOk ? (
          // The bytes behind the HNT above: same table, same day.
          <MiniStat label="Rewarded data" flash={flashes.tables.rewards}>
            <CountUp value={latest.bytes} trigger={flashes.tables.rewards} format={fmtBytes} />
          </MiniStat>
        ) : rewardsFailed ? null : (
          <Skeleton className="h-14" />
        )}
        {usage ? (
          <MiniStat
            label="Users served"
            info="Summed across your Hotspots: a user served by two of them counts twice."
            flash={flashes.tables.usage}
            sub={usageNote}
          >
            <CountUp value={usage.users} trigger={flashes.tables.usage} format={fmtWhole} />
          </MiniStat>
        ) : usageFailed ? (
          <p className="self-center px-1 text-xs text-content-tertiary">Couldn&apos;t load usage. {usageError}</p>
        ) : (
          <Skeleton className="h-14" />
        )}
      </div>
    </div>
  );
}

/** Heartbeats in the window across the WiFi Hotspots, then the issue rows. */
function Health({ mobile, activity, flashes, onShowIssue }) {
  const { counts, groups, wifiTotal, issueText } = mobile;
  const issues = MOBILE_ISSUE_ORDER.filter((k) => counts[k] > 0 && (wifiTotal > 0 || !MOBILE_ISSUES[k].wifi));
  const { tables } = activity;
  const hbError = tables.heartbeats?.state === "error" ? tables.heartbeats.error || "" : null;
  // "None" is real only once every table behind an issue has loaded; a failed
  // one contributes no rows, so it can't vouch for "no issues".
  const settled =
    Object.values(tables).length > 0 &&
    Object.values(tables).every((t) => t.state !== "loading") &&
    MOBILE_ISSUE_ORDER.every((k) => (MOBILE_ISSUES[k].wifi && wifiTotal === 0) || mobile.loaded[MOBILE_ISSUES[k].table]);

  return (
    <div className="min-w-0 flex-1 basis-[260px]">
      {wifiTotal > 0 &&
        (activity.heartbeats ? (
          <div className="relative -mx-2 rounded-md px-2 py-1">
            <ArrivalFlash flashKey={flashes.tables.heartbeats} />
            <div className="font-display text-2xl font-semibold tabular-nums text-content">
              <CountUp value={counts.heartbeating} trigger={flashes.tables.heartbeats} format={fmtWhole} />
              <span className="mx-1.5 text-lg font-medium text-content-tertiary">of</span>
              {fmtCount(wifiTotal)}
            </div>
            <div className="text-sm text-content-secondary">
              WiFi {wifiTotal === 1 ? "Hotspot" : "Hotspots"} with a heartbeat
            </div>
            {/* "in the last 60 min", or the window's end once it's frozen. */}
            <div className="text-xs text-content-tertiary">{mobile.windows.heartbeats.long}</div>
          </div>
        ) : hbError != null || mobile.failed.heartbeats ? (
          <p className="text-sm text-content-tertiary">Couldn&apos;t load heartbeats. {hbError}</p>
        ) : (
          <div>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="mt-2 h-4 w-48" />
          </div>
        ))}

      {issues.length > 0 ? (
        <div className={`-mx-2 ${wifiTotal > 0 ? "mt-3" : ""}`}>
          {issues.map((key) => (
            <CountRow
              key={key}
              color={MOBILE_ISSUES[key].color}
              label={issueText[key].label}
              count={counts[key]}
              valueClass={MOBILE_ISSUES[key].textClass}
              hint={issueText[key].hint}
              onClick={onShowIssue ? () => onShowIssue(key) : undefined}
              flash={flashes.issues[key]}
            />
          ))}
        </div>
      ) : (
        settled &&
        wifiTotal > 0 && <p className="mt-3 text-sm text-content-tertiary">No issues in the latest data.</p>
      )}

      {["banned", "noHeartbeat"]
        .filter((key) => issues.includes(key))
        .map((key) => (
          <div key={key} className="relative rounded-lg">
            <NameCallout
              tone={MOBILE_ISSUES[key].tone}
              title={issueText[key].label}
              names={groups[key].slice(0, NAMES_SHOWN).map(({ hotspot }) => nameOf(hotspot))}
              total={counts[key]}
            />
            <ArrivalFlash flashKey={flashes.issues[key]} />
          </div>
        ))}
    </div>
  );
}

/** The footnote on which Hotspots send heartbeats and speedtests (WiFi), and
 * that those don't change HNT from data transfer. */
function footnoteText(mobileTotal, wifiTotal) {
  const dataOnly = mobileTotal - wifiTotal;
  if (wifiTotal === 0) return "Data-only Hotspots don't send heartbeats or speedtests.";
  const who =
    dataOnly === 0
      ? ""
      : `; your ${dataOnly === 1 ? "data-only Hotspot doesn't" : `${fmtCount(dataOnly)} data-only Hotspots don't`} send them`;
  return `Heartbeats, location trust and speedtests are WiFi health signals${who}. HNT from data transfer doesn't depend on them.`;
}

/**
 * "Mobile activity": the wallet's Mobile Hotspots' latest-day HNT from data
 * transfer (with the 7-day bars and that day's rewarded data), the usage
 * day's users served, and health for WiFi Hotspots (heartbeats in the last
 * 60 min, issue rows that filter the table). Rendered only for wallets with
 * Mobile Hotspots; mount it keyed by wallet (arrival baselines are per wallet).
 *
 * memo: `mobile` (the shell's aggregateMobile) and `activity` (the
 * useMobileActivity state) change only on Mobile updates, so rewards and IoT
 * scan flushes skip this card.
 */
export default memo(function MobileActivityCard({ mobile, activity, onShowIssue }) {
  const flashes = useArrivalFlashes(activity.arrivals, mobile);
  const { phase, tables, checkedAt } = activity;
  const latestDay = mobile.rewards?.latest?.state === "ok" ? mobile.rewards.latest.day : null;
  const subtitle = latestDay ? `Data for ${fmtDataDay(latestDay)} (UTC)` : plural(mobile.mobileTotal, "Mobile Hotspot");

  const failed = Object.entries(tables).filter(([, t]) => t.state === "error");
  // The cause is named only when every failed table shares it.
  const reasons = new Set(failed.map(([, t]) => t.error).filter(Boolean));
  const reason = reasons.size === 1 ? [...reasons][0] : "";
  const hasData = Boolean(activity.rewards || activity.usage || activity.heartbeats || activity.bans);
  let errorNote = null;
  if (phase === "error") {
    errorNote = `Couldn't check the latest data.${reason ? ` ${reason}` : ""}${hasData ? " Showing the last data." : ""}`;
  } else if (failed.length) {
    errorNote = `Couldn't update ${failed.map(([name]) => TABLE_LABEL[name] || name).join(", ")}. ${reason || ""}`;
  }
  const footnote = footnoteText(mobile.mobileTotal, mobile.wifiTotal);

  return (
    <Card
      title={TITLE}
      subtitle={subtitle}
      action={<LiveStatus phase={phase} checkedAt={checkedAt} ping={flashes.any} />}
    >
      {/* Nothing to show and the check failed: the note alone says so. */}
      {(phase !== "error" || hasData) && (
        <div className="mb-4 flex flex-wrap gap-x-8 gap-y-5">
          <Earnings mobile={mobile} tables={tables} flashes={flashes} />
          {(mobile.wifiTotal > 0 || mobile.counts.banned > 0) && (
            <Health mobile={mobile} activity={activity} flashes={flashes} onShowIssue={onShowIssue} />
          )}
        </div>
      )}

      {(errorNote || footnote) && (
        <div className="space-y-1 text-[11px] leading-snug text-content-tertiary">
          {errorNote && <p className="text-rose-600 dark:text-rose-400">{errorNote}</p>}
          {footnote && <p>{footnote}</p>}
        </div>
      )}
    </Card>
  );
});
