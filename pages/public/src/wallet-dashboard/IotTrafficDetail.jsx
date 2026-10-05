import { memo, useMemo } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import useDarkMode from "../lib/useDarkMode.js";
import { labelOuis, WELL_KNOWN_REPO_URL } from "../lib/wellKnownOuis.js";
import { ACTION_BTN, Badge, InfoTip, Skeleton } from "./cards/primitives.jsx";
import { useHotspotTrafficDetail, useWellKnownOuiNames, useUtilizationIndex } from "./useIotLookups.js";
import IotTrafficChart, { MissingDayKey, seriesColor, trafficChartHeight } from "./IotTrafficChart.jsx";
import {
  deriveTrafficDetail,
  isTrafficKnown,
  fmtCount,
  fmtCompact,
  fmtDataDay,
  fmtLowerBound,
  plural,
  IOT_MESSAGES_NOTE,
  IOT_TRAFFIC_STATE_NOTE,
  OUI_SERIES_MAX,
} from "./format.js";

const CHART_HEIGHT = { full: 160, compact: 72 };

const OUI_HINT =
  "OUI: the routing ID of the LoRaWAN Network Server (LNS) operator your Hotspot delivered messages for.";
const NOT_LISTED_HINT = "An operator whose OUI isn't listed there can add it.";
const QUIET_NETWORK_HINT =
  "No Hotspot on the network delivered messages for this OUI in the last 7 days — a drop here is the operator's, not your Hotspot's.";

/** Share of the Hotspot's messages, World Explorer's rules: whole percent,
 * "<1%" for a non-zero share that rounds to 0, ">99%" when rounding would
 * claim 100% for one OUI among several. */
function fmtShare(share, count) {
  const pct = Math.round(share * 100);
  if (share > 0 && pct < 1) return "<1%";
  if (count >= 2 && pct > 99 && share < 1) return ">99%";
  return `${pct}%`;
}

/** "22 of 30": days with messages out of the window's complete days. */
function activeDays(o, view) {
  return o.daysActive30d == null ? "—" : `${o.daysActive30d} of ${view.window.daysComplete}`;
}

/** The window line under the heading, naming the single OUI when there's no legend. */
function windowSubtitle(view) {
  const single = view.series.length === 1 ? view.series[0] : null;
  return `30 days through ${fmtDataDay(view.dataThrough)} (UTC)${single ? ` · delivered for ${single.name}` : ""}`;
}

function recentShareText(share) {
  const pct = Math.round(share * 100);
  if (pct >= 90 && pct <= 110) return "Last 7 days: about the same as its 30-day daily average.";
  return `Last 7 days: ${pct}% of its 30-day daily average.`;
}

