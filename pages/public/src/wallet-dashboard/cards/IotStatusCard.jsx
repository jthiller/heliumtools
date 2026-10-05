import { memo, useMemo } from "react";
import { Card, Skeleton, ProgressBar, Dot, NameCallout, InfoTip } from "./primitives.jsx";
import {
  fmtCount,
  fmtCompact,
  fmtDataDay,
  fmtDayRange,
  fmtLowerBound,
  indexForBuild,
  byMessagesDesc,
  IOT_STATUS_LABEL,
  IOT_STATUS_COLOR,
  IOT_HEALTH,
  IOT_HEALTH_ORDER,
  IOT_MESSAGES_NOTE,
  IOT_CONNECTIVITY_NOTE,
} from "../format.js";

const TITLE = "IoT connectivity & traffic";
const NAMES_SHOWN = 4;

/** The `n` first entries of `list` under `cmp`, without sorting all of it
 * (a quiet group can be most of a large fleet; the card shows four). */
function topEntries(list, n, cmp) {
  const top = [];
  for (const item of list) {
    if (top.length === n && cmp(item, top[n - 1]) >= 0) continue;
    let i = top.length;
    while (i > 0 && cmp(item, top[i - 1]) < 0) i--;
    top.splice(i, 0, item);
    if (top.length > n) top.pop();
  }
  return top;
}

/**
 * Card subtitle naming the UTC data day(s) shown. Liveness and traffic are
 * separate feeds: when both cover the same single day say it once, otherwise
 * label each (as a range when rows disagree).
 */
function dataDaysLabel(livenessRange, trafficRange) {
  const single = (r) => r && r.min === r.max;
  if (single(livenessRange) && single(trafficRange) && livenessRange.min === trafficRange.min) {
    return `Data for ${fmtDataDay(livenessRange.min)} (UTC)`;
  }
  const parts = [
    livenessRange && `Connectivity ${fmtDayRange(livenessRange)}`,
    trafficRange && `Traffic through ${fmtDayRange(trafficRange)}`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} (UTC)` : null;
}

/** The all-zero sentence, honest about a denominator smaller than the fleet. */
function noneCarriedText(known, iotTotal, day) {
  const all = known === iotTotal;
  const which = all ? "" : " with traffic data";
  if (known === 1) return `${all ? "Your" : "The"} IoT Hotspot${which} carried no traffic in the 30 days through ${day}.`;
  return `None of ${all ? "your" : "the"} ${fmtCount(known)} IoT Hotspots${which} carried traffic in the 30 days through ${day}.`;
}

/** One "● label … count" row; a full-width button when `onClick` is given. */
function CountRow({ color, label, count, valueClass = "text-content", hint, onClick }) {
  const rowClass = "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm";
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <Dot color={color} />
        <span className="truncate text-content-secondary">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {onClick && (
          <span
            aria-hidden="true"
            className="text-xs font-medium text-accent-text opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            Show →
          </span>
        )}
        <span className={`font-medium tabular-nums ${valueClass}`}>{fmtCount(count)}</span>
      </span>
    </>
  );
  if (!onClick) {
    return (
      <div className={rowClass} title={hint}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-label={`${label}: ${fmtCount(count)}. Show them in the Hotspot table.`}
      className={`group ${rowClass} text-left transition hover:bg-surface-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      {body}
    </button>
  );
}

