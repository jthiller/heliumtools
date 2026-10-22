import { memo } from "react";
import { Btn2, Disclosure, Skeleton, StatusMark } from "../ui/index.js";
import { fmtCount, plural } from "../format.js";
import { DATA_ONLY_NOTE, couldntCheck, needsLine } from "../copy.js";
import { checkingText, summaryLine, verdictsPartial } from "../hotspotList.js";
import { STATES, TIERS, needsALook, stateRank } from "../statusRegistry.js";
import { prefersReducedMotion } from "../../lib/useReducedMotion.js";

// Quiet states named after the reasons ("Also: Never rewarded 20, ...").
const QUIET_KEYS = ["neverRewarded", "noLocation"];

/** The Serious and Check states behind "need a look", most first (Serious before Check). */
function reasonsOf(list) {
  return Object.entries(list.counts.byState)
    .filter(([key, n]) => n > 0 && STATES[key] && needsALook(STATES[key].tier))
    .sort(([a, na], [b, nb]) => {
      const ta = STATES[a].tier === "serious" ? 0 : 1;
      const tb = STATES[b].tier === "serious" ? 0 : 1;
      return ta - tb || nb - na || stateRank(a) - stateRank(b);
    })
    .map(([key, n]) => ({ key, n, tier: STATES[key].tier, label: STATES[key].chip(list.ctx) }));
}

// One no-traffic IoT reason shared by every Hotspot reads as a sentence:
// the Hotspot list's summary line, word for word.
function sharedReasonNote(key, list) {
  if (key !== "inactiveQuiet" && key !== "activeQuiet") return null;
  return summaryLine(list);
}

const HEAD = "font-display text-wd-title font-semibold text-wd-ink";

