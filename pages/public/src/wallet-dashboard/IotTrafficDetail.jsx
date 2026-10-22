import { memo, useMemo } from "react";
import { labelOuis, WELL_KNOWN_REPO_URL } from "../lib/wellKnownOuis.js";
import { useHotspotTrafficDetail, useWellKnownOuiNames, useUtilizationIndex } from "./useIotLookups.js";
import IotTrafficChart, { MissingDayKey, seriesColor } from "./IotTrafficChart.jsx";
import { DSub, FailNote, Foot, Line, RetryBtn, TIP } from "./detail/parts.jsx";
import { ExtLink } from "./ui/ExtLink.jsx";
import { InfoTip } from "./ui/InfoTip.jsx";
import { Pending } from "./ui/Pending.jsx";
import { Skeleton } from "./ui/Skeleton.jsx";
import { Tag } from "./ui/Chip.jsx";
import {
  deriveTrafficDetail,
  isTrafficKnown,
  fmtCount,
  fmtDataDay,
  fmtLowerBound,
  plural,
  IOT_MESSAGES_NOTE,
  IOT_TRAFFIC_STATE_NOTE,
} from "./format.js";

const OUI_HINT =
  "OUI: the routing ID of the LoRaWAN Network Server (LNS) operator your Hotspot delivered messages for.";
const NOT_LISTED_HINT = "An operator whose OUI isn't listed there can add it.";
const QUIET_NETWORK_HINT =
  "No Hotspot on the network delivered messages for this OUI in these 7 days. A drop here is the operator's, not your Hotspot's.";
const UNKNOWN_DAYS = "Which days went unreported isn't known right now, so an empty day may be unreported.";
// The chart's footprint while the daily detail loads: readout, plot, x labels.
const CHART_SKELETON_H = 168;

/** Share of the Hotspot's messages: whole percent, "<1%" for a non-zero
 * share that rounds to 0, ">99%" when rounding would claim 100% for one OUI
 * among several. */
function fmtShare(share, count) {
  const pct = Math.round(share * 100);
  if (share > 0 && pct < 1) return "<1%";
  if (count >= 2 && pct > 99 && share < 1) return ">99%";
  return `${pct}%`;
}

/** "22 of 30": days with messages out of the window's complete days. */
function activeDays(o, view) {
  return o.daysActive30d == null ? "Not reported" : `${o.daysActive30d} of ${view.window.daysComplete}`;
}

// The window's last 7 data days, named by their end (a data-day window, never "last N").
const sevenDays = (view) => (view?.dataThrough ? `7 days to ${fmtDataDay(view.dataThrough)} (UTC)` : "7 days");

function recentShareText(share, view) {
  const pct = Math.round(share * 100);
  if (pct >= 90 && pct <= 110) return `${sevenDays(view)}: about the same as its 30-day daily average.`;
  return `${sevenDays(view)}: ${pct}% of its 30-day daily average.`;
}

/** The four figures ("Messages, 30 days" carries the messages InfoTip).
 * `figs` items: { label, value, sub, pending }. */