// memo: props are the shell's memoized aggregate + scan state, which only
// change on IoT scan flushes — skip the rewards-scan re-renders.
export default memo(function IotStatusCard({ iotStatus, done, utilizationIndex, onShowHealth }) {
  // Names for the two actionable states, most messages first.
  const names = useMemo(
    () => ({
      inactiveTraffic: topEntries(iotStatus.groups.inactiveTraffic, NAMES_SHOWN, byMessagesDesc),
      activeQuiet: topEntries(iotStatus.groups.activeQuiet, NAMES_SHOWN, byMessagesDesc),
    }),
    [iotStatus.groups],
  );

  // Rendered only for wallets with IoT Hotspots, so iotTotal > 0 here.
  const scanning = !done;
  const subtitle = scanning
    ? `Checking ${fmtCount(iotStatus.counted)} of ${fmtCount(iotStatus.iotTotal)} IoT Hotspots…`
    : dataDaysLabel(iotStatus.livenessRange, iotStatus.trafficRange);
  const progressBar = scanning && (
    <div className="mb-4">
      <ProgressBar done={iotStatus.counted} total={iotStatus.iotTotal} />
    </div>
  );

  // Nothing resolved yet (also covers the stale frame right after a fleet
  // swap, before the scan resets — no false 0-of-0).
  if (iotStatus.counted === 0) {
    return (
      <Card title={TITLE} subtitle={subtitle}>
        {progressBar}
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  const { traffic } = iotStatus;
  const trafficDay = fmtDayRange(iotStatus.trafficRange);

  // Why there's no traffic headline. While the scan runs and every row so far
  // is "unavailable", more rows may still bring data — keep a placeholder.
  let trafficNote = null;
  if (traffic.known === 0) {
    if (traffic.unpublished > 0) trafficNote = "Traffic data isn't published right now.";
    else if (done && traffic.unavailable > 0) trafficNote = "Traffic data is unavailable right now.";
  }

  // The window is partial when the published build is missing days; only
  // applies if the rows we hold come from that same build.
  const build = indexForBuild(utilizationIndex, iotStatus.trafficRange?.max);
  const lowerBound = build && build.daysComplete < build.days;

  const footnote = [
    // The headline's denominator is the rows with traffic data; say so once
    // the scan is done (mid-scan the progress line explains the gap).
    done &&
      traffic.known > 0 &&
      traffic.known < iotStatus.iotTotal &&
      `${fmtCount(traffic.known)} of ${fmtCount(iotStatus.iotTotal)} with traffic data`,
    iotStatus.settingUp > 0 && `${fmtCount(iotStatus.settingUp)} setting up`,
    iotStatus.unknown > 0 && `${fmtCount(iotStatus.unknown)} unknown`,
    traffic.known > 0 && traffic.statusNoData > 0 && `${fmtCount(traffic.statusNoData)} without traffic data`,
  ]
    .filter(Boolean)
    .join(" · ");

  // No traffic data at all: connectivity counts only.
  if (traffic.known === 0) {
    return (
      <Card title={TITLE} subtitle={subtitle}>
        {progressBar}
        <div className="-mx-2">
          <CountRow
            color={IOT_STATUS_COLOR.active}
            label={IOT_STATUS_LABEL.active}
            count={iotStatus.active}
            hint={IOT_CONNECTIVITY_NOTE}
          />
          <CountRow
            color={IOT_STATUS_COLOR.inactive}
            label={IOT_STATUS_LABEL.inactive}
            count={iotStatus.inactive}
            valueClass={iotStatus.inactive > 0 ? IOT_HEALTH.inactiveTraffic.textClass : undefined}
            hint={IOT_CONNECTIVITY_NOTE}
          />
        </div>
        {trafficNote ? (
          <p className="mt-3 text-sm text-content-tertiary">{trafficNote}</p>
        ) : (
          <Skeleton className="mt-3 h-4 w-48" />
        )}
        {footnote && <p className="mt-3 text-[11px] text-content-tertiary">{footnote}</p>}
      </Card>
    );
  }

  const noneCarried = done && traffic.withTraffic === 0;
  const nameOf = (hotspot) => hotspot.name || hotspot.entityKey;

  return (
    <Card title={TITLE} subtitle={subtitle}>
      {progressBar}

      {noneCarried ? (
        <p className="text-sm text-content-secondary">
          {noneCarriedText(traffic.known, iotStatus.iotTotal, trafficDay)}
        </p>
      ) : (
        <>
          <div className="font-display text-3xl font-semibold proportional-nums text-content">
            {fmtCount(traffic.withTraffic)}
            <span className="mx-1.5 text-xl font-medium text-content-tertiary">of</span>
            {fmtCount(traffic.known)}
          </div>
          <div className="mt-1 text-sm text-content-secondary">IoT Hotspots carried traffic</div>
          <div className="text-xs text-content-tertiary">in the 30 days through {trafficDay}</div>

          {traffic.messages30d > 0 && (
            <p className="mt-3 text-sm text-content-secondary">
              <span className="font-medium text-content" title={`${fmtCount(traffic.messages30d)} messages`}>
                {fmtCompact(traffic.messages30d)}
              </span>{" "}
              messages delivered, summed across your Hotspots <InfoTip
                text={`${IOT_MESSAGES_NOTE} Summed over the 30 days across your Hotspots.`}
                label="About this total"
              />
            </p>
          )}
        </>
      )}

      {/* Health = connectivity × 30-day traffic. Invariant:
          health.activeTraffic + health.activeQuiet + active rows without
          traffic data = iotStatus.active (statusNoData counts those for both
          active and inactive rows, and is surfaced in the footnote). */}
      <div className="mt-4 border-t border-border pt-2">
        <div className="-mx-2">
          {IOT_HEALTH_ORDER.filter((key) => traffic.health[key] > 0).map((key) => (
            <CountRow
              key={key}
              color={IOT_HEALTH[key].color}
              label={IOT_HEALTH[key].label}
              count={traffic.health[key]}
              valueClass={IOT_HEALTH[key].textClass}
              hint={IOT_HEALTH[key].hint}
              onClick={onShowHealth ? () => onShowHealth(key) : undefined}
            />
          ))}
        </div>
      </div>

      {traffic.health.inactiveTraffic > 0 && (
        <NameCallout
          tone="warn"
          title={`${IOT_HEALTH.inactiveTraffic.label} (30-day messages)`}
          names={names.inactiveTraffic.map(({ hotspot, row }) => `${nameOf(hotspot)} (${fmtCompact(row.messages)})`)}
          total={traffic.health.inactiveTraffic}
        />
      )}
      {traffic.health.activeQuiet > 0 && (
        <NameCallout
          tone="caution"
          title={IOT_HEALTH.activeQuiet.label}
          names={names.activeQuiet.map(({ hotspot }) => nameOf(hotspot))}
          total={traffic.health.activeQuiet}
        />
      )}

      {(lowerBound || footnote) && (
        <div className="mt-3 space-y-1 text-[11px] text-content-tertiary">
          {lowerBound && <p>{fmtLowerBound(build.daysComplete, build.days)}</p>}
          {footnote && <p>{footnote}</p>}
        </div>
      )}
    </Card>
  );
});