/** Section heading + window line; `compact` is the map panel's small caps. */
function Frame({ compact, subtitle, children }) {
  return (
    <section className={compact ? "space-y-2" : "space-y-3"}>
      <div>
        <h3
          className={
            compact
              ? "text-[11px] font-medium uppercase tracking-wide text-content-tertiary"
              : "font-display text-sm font-semibold tracking-[-0.01em] text-content"
          }
        >
          Data transfer
        </h3>
        {subtitle && (
          <div className={compact ? "text-[11px] text-content-tertiary" : "mt-0.5 text-xs text-content-tertiary"}>
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function Note({ children }) {
  return <p className="text-xs text-content-tertiary">{children}</p>;
}

/** Small stat: caption + value (proportional figures — a standalone number). */
function Figure({ label, value, sub, hint }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
        {label}
        {hint && <InfoTip text={hint} label={`About ${label}`} />}
      </dt>
      <dd className="mt-0.5 font-display text-lg font-semibold text-content">{value}</dd>
      {sub && <dd className="text-[11px] text-content-tertiary">{sub}</dd>}
    </div>
  );
}

function Swatch({ slot, dark, title }) {
  return (
    <span
      aria-hidden={title ? undefined : "true"}
      title={title}
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
      style={{ background: seriesColor(slot, dark) }}
    />
  );
}

function WellKnownLink() {
  return (
    <a
      href={WELL_KNOWN_REPO_URL}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:text-content-secondary"
    >
      well-known OUI list
    </a>
  );
}

/** Amber callout: nothing delivered in the last 7 days of the window. */
function QuietCallout({ view, compact }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 ${
        compact ? "p-2 text-[11px]" : "p-2.5 text-xs"
      }`}
    >
      <ExclamationTriangleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        No messages in the last 7 days
        {view.missing7 > 0 && ` (${view.missing7} not reported)`}
        {!view.missingKnown && " (some days may be unreported)"}
        {view.lastDay ? ` — last delivered ${fmtDataDay(view.lastDay)}.` : "."}
      </p>
    </div>
  );
}

/**
 * The chart's legend: one row per series when there are ≥ 2 (a single series
 * is named in the subtitle), plus the key for unreported days. `withTotals`
 * adds each series' 30-day count — the compact panel's stand-in for the table.
 */
function Legend({ view, dark, withTotals = false }) {
  if (view.series.length < 2 && !view.hasMissing) return null;
  return (
    <ul className={withTotals ? "space-y-1 text-xs" : "flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary"}>
      {view.series.length >= 2 &&
        view.series.map((s) => (
          <li key={s.key} className={withTotals ? "flex items-center gap-2" : "flex min-w-0 items-center gap-1.5"}>
            <Swatch slot={s.slot} dark={dark} />
            <span className={withTotals ? "min-w-0 flex-1 truncate text-content-secondary" : "truncate"}>{s.name}</span>
            {withTotals && <span className="shrink-0 tabular-nums text-content">{fmtCompact(s.packets30d)}</span>}
          </li>
        ))}
      {view.hasMissing && (
        <li className={withTotals ? "flex items-center gap-2 text-content-tertiary" : "flex items-center gap-1.5"}>
          <MissingDayKey />
          No data reported
        </li>
      )}
    </ul>
  );
}

/** The chart's table view: every OUI, folded ones included. */
function OuiTable({ view, dark, namesFailed }) {
  const count = view.ouis.length;
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Messages by OUI, 30 days through {fmtDataDay(view.dataThrough, { year: true })}
        </caption>
        <thead className="border-b border-border text-left text-xs text-content-tertiary">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              <span className="inline-flex items-center gap-1">
                OUI
                <InfoTip text={OUI_HINT} label="About OUIs" />
              </span>
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium sm:whitespace-nowrap">
              Messages (30d)
            </th>
            <th scope="col" className="py-1.5 pl-3 text-right font-medium sm:px-3">
              Share
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-3 py-1.5 text-right font-medium sm:table-cell">
              Last 7 days
            </th>
            <th scope="col" className="hidden whitespace-nowrap px-3 py-1.5 text-right font-medium sm:table-cell">
              Active days
            </th>
            <th scope="col" className="hidden whitespace-nowrap py-1.5 pl-3 text-right font-medium sm:table-cell">
              Last message
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {view.ouis.map((o) => (
            <tr key={o.oui}>
              <td className="py-2 pr-3 align-top">
                <div className="flex items-start gap-2">
                  <span className="mt-[5px]">
                    <Swatch slot={o.slot} dark={dark} title={o.slot == null ? "Shown as Other in the chart" : undefined} />
                  </span>
                  <div className="min-w-0">
                    <div
                      className="break-words font-medium text-content sm:max-w-[200px] sm:truncate"
                      title={o.fullName ?? undefined}
                    >
                      {o.name}
                    </div>
                    {o.fullName ? (
                      <div className="text-[11px] text-content-tertiary">OUI {o.oui}</div>
                    ) : (
                      // Only when the list loaded — a failed load proves nothing.
                      !namesFailed && (
                        <div className="whitespace-nowrap text-[11px] text-content-tertiary">
                          Not in well-known list
                        </div>
                      )
                    )}
                    {/* Phones: the last three columns fold into this line. */}
                    <div className="text-[11px] text-content-tertiary sm:hidden">
                      {[
                        `7d ${fmtCount(o.packets7d)}`,
                        o.daysActive30d != null && `active ${activeDays(o, view)} days`,
                        o.lastDay && `last ${fmtDataDay(o.lastDay)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {o.quietNetworkWide === true && (
                      <span className="mt-1 inline-flex whitespace-nowrap">
                        <Badge>Quiet network-wide</Badge>
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 text-right align-top tabular-nums text-content">{fmtCount(o.packets30d)}</td>
              <td className="py-2 pl-3 text-right align-top tabular-nums text-content-secondary sm:px-3">
                {fmtShare(o.share, count)}
              </td>
              <td className="hidden px-3 py-2 text-right align-top tabular-nums text-content-secondary sm:table-cell">
                {fmtCount(o.packets7d)}
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2 text-right align-top tabular-nums text-content-secondary sm:table-cell">
                {activeDays(o, view)}
              </td>
              <td className="hidden whitespace-nowrap py-2 pl-3 text-right align-top tabular-nums text-content-secondary sm:table-cell">
                {fmtDataDay(o.lastDay)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Placeholder with the final layout's footprint (no jump when data lands). */
function DetailSkeleton({ compact, ouiCount }) {
  const seriesCount = Math.min(ouiCount, OUI_SERIES_MAX) + (ouiCount > OUI_SERIES_MAX ? 1 : 0);
  const chart = (
    <div style={{ height: trafficChartHeight(compact ? CHART_HEIGHT.compact : CHART_HEIGHT.full) }}>
      <Skeleton className="h-full w-full" />
    </div>
  );
  if (compact) {
    return (
      <Frame compact subtitle={<Skeleton className="mt-0.5 h-3 w-32" />}>
        <Skeleton className="h-5 w-56 max-w-full" />
        {chart}
        {seriesCount >= 2 && (
          <div className="space-y-1.5">
            {Array.from({ length: seriesCount }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        )}
      </Frame>
    );
  }
  return (
    <Frame subtitle={<Skeleton className="mt-1 h-3 w-40" />}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i}>
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="mt-1.5 h-6 w-16" />
          </div>
        ))}
      </div>
      {seriesCount >= 2 && <Skeleton className="h-4 w-2/3" />}
      {chart}
      <div className="space-y-2 pt-1">
        <Skeleton className="h-4 w-full" />
        {Array.from({ length: Math.max(ouiCount, 1) }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </Frame>
  );
}

/** Partial-window note; adds that the unreported days can't be pinpointed
 * when the index for this build isn't available. */
function PartialNote({ view, compact }) {
  if (!view.isPartial) return null;
  const text = `${fmtLowerBound(view.window.daysComplete, view.window.days)}${
    view.missingKnown ? "" : " Which days went unreported isn't known right now, so an empty day may be unreported."
  }`;
  return compact ? <p className="text-[11px] text-content-tertiary">{text}</p> : <Note>{text}</Note>;
}

function ReadyFull({ view, dark, namesFailed }) {
  const anyQuietNetwork = view.ouis.some((o) => o.quietNetworkWide === true);
  const anyUnlisted = !namesFailed && view.ouis.some((o) => !o.fullName);
  return (
    <Frame subtitle={windowSubtitle(view)}>
      <PartialNote view={view} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Figure label="Messages (30d)" value={fmtCount(view.total)} hint={IOT_MESSAGES_NOTE} />
        <Figure
          label="Last 7 days"
          value={fmtCount(view.packets7d)}
          sub={view.missing7 > 0 ? `${plural(view.missing7, "day")} not reported` : null}
        />
        <Figure
          label="Latest day"
          value={fmtCount(view.packets1d)}
          sub={`${fmtDataDay(view.dataThrough)}${view.days.at(-1)?.missing ? " · not reported" : ""}`}
        />
        <Figure label="Last message" value={fmtDataDay(view.lastDay)} />
      </dl>
      {view.quietLast7 ? (
        <QuietCallout view={view} />
      ) : (
        view.recentShare != null && <Note>{recentShareText(view.recentShare)}</Note>
      )}
      <Legend view={view} dark={dark} />
      <IotTrafficChart view={view} height={CHART_HEIGHT.full} />
      <OuiTable view={view} dark={dark} namesFailed={namesFailed} />
      {anyQuietNetwork && <Note>Quiet network-wide: {QUIET_NETWORK_HINT}</Note>}
      <Note>
        {namesFailed ? (
          <>
            Operator names couldn&apos;t be loaded from Helium&apos;s{" "}
            <WellKnownLink />.
          </>
        ) : (
          <>
            Names from Helium&apos;s <WellKnownLink />.{anyUnlisted && ` ${NOT_LISTED_HINT}`}
          </>
        )}
      </Note>
    </Frame>
  );
}

function ReadyCompact({ view, dark }) {
  return (
    <Frame compact subtitle={windowSubtitle(view)}>
      <p className="text-sm text-content-secondary">
        <span className="font-semibold text-content">{fmtCount(view.total)}</span>{" "}
        {view.total === 1 ? "message" : "messages"} · 30d · last 7d {fmtCount(view.packets7d)}
      </p>
      <PartialNote view={view} compact />
      {view.quietLast7 && <QuietCallout view={view} compact />}
      <IotTrafficChart view={view} height={CHART_HEIGHT.compact} compact />
      <Legend view={view} dark={dark} withTotals />
    </Frame>
  );
}

/** Why there's no chart, when the gateway record or the detail settles it. */
function statusMessage(traffic, state) {
  if (!isTrafficKnown(traffic)) return IOT_TRAFFIC_STATE_NOTE[traffic] ?? IOT_TRAFFIC_STATE_NOTE.unavailable;
  if (traffic.packets30d === 0) return `No messages in the 30 days through ${fmtDataDay(traffic.dataThrough)}.`;
  if (state === "unpublished") return "Daily detail isn't available right now.";
  return null;
}

/**
 * One Hotspot's "Data transfer": delivered messages per day stacked by
 * operator (OUI), with stats and the per-OUI table. Rendered in the fleet
 * table's detail panel (full) and the map panel (`compact`).
 *
 * Requests nothing when the gateway record already settles it (`traffic`
 * isn't a known block, or it delivered 0 messages); otherwise one daily-detail
 * request for this Hotspot plus the page-wide OUI names and utilization index
 * (both shared and memoized). Memoized: its props are an entity key and the
 * frozen traffic block, so the map panel's pan/zoom re-renders skip it.
 *
 * @param entityKey  the Hotspot's entity key
 * @param traffic    its row's `traffic` (iotTrafficOf result)
 */
export default memo(function IotTrafficDetail({ entityKey, traffic, compact = false }) {
  const dark = useDarkMode();
  const wantsDetail = isTrafficKnown(traffic) && traffic.packets30d > 0;
  const { state, detail, retry } = useHotspotTrafficDetail(wantsDetail ? entityKey : null);
  const { names, failed: namesFailed } = useWellKnownOuiNames(wantsDetail);
  const { index } = useUtilizationIndex(wantsDetail, detail?.dataThrough);

  // Waits for the names (usually cached by now) so labels don't repaint. The
  // index only refines it (missing-day stubs, quiet-network badges), so the
  // chart doesn't wait on it.
  const view = useMemo(() => {
    if (!detail || names === null) return null;
    const labels = labelOuis(
      detail.ouis.map((o) => o.oui),
      names,
    );
    return deriveTrafficDetail(detail, labels, index);
  }, [detail, names, index]);

  if (traffic == null || state === "notFound") return null;
  const message = statusMessage(traffic, state);
  if (message) {
    return (
      <Frame compact={compact}>
        <Note>{message}</Note>
      </Frame>
    );
  }
  if (state === "error") {
    return (
      <Frame compact={compact}>
        <div className="flex flex-wrap items-center gap-2">
          <Note>Couldn&apos;t load daily detail.</Note>
          <button type="button" onClick={retry} className={ACTION_BTN}>
            Retry
          </button>
        </div>
      </Frame>
    );
  }
  if (!view) {
    return <DetailSkeleton compact={compact} ouiCount={traffic.ouis.length} />;
  }

  if (view.kind === "empty") {
    return (
      <Frame compact={compact}>
        <Note>
          No messages in the 30 days through {fmtDataDay(view.dataThrough)}.
          {view.isPartial && ` ${fmtLowerBound(view.window.daysComplete, view.window.days)}`}
        </Note>
      </Frame>
    );
  }

  return compact ? (
    <ReadyCompact view={view} dark={dark} />
  ) : (
    <ReadyFull view={view} dark={dark} namesFailed={namesFailed} />
  );
});