/** A link into the Hotspot list that applies its filter in place (same tab). */
function ShowLink({ statusKey, onShowStatus, className, children }) {
  return (
    <a
      href={`?status=${statusKey}&sort=status#hotspots`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onShowStatus(statusKey);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

/**
 * The fleet status line under the money band (WdSummary `su-fleet`): how
 * many Hotspots need a look (Serious + Check, across IoT and Mobile, once
 * every verdict source has settled) with the reasons as links that filter
 * the Hotspot list, or the one Hotspot's status, "No Hotspots in this
 * wallet.", a checking line while the scans run, and the shared fleet error
 * with Retry when the Hotspot list failed.
 */
export default memo(function FleetStatusLine({ list, money, freshness, fleetState, iotStatus, activity, onShowStatus, onOpenHotspot }) {
  const wrap =
    "flex min-h-[60px] flex-col items-stretch gap-2.5 rounded-b-2xl bg-wd-well px-4 py-3.5 md:flex-row md:flex-wrap md:items-center md:gap-x-3.5 md:px-6";

  if (fleetState.state === "loading") {
    return (
      <div className={wrap} aria-busy="true">
        <span className="sr-only">Loading fleet status</span>
        <Skeleton w={380} h={20} className="max-w-full" style={{ background: "rgb(var(--wd-line))" }} />
      </div>
    );
  }

  if (fleetState.state === "failed") {
    return (
      <div className={wrap}>
        <div role="alert" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <StatusMark tier="serious" sr={false} />
          <span className={`${HEAD} !text-wd-critical-text`}>Couldn&apos;t load Hotspots.</span>
          <span className="text-[13px] leading-[18px] text-wd-ink-2">
            Hotspot rewards, earnings and status are unavailable until they load.
          </span>
          <Btn2 onClick={fleetState.retry} aria-label="Retry loading Hotspots" className="md:ml-auto">
            Retry
          </Btn2>
          {fleetState.error && (
            <Disclosure summary="Details" className="basis-full text-wd-cap md:pl-[22px]">
              <span className="block pt-1">{String(fleetState.error)}</span>
            </Disclosure>
          )}
        </div>
      </div>
    );
  }

  const total = list.counts.total;
  if (total === 0) {
    return (
      <div className={wrap}>
        <span className={HEAD}>No Hotspots in this wallet.</span>
        <span className="text-wd-cap text-wd-ink-2">Balances, veHNT and activity are below.</span>
      </div>
    );
  }

  if (!list.settled.verdicts) {
    return (
      <div className={wrap} aria-busy="true">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <StatusMark tier="checking" />
          <span className={HEAD}>{checkingText(list)}</span>
          <span className="text-[13px] leading-[18px] text-wd-ink-2">Hotspots that need a look are counted once every check finishes.</span>
        </div>
      </div>
    );
  }

  // One Hotspot: its name (to the detail, the Hotspots section's body) and its status.
  if (total === 1) {
    const row = list.rows[0];
    const also = row.states.length > 1 ? `Also: ${row.states[1].label}, ${row.states[1].window ?? ""}`.replace(/, $/, "") : null;
    const where = row.asserted && row.place.label ? `${row.deviceLabel} in ${row.place.label}.` : `${row.deviceLabel}. ${row.placeText}.`;
    return (
      <div className={wrap}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <StatusMark tier={row.tier} sr={false} />
          <a
            href={`?hotspot=${encodeURIComponent(row.param)}#hotspots`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              // The one Hotspot's detail is the Hotspots section's body: go to
              // its heading; until it renders, open it the usual way.
              const section = document.getElementById("hotspots");
              const heading = section?.querySelector("[data-wd-detail-heading]") ?? section?.querySelector("[data-wd-detail] h2");
              if (heading) {
                section.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
                if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
                heading.focus({ preventScroll: true });
              } else onOpenHotspot?.(row.param, e.currentTarget);
            }}
            className={`${HEAD} inline-flex min-h-11 items-center !text-accent-text md:min-h-6`}
          >
            {row.name || "Unnamed Hotspot"}
          </a>
          <span className="text-[13px] font-semibold leading-[18px] text-wd-ink">
            <span className="sr-only">{TIERS[row.tier]?.word ?? "Unknown"}: </span>
            {row.top.label}
          </span>
          {row.top.window && <span className="text-[13px] leading-[18px] text-wd-ink-2">{row.top.window}</span>}
        </div>
        <span className="text-wd-cap text-wd-ink-2">
          {where} {also ? `${also}.` : "No other issues."}
        </span>
      </div>
    );
  }

  const reasons = reasonsOf(list);
  const needs = list.counts.needs ?? 0;
  const iotFailed = list.counts.byState.iotFailed ?? 0;
  // Rows whose rewards batch failed can't be judged on rewarded data or never rewarded.
  const rewardsFailed = list.rows.reduce((n, r) => n + (r.unclaimed.state === "failed" ? 1 : 0), 0);
  const mobileFailed = list.counts.byState.mobileFailed ?? 0;
  const quiet = QUIET_KEYS.filter((k) => list.counts.byState[k] > 0).map(
    (k) => `${STATES[k].chip(list.ctx)} ${fmtCount(list.counts.byState[k])}`,
  );
  const dataOnlyFleet = list.counts.mobileTables > 0 && list.counts.wifi === 0;
  const partial = verdictsPartial(list, freshness);

  // Every IoT Hotspot unchecked and nothing else to say: no false "No issues".
  if (needs === 0 && iotFailed > 0 && iotFailed === list.counts.iot) {
    return (
      <div className={wrap}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <StatusMark tier="unknown" />
          <span className={HEAD}>{couldntCheck("IoT status", iotFailed)}</span>
          <span className="text-[13px] leading-[18px] text-wd-ink-2">Inactive and no-traffic counts return once it loads.</span>
        </div>
      </div>
    );
  }

  const notes = [];
  const reasonTotal = reasons.reduce((s, r) => s + r.n, 0);
  const shared = reasons.length === 1 && reasons[0].n === total ? sharedReasonNote(reasons[0].key, list) : null;
  if (shared) notes.push(shared);
  else if (reasonTotal > needs) notes.push("A Hotspot can have more than one reason.");
  if (dataOnlyFleet && activity?.bans && !(list.counts.byState.banned > 0)) notes.push("No bans on record.");
  if (quiet.length) notes.push(notes.length && !dataOnlyFleet ? `Also: ${quiet.join(", ")}.` : `${quiet.join(", ")}.`);
  if (rewardsFailed > 0) notes.push(couldntCheck("rewards", rewardsFailed));
  if (iotFailed > 0) notes.push(couldntCheck("IoT status", iotFailed));
  if (mobileFailed > 0) notes.push(couldntCheck("Mobile activity", mobileFailed));
  else if (freshness?.note && partial) notes.push(freshness.note);
  if (dataOnlyFleet) notes.push(DATA_ONLY_NOTE);

  if (needs === 0) {
    // "No issues" only when every source answered; a failed or frozen one
    // keeps the count, as the Hotspot list does ("0 of 10 need a look").
    return (
      <div className={wrap}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <StatusMark tier={partial ? "unknown" : "ok"} />
          <span className={HEAD}>{needsLine(0, total, { partial, noun: partial })}</span>
          {!partial && <span className="text-[13px] leading-[18px] text-wd-ink-2">Across all {plural(total, "Hotspot")}.</span>}
        </div>
        {notes.length > 0 && <span className="text-wd-cap text-wd-ink-2">{notes.join(" ")}</span>}
      </div>
    );
  }

  const serious = reasons.some((r) => r.tier === "serious");
  return (
    <div className={wrap}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <StatusMark tier={serious ? "serious" : "check"} />
        <span className={HEAD}>{needsLine(needs, total, { noun: true })}</span>
      </div>
      <ul
        aria-label="Top reasons. Each opens the Hotspot list filtered to it."
        className="m-0 flex list-none flex-col gap-1.5 p-0 md:flex-row md:flex-wrap md:gap-2"
      >
        {reasons.map((r) => (
          <li key={r.key}>
            <ShowLink
              statusKey={r.key}
              onShowStatus={onShowStatus}
              className={`inline-flex min-h-11 w-full items-center gap-2 rounded-[10px] border border-wd-control bg-surface-raised px-3 text-[13px] font-medium leading-[18px] hover:border-wd-ink-2 hover:no-underline md:min-h-8 md:w-auto md:rounded-full ${
                r.tier === "serious" ? "text-wd-critical-text" : "text-wd-caution-text"
              }`}
            >
              <StatusMark tier={r.tier} />
              <span>{r.label}</span>
              <span className="ml-auto font-display text-sm font-semibold leading-[18px] tabular-nums text-wd-ink md:ml-0">
                {fmtCount(r.n)}
              </span>
              <span className="sr-only"> Hotspots</span>
            </ShowLink>
          </li>
        ))}
      </ul>
      {notes.length > 0 && <span className="text-wd-cap text-wd-ink-2">{notes.join(" ")}</span>}
      <ShowLink
        statusKey="needs"
        onShowStatus={onShowStatus}
        className="inline-flex min-h-11 items-center text-[13px] font-medium text-accent-text hover:underline md:ml-auto md:min-h-6"
      >
        View in list
      </ShowLink>
    </div>
  );
});