function Figures({ figs }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">
      {figs.map((f, i) => (
        <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="flex items-center gap-1.5 text-wd-cap text-wd-ink-2">
            {f.label}
            {i === 0 && (
              <InfoTip label="Messages, 30 days" className={TIP}>
                {IOT_MESSAGES_NOTE}
              </InfoTip>
            )}
          </dt>
          <dd className="m-0">
            {f.pending ? (
              <span className="font-display text-wd-s font-semibold text-wd-ink-3">
                <Pending />
              </span>
            ) : f.word ? (
              <span className="text-wd-sm text-wd-ink-2">{f.value}</span>
            ) : (
              <span className="font-display text-wd-s font-semibold text-wd-ink">{f.value}</span>
            )}
            {f.sub && <span className="text-wd-cap text-wd-ink-2"> {f.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const pendingFigs = (total) => [
  total != null ? { label: "Messages, 30 days", value: fmtCount(total) } : { label: "Messages, 30 days", pending: true },
  { label: "7 days", pending: true },
  { label: "Latest day", pending: true },
  { label: "Last message", pending: true },
];

/** Placeholder in the final layout's footprint: chart and one row per OUI. */
function DetailSkeleton({ total, ouiCount }) {
  return (
    <>
      <Figures figs={pendingFigs(total)} />
      <Skeleton h={CHART_SKELETON_H} className="w-full rounded-lg" />
      {Array.from({ length: Math.max(ouiCount, 1) }, (_, i) => (
        <Skeleton key={i} h={30} className="w-full" />
      ))}
    </>
  );
}

/** Caution well: nothing delivered in the last 7 days of the window. */
function QuietCallout({ view }) {
  return (
    <div className="grid grid-cols-[12px_minmax(0,1fr)] gap-x-2.5 rounded-lg bg-wd-caution-surface px-3 py-2.5 text-wd-sm text-wd-caution-text">
      <span className="mt-[3px] flex">
        <span aria-hidden="true" className="wd-st wd-st-caution" />
      </span>
      <p className="m-0">
        <span className="sr-only">Check: </span>
        No messages in the {sevenDays(view)}
        {view.missing7 > 0 && ` (${view.missing7} not reported)`}
        {!view.missingKnown && " (some days may be unreported)"}
        {view.lastDay ? `. Last delivered ${fmtDataDay(view.lastDay)}.` : "."}
      </p>
    </div>
  );
}

/** One swatch and name per series (the top five OUIs, then "Other"), plus
 * the unreported-day key. A single series is named in the window line
 * instead, so it gets no row here. */
function Legend({ view }) {
  const several = view.series.length >= 2;
  if (!several && !view.hasMissing) return null;
  return (
    <ul aria-hidden="true" className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1 p-0 text-wd-cap text-wd-ink-2">
      {several && view.series.map((s) => (
        <li key={s.key} className="inline-flex min-w-0 items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: seriesColor(s.slot) }} />
          <span className="truncate">{s.name}</span>
        </li>
      ))}
      {view.hasMissing && (
        <li className="inline-flex items-center gap-1.5">
          <MissingDayKey />
          No data reported
        </li>
      )}
    </ul>
  );
}

/** The chart's table view: every OUI, folded ones included. Its last three
 * columns fold into a line under the name when the detail is 520 px or
 * narrower (`.wd-fold-520` / `.wd-unfold-520`). */
function OuiTable({ view, namesFailed, windowText }) {
  const count = view.ouis.length;
  const num = "py-[9px] pl-3 text-right align-top tabular-nums whitespace-nowrap";
  return (
    <table className="w-full border-collapse text-wd-sm">
      <caption className="sr-only">Messages by OUI, {windowText}</caption>
      <thead>
        <tr className="text-[11px] font-medium leading-4 text-wd-ink-2">
          <th scope="col" className="whitespace-nowrap pb-1.5 text-left font-medium">
            <span className="inline-flex items-center gap-1.5">
              OUI
              <InfoTip label="OUIs" className={TIP}>
                {OUI_HINT}
              </InfoTip>
            </span>
          </th>
          <th scope="col" className="whitespace-nowrap pb-1.5 pl-3 text-right font-medium">
            Messages, 30 days
          </th>
          <th scope="col" className="whitespace-nowrap pb-1.5 pl-3 text-right font-medium">
            Share
          </th>
          <th scope="col" className="wd-fold-520 whitespace-nowrap pb-1.5 pl-3 text-right font-medium">
            7 days
          </th>
          <th scope="col" className="wd-fold-520 whitespace-nowrap pb-1.5 pl-3 text-right font-medium">
            Active days
          </th>
          <th scope="col" className="wd-fold-520 whitespace-nowrap pb-1.5 pl-3 text-right font-medium">
            Last message
          </th>
        </tr>
      </thead>
      <tbody>
        {view.ouis.map((o) => {
          const sub = o.fullName
            ? o.fullName !== o.name
              ? `${o.fullName}, OUI ${o.oui}`
              : `OUI ${o.oui}`
            : // Only when the list loaded: a failed load proves nothing.
              namesFailed
              ? null
              : "Not in well-known list";
          const fold = [
            `7 days ${fmtCount(o.packets7d)}`,
            o.daysActive30d != null ? `active ${activeDays(o, view)} days` : null,
            o.lastDay ? `last message ${fmtDataDay(o.lastDay)}` : null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <tr key={o.oui} className="border-t border-wd-line-2">
              <th scope="row" className="py-[9px] text-left align-top font-normal">
                <div className="grid grid-cols-[10px_minmax(0,1fr)] gap-x-2">
                  <span
                    aria-hidden="true"
                    className="mt-1 inline-block h-2.5 w-2.5 rounded-[3px]"
                    style={{ background: seriesColor(o.slot) }}
                  />
                  <div className="min-w-0">
                    <b className="break-words font-semibold text-wd-ink">{o.name}</b>
                    {o.slot == null && <span className="sr-only"> (shown as Other in the chart)</span>}
                    {sub && <span className="block text-wd-cap text-wd-ink-2">{sub}</span>}
                    <div className="wd-unfold-520 mt-0.5 text-wd-cap text-wd-ink-2">{fold}</div>
                    {o.quietNetworkWide === true && (
                      <span className="mt-1 inline-flex">
                        <Tag>Quiet network-wide</Tag>
                      </span>
                    )}
                  </div>
                </div>
              </th>
              <td className={`${num} text-wd-ink`}>{fmtCount(o.packets30d)}</td>
              <td className={`${num} text-wd-ink`}>{fmtShare(o.share, count)}</td>
              <td className={`wd-fold-520 ${num} text-wd-ink`}>{fmtCount(o.packets7d)}</td>
              <td className={`wd-fold-520 ${num} text-wd-ink`}>{activeDays(o, view)}</td>
              <td className={`wd-fold-520 ${num} text-wd-ink`}>{fmtDataDay(o.lastDay, { empty: "Unknown" })}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Partial-window note; adds that the unreported days can't be pinpointed
 * when the index for this build isn't available. */
function partialText(view) {
  if (!view.isPartial) return null;
  return `${fmtLowerBound(view.window.daysComplete, view.window.days)}${view.missingKnown ? "" : ` ${UNKNOWN_DAYS}`}`;
}

function Ready({ view, namesFailed, chartKey, windowText }) {
  const anyQuietNetwork = view.ouis.some((o) => o.quietNetworkWide === true);
  const anyUnlisted = !namesFailed && view.ouis.some((o) => !o.fullName);
  const partial = partialText(view);
  const lastMissing = view.days.at(-1)?.missing;
  return (
    <>
      <Figures
        figs={[
          { label: "Messages, 30 days", value: fmtCount(view.total) },
          {
            label: "7 days",
            value: fmtCount(view.packets7d),
            sub: view.missing7 > 0 ? `${plural(view.missing7, "day")} not reported` : null,
          },
          {
            label: "Latest day",
            value: fmtCount(view.packets1d),
            sub: `${fmtDataDay(view.dataThrough)}${lastMissing ? " · not reported" : ""}`,
          },
          { label: "Last message", value: fmtDataDay(view.lastDay, { empty: "None" }) },
        ]}
      />
      {partial && <Line>{partial}</Line>}
      {view.quietLast7 ? (
        <QuietCallout view={view} />
      ) : (
        view.recentShare != null && <Line>{recentShareText(view.recentShare, view)}</Line>
      )}
      <Legend view={view} />
      <IotTrafficChart key={chartKey} view={view} />
      <OuiTable view={view} namesFailed={namesFailed} windowText={windowText} />
      {anyQuietNetwork && <Foot>Quiet network-wide: {QUIET_NETWORK_HINT}</Foot>}
      <Foot>
        {namesFailed ? (
          <>
            Operator names couldn&apos;t be loaded from Helium&apos;s <ExtLink href={WELL_KNOWN_REPO_URL}>well-known OUI list</ExtLink>.
          </>
        ) : (
          <>
            Names from Helium&apos;s <ExtLink href={WELL_KNOWN_REPO_URL}>well-known OUI list</ExtLink>.
            {anyUnlisted && ` ${NOT_LISTED_HINT}`}
          </>
        )}
      </Foot>
    </>
  );
}

/**
 * One Hotspot's "Messages delivered": delivered LoRaWAN messages over the
 * 30-day window, per UTC day stacked by operator (OUI), with its figures,
 * the honesty notes (lower bound, recent share or the quiet callout), a
 * fixed readout over the chart, and the per-OUI table. The IoT section of the
 * Hotspot detail; the map no longer hosts it.
 *
 * Requests nothing when the gateway record already settles it (`traffic`
 * isn't a known block, or it delivered 0 messages); otherwise one daily-detail
 * request for this Hotspot plus the page-wide OUI names and utilization index
 * (both shared and memoized).
 *
 * @param entityKey     the Hotspot's entity key
 * @param traffic       its IoT row's `traffic` (iotTrafficOf result)
 * @param lookupFailed  the IoT lookup itself failed ("Couldn't check")
 * @param onRetry       retries the failed IoT lookups (the shell's failed-only retry)
 * @param through       the fleet's latest 30-day window end (YYYY-MM-DD), named
 *                      while this Hotspot's own isn't known
 */
export default memo(function IotTrafficDetail({
  entityKey,
  traffic,
  lookupFailed = false,
  onRetry,
  through: fallbackThrough = null,
}) {
  const wantsDetail = !lookupFailed && isTrafficKnown(traffic) && traffic.packets30d > 0;
  const { state, detail, retry } = useHotspotTrafficDetail(wantsDetail ? entityKey : null);
  const { names, failed: namesFailed } = useWellKnownOuiNames(wantsDetail);
  const { index } = useUtilizationIndex(wantsDetail, detail?.dataThrough);

  // Waits for the names (usually cached by now) so labels don't repaint. The
  // index only refines it (unreported-day marks, quiet-network badges), so
  // the chart doesn't wait on it.
  const view = useMemo(() => {
    if (!detail || names === null) return null;
    const labels = labelOuis(
      detail.ouis.map((o) => o.oui),
      names,
    );
    return deriveTrafficDetail(detail, labels, index);
  }, [detail, names, index]);

  const through = view?.dataThrough ?? (isTrafficKnown(traffic) ? traffic.dataThrough : fallbackThrough);
  const windowText = through ? `30 days to ${fmtDataDay(through)} (UTC)` : "30 days";
  const total = isTrafficKnown(traffic) ? traffic.packets30d : null;

  let body;
  let single = null;
  if (lookupFailed) {
    body = (
      <>
        <Figures figs={[{ label: "Messages, 30 days", value: "Unavailable", word: true }]} />
        {onRetry && (
          <div>
            <RetryBtn onClick={onRetry} label="Retry IoT status" />
          </div>
        )}
      </>
    );
  } else if (traffic === "pending") {
    body = <DetailSkeleton total={null} ouiCount={1} />;
  } else if (!isTrafficKnown(traffic)) {
    body = <Line>{IOT_TRAFFIC_STATE_NOTE[traffic] ?? IOT_TRAFFIC_STATE_NOTE.unavailable}</Line>;
  } else if (traffic.packets30d === 0) {
    body = <Line>No messages in the {windowText}.</Line>;
  } else if (state === "notFound") {
    body = <Line>{IOT_TRAFFIC_STATE_NOTE.unavailable}</Line>;
  } else if (state === "unpublished") {
    body = (
      <>
        <Figures figs={[{ label: "Messages, 30 days", value: fmtCount(total) }]} />
        <Line>Daily detail isn&apos;t available right now.</Line>
      </>
    );
  } else if (state === "error") {
    body = (
      <>
        <Figures figs={[{ label: "Messages, 30 days", value: fmtCount(total) }]} />
        <FailNote onRetry={retry} retryLabel="Retry daily detail">
          Couldn&apos;t load daily detail.
        </FailNote>
      </>
    );
  } else if (!view) {
    body = <DetailSkeleton total={total} ouiCount={traffic.ouis?.length ?? 1} />;
  } else if (view.kind === "empty") {
    const partial = view.isPartial ? ` ${fmtLowerBound(view.window.daysComplete, view.window.days)}` : "";
    body = (
      <Line>
        No messages in the {windowText}.{partial}
      </Line>
    );
  } else {
    // A Hotspot that delivered for one OUI names it with the window (no legend).
    if (view.series.length === 1) single = view.series[0];
    body = <Ready view={view} namesFailed={namesFailed} chartKey={entityKey} windowText={windowText} />;
  }

  return (
    <DSub title="Messages delivered" right={single ? `${windowText} · delivered for ${single.name}` : windowText}>
      {body}
    </DSub>
  );
});
