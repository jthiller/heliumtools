// ── Health: the Mobile module's view model ──────────────────────────────────
// Pure: turns `aggregateMobile`, the activity's table states and the one
// freshness derivation (`mobileFreshness`) into what the Mobile module shows
// (WdHealth `buildMob`): "WiFi health" for a fleet with WiFi Hotspots (the
// heartbeat headline, issue rows, No issues), "Bans" for a data-only fleet.
// Windows are aggregateMobile's, so a frozen window is named by its end on
// every line. Counts come from the aggregate's counts and groups only.
import { fmtCount, fmtUtcDate } from "../format.js";
import { fmtClock, fmtMultiplier, fmtReason, MOBILE_ISSUES, MOBILE_ISSUE_ORDER } from "../mobileFormat.js";
import { FRESH_MS } from "../mobile/tableMeta.js";
import { HEALTH_KEY_TO_FILTER } from "../statusRegistry.js";
import { DATA_ONLY_NOTE, WIFI_SIGNALS_NOTE } from "../copy.js";
import { BIG_FLEET, healthRow, many, pctOf, tierBar } from "./iotModule.js";

const ROWS = ["banned", "noHeartbeat", "lowTrust", "lowSpeedtest", "rejectedHeartbeats", "noIssue"];
const CHECK_ISSUES = ["noHeartbeat", "lowTrust", "lowSpeedtest", "rejectedHeartbeats"];
const LABEL = {
  banned: "Banned",
  noHeartbeat: "No heartbeat",
  lowTrust: "Location trust below 1",
  lowSpeedtest: "Speedtest below ×1",
  rejectedHeartbeats: "Rejected heartbeat",
  noIssue: "No WiFi issues",
};
const NO_ISSUE_HINT = "Not banned, sent a heartbeat, no rejected heartbeats, and location trust and speedtest multipliers of 1.";
// The tables each fleet's health reads, and what a note calls them.
const WIFI_TABLES = ["bans", "heartbeats", "invalidHeartbeats", "speedtests"];
const DATA_ONLY_TABLES = ["bans"];
const TABLE_WORD = { bans: "bans", heartbeats: "heartbeats", invalidHeartbeats: "rejected heartbeats", speedtests: "speedtests" };
const WIFI_SIGNALS = WIFI_SIGNALS_NOTE;

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "heartbeats", "heartbeats and speedtests", "bans, heartbeats and speedtests". */
function joinWords(words) {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
function topReason(reasons) {
  let top = null;
  for (const [reason, n] of Object.entries(reasons || {})) if (!top || n > top[1]) top = [reason, n];
  return top ? fmtReason(top[0]) : null;
}
// The figure beside a name, per row.
const VALUE_OF = {
  banned: ({ row }) => [row.ban?.reason ? fmtReason(row.ban.reason) : null, row.ban?.at ? fmtUtcDate(row.ban.at) : null].filter(Boolean).join(" · "),
  lowTrust: ({ row }) => (row.trust != null ? fmtMultiplier(row.trust) : null),
  lowSpeedtest: ({ row }) => (row.speedtestMultiplier != null ? `×${fmtMultiplier(row.speedtestMultiplier)}` : null),
  rejectedHeartbeats: ({ row }) => topReason(row.rejectedReasons),
};

/** "No issues in the last 60 min or 24 h.", or the frozen windows by their end. */
function noIssuesText(hb, sp) {
  if (hb.current && sp.current) return `No issues in the ${hb.span} or ${sp.short}.`;
  const hbLen = hb.short.split(" to ")[0];
  if (!hb.current && !sp.current && hb.until === sp.until) return `No issues in the ${hbLen} or ${sp.short}.`;
  return `No issues in the ${hb.current ? hb.span : hb.short} or the ${sp.current ? sp.span : sp.short}.`;
}

/**
 * @param {object} p
 * @param {object} p.mobile        aggregateMobile result (mobileTotal > 0)
 * @param {object} p.activity      useMobileActivity's contract (table states, cached sections, clock)
 * @param {object} p.freshness     mobileFreshness(activity, mobile)
 * @param {number} p.walletTotal   the wallet's Hotspots (a No issues row covering all of them is left out)
 * @param {number} p.noRewarded    the list's Mobile Hotspots with no rewarded data (7 days), a Check verdict
 *                                 outside the WiFi signals
 * @param {string|null} p.rewardsWindow  its window ("7 days to Oct 14 (UTC)")
 * @returns the module's view model (see HealthModule.jsx)
 */
export function mobileModule({ mobile, activity, freshness, walletTotal, noRewarded, rewardsWindow }) {
  const total = mobile.mobileTotal;
  const wifi = mobile.wifiTotal;
  const dataOnly = wifi === 0;
  const dataOnlyN = total - wifi;
  const { counts, groups, loaded, failed, windows, issueText } = mobile;
  const now = activity.asOf || Date.now();
  const tables = activity.tables || {};
  const relevant = dataOnly ? DATA_ONLY_TABLES : WIFI_TABLES;
  const headTable = dataOnly ? "bans" : "heartbeats";
  const hb = windows.heartbeats;
  const sp = windows.speedtests;
  const inv = windows.invalidHeartbeats;

  // Waiting for the headline's table: the skeleton at its final shape. A
  // failed check settles it (a note, never a skeleton that pulses forever).
  const loading = !loaded[headTable] && !failed[headTable];
  const anyLoaded = relevant.some((t) => loaded[t]);
  const showData = !loading && anyLoaded;
  const stillLoading = relevant.some((t) => !loaded[t] && !failed[t]);
  const allKnown = MOBILE_ISSUE_ORDER.every((k) => mobile.known[k] || (MOBILE_ISSUES[k].wifi && dataOnly));

  // Bans aren't a sliding window: a ban record shown from an older check
  // says when it was read.
  const bansAt = tables.bans?.okAt ?? null;
  const bansStale =
    loaded.bans && (tables.bans?.state === "error" || activity.phase === "error" || (bansAt != null && now - bansAt > FRESH_MS));
  const banAsOf = bansStale && (bansAt ?? freshness.dataAt) ? ` as of ${fmtClock(bansAt ?? freshness.dataAt, now)}` : "";

  const WIN = {
    banned: `Latest ban record${banAsOf}`,
    noHeartbeat: hb.span,
    lowTrust: `Latest heartbeat, ${hb.span}`,
    lowSpeedtest: sp.span,
    rejectedHeartbeats: inv.span,
    noIssue: `${hb.span} and ${sp.span}`,
  };
  const denom = dataOnly ? total : wifi;
  const big = denom >= BIG_FLEET;
  const countOf = (k) => (k === "noIssue" ? counts.noIssue : counts[k]);
  const rows = !showData
    ? []
    : ROWS.filter((k) => countOf(k) > 0)
        .filter((k) => !(k === "noIssue" && counts.noIssue === walletTotal))
        .map((k) =>
          healthRow({
            key: k,
            tier: k === "banned" ? "serious" : k === "noIssue" ? "ok" : "check",
            label: LABEL[k],
            hint: k === "noIssue" ? NO_ISSUE_HINT : issueText[k].hint,
            win: WIN[k],
            members: groups[k],
            valueOf: VALUE_OF[k],
            denom,
            big,
          }),
        );

  // Tiers: banned is Serious; a WiFi Hotspot whose first issue is a WiFi
  // signal is Check; No issues is OK; the rest hasn't answered yet
  // (Checking) or can't (Unknown, a table failed).
  const banned = counts.banned;
  const checkN = counts.withIssues - banned;
  let tiers;
  if (dataOnly) {
    tiers = [
      { tier: "serious", n: banned },
      { tier: "ok", n: loaded.bans ? total - banned : 0 },
    ];
  } else {
    const bannedWifi = groups.banned.filter((g) => g.row.wifi).length;
    const rest = Math.max(0, wifi - bannedWifi - checkN - counts.noIssue);
    tiers = [
      { tier: "serious", n: banned },
      { tier: "check", n: checkN },
      { tier: "ok", n: counts.noIssue },
      { tier: stillLoading ? "checking" : "unknown", n: rest },
    ];
  }

  let headline = null;
  if (loaded[headTable]) {
    headline = dataOnly
      ? {
          a: banned,
          b: total,
          rate: null,
          label: total === 1 ? "Mobile Hotspot banned" : "Mobile Hotspots banned",
          win: `Latest ban record per Hotspot${banAsOf}`,
          tip: null,
        }
      : {
          a: counts.heartbeating,
          b: wifi,
          rate: big ? `(${pctOf(counts.heartbeating, wifi)})` : null,
          label: wifi === 1 ? "WiFi Hotspot sent a heartbeat" : "WiFi Hotspots sent a heartbeat",
          win: hb.long,
          tip: null,
        };
    // Figures from the saved paint say when they're from.
    headline.asOf = activity.cachedSections?.includes(headTable) ? freshness.asOf : null;
    headline.flash = headTable;
  }

  // What couldn't be checked, with the last good data's time when it's
  // shown: the one sentence every surface shows (mobileFreshness `note`).
  const notes = [];
  const failing = relevant.filter((t) => tables[t]?.state === "error");
  const reasons = failing.filter((t) => tables[t].error).map((t) => `${capital(TABLE_WORD[t])}: ${tables[t].error}`);
  const details = reasons.length ? reasons.join(" ") : null;
  if (freshness.note) notes.push({ text: freshness.note, retry: true, details });

  const problems = tiers.some((t) => t.tier !== "ok" && t.n > 0);
  let positive = null;
  if (showData && !stillLoading && allKnown && !problems) {
    if (!dataOnly) positive = noIssuesText(hb, sp);
    else if (total === 1) positive = banAsOf ? `Your Mobile Hotspot wasn't banned${banAsOf}.` : "Your Mobile Hotspot isn't banned.";
    else positive = `None of your ${fmtCount(total)} Mobile Hotspots ${banAsOf ? `was banned${banAsOf}` : "is banned"}.`;
  }

  // "No rewarded data" is a Check verdict on data transfer, outside the WiFi
  // signals, so it sits under the rows rather than in the bar: it keeps this
  // module's count in line with the page's "need a look".
  const extra =
    noRewarded > 0 && rewardsWindow
      ? {
          key: "noRewardedData",
          filter: HEALTH_KEY_TO_FILTER.noRewardedData,
          text: `${many(noRewarded, "Mobile Hotspot", "Mobile Hotspots")} had no rewarded data in the ${rewardsWindow}.`,
          btnAria: `View in list: ${many(noRewarded, "Hotspot", "Hotspots")}, No rewarded data, ${rewardsWindow}`,
        }
      : null;

  const foot = [];
  const rowSum = CHECK_ISSUES.reduce((s, k) => s + counts[k], 0);
  if (!dataOnly && showData && rowSum > checkN) {
    foot.push(`A Hotspot can have more than one issue, so the Check rows add up to more than ${fmtCount(checkN)}.`);
  }
  foot.push(
    dataOnly
      ? DATA_ONLY_NOTE
      : dataOnlyN > 0
        ? `Heartbeats, location trust and speedtests are WiFi health signals. Your ${fmtCount(dataOnlyN)} data-only ${
            dataOnlyN === 1 ? "Hotspot doesn't" : "Hotspots don't"
          } send them. HNT from data transfer doesn't depend on them.`
        : WIFI_SIGNALS,
  );

  return {
    net: "mobile",
    title: dataOnly ? "Bans" : "WiFi health",
    window: dataOnly ? "Bans for data-only Hotspots" : `Heartbeats ${hb.span}, speedtests ${sp.span}`,
    chip: { kind: "live" },
    progress: null,
    loading,
    loadingSr: "Checking Mobile health",
    skel: { sub: false, rows: dataOnly ? 1 : 3 },
    headline,
    notes,
    subs: null,
    bar: showData ? tierBar(tiers, { denom, big, aria: `${dataOnly ? "Mobile Hotspots" : "WiFi Hotspots"} by status` }) : null,
    positive,
    rows,
    rowsAria: "Mobile status groups",
    extra,
    foot,
  };
}
