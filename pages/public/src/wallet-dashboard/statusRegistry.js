// ── Status registry ──────────────────────────────────────────────────────────
// The one cross-network vocabulary of Hotspot states (JUDGE section 5): every
// state's tier, its row label and window, its chip and filter label, its hint
// and its CSV key. The list, Summary, Health, the map, the detail and the
// agent tools all read it, so IoT and Mobile states rank on one scale and a
// state reads the same everywhere. "Needs a look" = Serious + Check.
//
// Windows come from the derivations (aggregateIotStatus's per-row anchors,
// aggregateMobile's `windows`), never from the clock, so a frozen Mobile
// window is named by its end ("60 min to 3:42 PM") on every surface.
//
// No top-level code here reads an import: format.js and mobileFormat.js
// import `stateRank` back (an import cycle that is safe only while every use
// is inside a function).
import { fmtCount, fmtDataDay, fmtUtcDate, livenessDay, plural } from "./format.js";
import { fmtMultiplier, fmtReason, isWifiNoIssue } from "./mobileFormat.js";
import { WIFI_SIGNALS_NOTE } from "./copy.js";

/** Tiers, most severe first. `mark` is the `.wd-st-*` shape (shape + color,
 * never color alone), `word` the sr-only tier word, `textClass` the label tone. */
export const TIER_ORDER = ["serious", "check", "quiet", "info", "unknown", "ok", "checking"];
export const TIERS = {
  serious: { rank: 0, word: "Serious", mark: "critical", textClass: "text-wd-critical-text" },
  check: { rank: 1, word: "Check", mark: "caution", textClass: "text-wd-caution-text" },
  quiet: { rank: 2, word: "Quiet", mark: "quiet", textClass: "text-wd-ink-2" },
  info: { rank: 3, word: "Info", mark: "info", textClass: "text-wd-ink" },
  unknown: { rank: 4, word: "Unknown", mark: "unknown", textClass: "text-wd-ink-2" },
  ok: { rank: 5, word: "OK", mark: "ok", textClass: "text-wd-ink" },
  checking: { rank: 6, word: "Checking", mark: "checking", textClass: "text-wd-ink-2" },
};

// State order within tiers (JUDGE 5). OK-tier states are deliberately NOT listed, so they tie
// and the list's Status sort falls through to Unclaimed (BMJi: High Daisy Shell, Soft Candy
// Porcupine, Best Mercurial Raven, Cheerful Carbon Armadillo, Swift Cotton Sawfish).
export const STATE_ORDER = [
  "banned",
  "inactiveTraffic",
  "noRewardedData",
  "activeQuiet",
  "inactiveQuiet",
  "inactive",
  "noHeartbeat",
  "lowTrust",
  "lowSpeedtest",
  "rejectedHeartbeats",
  "neverRewarded",
  "noLocation",
];

/** Whether a tier counts toward "need a look" (Serious + Check). */
export const needsALook = (tier) => tier === "serious" || tier === "check";

// copy.js's WIFI_SIGNALS_NOTE is read when a hint is asked for, never while
// this module evaluates (copy.js → format.js → this module is a cycle).

// What a Mobile table is called where a check of it failed ("Couldn't check:
// Heartbeats, last 60 min").
function tableWindowText(table, ctx) {
  const w = ctx.windows || {};
  switch (table) {
    case "heartbeats":
      return `Heartbeats, ${w.heartbeats?.span ?? "last 60 min"}`;
    case "invalidHeartbeats":
      return `Rejected heartbeats, ${w.invalidHeartbeats?.span ?? "last 60 min"}`;
    case "speedtests":
      return `Speedtests, ${w.speedtests?.span ?? "last 24 h"}`;
    case "bans":
      return "Bans";
    case "rewards":
      return ctx.rewardsWindow ? `Rewarded data, ${ctx.rewardsWindow}` : "Rewarded data";
    default:
      return table;
  }
}
const TABLE_CHIP = {
  heartbeats: "heartbeats",
  invalidHeartbeats: "rejected heartbeats",
  speedtests: "speedtests",
  bans: "bans",
  rewards: "rewarded data",
};

const issueChip = (key, fallback) => (ctx) => ctx.issueText?.[key]?.chip ?? fallback;
const issueHint = (key, fallback) => (ctx) => ctx.issueText?.[key]?.hint ?? fallback ?? WIFI_SIGNALS_NOTE;
const iotDay = (data, ctx) => data?.day ?? ctx.iotDay;
const iotDayText = (data, ctx) => `${fmtDataDay(iotDay(data, ctx))} (UTC)`;
const messagesText = (data, ctx) =>
  `${plural(data?.messages ?? 0, "message")}, 30 days to ${fmtDataDay(data?.through ?? ctx.trafficThrough)} (UTC)`;
const trafficUnknownText = (data) =>
  data?.traffic === "unpublished" ? "Traffic data isn't published" : "Traffic data unavailable";

/**
 * key → { tier, network: "iot"|"mobile"|"any", label(ctx, data), window(ctx, data),
 *         window2?(ctx, data), chip(ctx), filterLabel(ctx), hint(ctx), csv }
 * `label` / `window` / `window2` word one row's state (through `makeState`);
 * `chip` is the status chip and filter label (with the window when it's a
 * sliding one: "No heartbeat (60 min)"); `filterLabel` is what the result
 * line names ("Showing 3 of 10 Hotspots: No heartbeat (60 min)").
 */
export const STATES = {
  banned: {
    tier: "serious",
    network: "mobile",
    label: () => "Banned",
    window: (ctx, d) => [d?.reason ? fmtReason(d.reason) : null, d?.at ? fmtUtcDate(d.at) : null].filter(Boolean).join(" · ") || "Latest ban record",
    chip: () => "Banned",
    hint: issueHint("banned", "The Hotspot's latest ban record is a ban. Its message gives the reason."),
    csv: "banned",
  },
  inactiveTraffic: {
    tier: "serious",
    network: "iot",
    label: () => "Inactive, had traffic",
    window: (ctx, d) => iotDayText(d, ctx),
    window2: (ctx, d) => messagesText(d, ctx),
    chip: () => "Inactive, had traffic",
    hint: () =>
      "Not connected on the latest reported day, but delivered messages within the 30-day window. The Hotspots most worth checking first.",
    csv: "inactive_had_traffic",
  },
  noRewardedData: {
    tier: "check",
    network: "mobile",
    label: () => "No rewarded data",
    window: (ctx) => ctx.rewardsWindow ?? "7 days",
    chip: () => "No rewarded data (7 days)",
    hint: (ctx) =>
      `No rewarded data on any of the ${ctx.rewardsWindow ?? "7 days"}, though this Hotspot has earned before.`,
    csv: "no_rewarded_data",
  },
  activeQuiet: {
    tier: "check",
    network: "iot",
    label: () => "Active, no traffic",
    window: (ctx, d) => iotDayText(d, ctx),
    window2: (ctx, d) => messagesText(d, ctx),
    chip: () => "Active, no traffic",
    hint: () =>
      "Connected, but delivered no messages in 30 days. Check antenna and placement, or there may be no devices nearby.",
    csv: "active_no_traffic",
  },
  inactiveQuiet: {
    tier: "check",
    network: "iot",
    label: () => "Inactive, no traffic",
    window: (ctx, d) => iotDayText(d, ctx),
    window2: (ctx, d) => messagesText(d, ctx),
    chip: () => "Inactive, no traffic",
    hint: () => "Not connected on the latest reported day, and no messages in 30 days.",
    csv: "inactive_no_traffic",
  },
  inactive: {
    tier: "check",
    network: "iot",
    label: () => "Inactive",
    window: (ctx, d) => iotDayText(d, ctx),
    window2: (ctx, d) => trafficUnknownText(d),
    chip: () => "Inactive",
    hint: () => "Not connected on the latest reported day. Its traffic is not known right now.",
    csv: "inactive",
  },
  noHeartbeat: {
    tier: "check",
    network: "mobile",
    label: () => "No heartbeat",
    window: (ctx) => ctx.windows?.heartbeats?.span ?? "last 60 min",
    chip: issueChip("noHeartbeat", "No heartbeat (60 min)"),
    hint: issueHint("noHeartbeat"),
    csv: "no_heartbeat",
  },
  lowTrust: {
    tier: "check",
    network: "mobile",
    label: (ctx, d) => (d?.trust != null ? `Location trust ${fmtMultiplier(d.trust)}` : "Location trust below 1"),
    window: (ctx) => `latest heartbeat, ${ctx.windows?.heartbeats?.span ?? "last 60 min"}`,
    chip: issueChip("lowTrust", "Location trust below 1"),
    hint: issueHint("lowTrust"),
    csv: "low_location_trust",
  },
  lowSpeedtest: {
    tier: "check",
    network: "mobile",
    label: (ctx, d) => (d?.multiplier != null ? `Speedtest ×${fmtMultiplier(d.multiplier)}` : "Speedtest below ×1"),
    window: (ctx) => ctx.windows?.speedtests?.span ?? "last 24 h",
    chip: issueChip("lowSpeedtest", "Speedtest below ×1 (24 h)"),
    hint: issueHint("lowSpeedtest"),
    csv: "low_speedtest",
  },
  rejectedHeartbeats: {
    tier: "check",
    network: "mobile",
    label: () => "Rejected heartbeat",
    window: (ctx, d) =>
      [ctx.windows?.invalidHeartbeats?.span ?? "last 60 min", d?.topReason ? fmtReason(d.topReason) : null]
        .filter(Boolean)
        .join(" · "),
    chip: issueChip("rejectedHeartbeats", "Rejected heartbeat (60 min)"),
    hint: issueHint("rejectedHeartbeats"),
    csv: "rejected_heartbeats",
  },
  neverRewarded: {
    tier: "quiet",
    network: "any",
    label: () => "Never rewarded",
    window: (ctx, d) => (d?.onboardedDay ? `lifetime · onboarded ${fmtDataDay(d.onboardedDay)}` : "lifetime"),
    chip: () => "Never rewarded",
    hint: () => "No rewards on record for this Hotspot, on any network, over its lifetime.",
    csv: "never_rewarded",
  },
  noLocation: {
    tier: "quiet",
    network: "any",
    label: () => "No asserted location",
    window: () => "on-chain",
    chip: () => "No asserted location",
    hint: () => "No location is asserted on-chain for this Hotspot.",
    csv: "no_asserted_location",
  },
  settingUp: {
    tier: "info",
    network: "iot",
    label: () => "Setting up",
    window: (ctx, d) =>
      d?.onboardedAt
        ? `Onboarded ${fmtDataDay(d.onboardedAt.slice(0, 10))}, after the latest reported day`
        : "Onboarded after the latest reported day",
    chip: () => "Setting up",
    hint: () => "Onboarded to IoT after the latest reported day. Its status appears after its first reported day.",
    csv: "setting_up",
  },
  iotUnknown: {
    tier: "unknown",
    network: "iot",
    label: () => "Unknown",
    window: () => "No status for this Hotspot",
    chip: () => "Unknown",
    hint: () => "No IoT status was found for this Hotspot. It is not counted in the figures above.",
    csv: "unknown",
  },
  iotFailed: {
    tier: "unknown",
    network: "iot",
    label: () => "Couldn't check",
    window: () => "IoT status",
    chip: () => "Couldn't check IoT",
    hint: () => "IoT status couldn't be checked for this Hotspot right now. It is not counted as Inactive.",
    csv: "iot_check_failed",
  },
  noStatus: {
    tier: "unknown",
    network: "any",
    label: () => "No status reported",
    window: (ctx, d) =>
      d?.reason === "cbrs" ? "CBRS radio" : d?.reason === "none" ? "No status for this Hotspot" : "Not on IoT or Mobile",
    chip: () => "No status reported",
    hint: () => "This Hotspot reports no IoT or Mobile status that this page can read.",
    csv: "no_status_reported",
  },
  mobileFailed: {
    tier: "unknown",
    network: "mobile",
    label: () => "Couldn't check",
    window: (ctx, d) => (d?.tables?.length ? d.tables.map((t) => tableWindowText(t, ctx)).join("; ") : "Mobile activity"),
    chip: (ctx, d) => {
      const tables = d?.tables ?? ctx.failedTables ?? [];
      return tables.length === 1 ? `Couldn't check ${TABLE_CHIP[tables[0]] ?? tables[0]}` : "Couldn't check Mobile";
    },
    hint: () => "Mobile activity couldn't be checked right now. Nothing is counted as a problem until it loads.",
    csv: "mobile_check_failed",
  },
  heartbeatOk: {
    tier: "ok",
    network: "mobile",
    // The row view adds a TimeAgo from the state's `at` ("Heartbeat 15m ago");
    // a frozen window says only that one arrived.
    label: (ctx, d) => (d?.frozen ? "Heartbeat received" : "Heartbeat"),
    window: (ctx) => ctx.windows?.heartbeats?.span ?? "last 60 min",
    chip: (ctx) => `Heartbeat (${ctx.windows?.heartbeats?.short ?? "60 min"})`,
    hint: () => WIFI_SIGNALS_NOTE,
    csv: "heartbeat",
  },
  rewardedDays: {
    tier: "ok",
    network: "mobile",
    // Over the days that loaded: "Rewarded on 5 of 6 reported days" when one is missing.
    label: (ctx, d) =>
      d?.of != null && d.of < 7
        ? `Rewarded on ${fmtCount(d?.days ?? 0)} of ${fmtCount(d.of)} reported days`
        : `Rewarded on ${fmtCount(d?.days ?? 0)} of 7 days`,
    window: (ctx) => ctx.rewardsWindow ?? "7 days",
    chip: () => "Rewarded (7 days)",
    hint: () => "Earned HNT from data transfer on at least one of the last 7 UTC days.",
    csv: "rewarded",
  },
  activeTraffic: {
    tier: "ok",
    network: "iot",
    label: () => "Active, had traffic",
    window: (ctx, d) => iotDayText(d, ctx),
    window2: (ctx, d) => messagesText(d, ctx),
    chip: () => "Active, had traffic",
    hint: () =>
      "Connected, and delivered messages within the 30-day window. A 30-day total can't confirm traffic is still flowing; open the Hotspot for its daily chart.",
    csv: "active_with_traffic",
  },
  active: {
    tier: "ok",
    network: "iot",
    label: () => "Active",
    window: (ctx, d) => iotDayText(d, ctx),
    window2: (ctx, d) => trafficUnknownText(d),
    chip: () => "Active",
    hint: () => "Connected on the latest reported day. Its traffic is not known right now.",
    csv: "active",
  },
  checking: {
    tier: "checking",
    network: "any",
    label: () => "Checking…",
    window: () => null,
    chip: () => "Checking…",
    hint: () => "Still checking this Hotspot.",
    csv: "pending",
  },
};
for (const s of Object.values(STATES)) s.filterLabel ??= s.chip;

/**
 * The status filters beyond single states: `needs` (Serious + Check, distinct
 * Hotspots), `ok` (top state OK, nothing checking), `mobileOk` (WiFi rows with
 * every answer in and no issue: `isWifiNoIssue`).
 */
export const DERIVED_FILTERS = {
  needs: { tier: "check", chip: () => "Needs a look", filterLabel: () => "Needs a look" },
  ok: { tier: "ok", chip: () => "No issues", filterLabel: () => "No issues" },
  mobileOk: {
    tier: "ok",
    chip: (ctx) =>
      `No WiFi issues (${ctx.windows?.heartbeats?.short ?? "60 min"}, ${ctx.windows?.speedtests?.short ?? "24 h"})`,
    filterLabel: (ctx) =>
      `No WiFi issues (${ctx.windows?.heartbeats?.short ?? "60 min"}, ${ctx.windows?.speedtests?.short ?? "24 h"})`,
  },
};

/** Every value the `status` URL parameter accepts. */
export const STATUS_FILTERS = [...Object.keys(STATES), ...Object.keys(DERIVED_FILTERS)];
export const isStatusFilter = (v) => STATUS_FILTERS.includes(v);

/** A status filter's chip / filter label for the windows in `ctx` (null for an unknown key). */
export function statusFilterLabel(key, ctx = {}) {
  const def = STATES[key] ?? DERIVED_FILTERS[key];
  return def ? def.filterLabel(ctx) : null;
}

/** A status filter's tier (the derived ones: needs → check, ok/mobileOk → ok). */
export const tierOfFilter = (key) => (STATES[key] ?? DERIVED_FILTERS[key])?.tier ?? null;

/**
 * Health module rows → the list's status filter of the same predicate. IoT
 * rows read `aggregateIotStatus.groups[key]` (`unknown` = a 404, `failed` =
 * the lookup failed), Mobile rows `aggregateMobile.groups[key]` (`noIssue` =
 * `isWifiNoIssue`), and the "No rewarded data" note
 * `hotspotList.members.noRewardedData`. Summary's reason chips use the same
 * filter values.
 */
export const HEALTH_KEY_TO_FILTER = {
  inactiveTraffic: "inactiveTraffic",
  activeQuiet: "activeQuiet",
  inactiveQuiet: "inactiveQuiet",
  inactive: "inactive",
  settingUp: "settingUp",
  activeTraffic: "activeTraffic",
  active: "active",
  unknown: "iotUnknown",
  failed: "iotFailed",
  banned: "banned",
  noHeartbeat: "noHeartbeat",
  lowTrust: "lowTrust",
  lowSpeedtest: "lowSpeedtest",
  rejectedHeartbeats: "rejectedHeartbeats",
  noIssue: "mobileOk",
  noRewardedData: "noRewardedData",
};

const ORDER_INDEX = new Map(STATE_ORDER.map((k, i) => [k, i]));

/** A state's sort rank: its tier's rank × 100 plus its STATE_ORDER index (99
 * when unlisted, so OK-tier states tie). Unknown keys rank after everything. */
export function stateRank(key) {
  const def = STATES[key];
  if (!def) return 9_999;
  return TIERS[def.tier].rank * 100 + (ORDER_INDEX.get(key) ?? 99);
}

/** Comparator for State objects (or `{ key }`), most severe first. */
export function compareStates(a, b) {
  return stateRank(a.key) - stateRank(b.key);
}

/**
 * One state as a row shows it:
 * `{ key, tier, label, window, window2, network, at }`.
 *   label   — "No heartbeat", "Speedtest ×0.75", "Inactive, no traffic"
 *   window  — its honest window ("last 60 min", "Oct 14 (UTC)", "lifetime")
 *   window2 — a second window line for IoT states ("59,388 messages, 30 days
 *             to Oct 14 (UTC)" or "Traffic data unavailable"), else null
 *   at      — heartbeatOk only: the latest heartbeat (ms) for a TimeAgo after
 *             the label, null when the window is frozen
 * `data` carries the per-row facts: { reason, at } (banned), { day, through,
 * messages, traffic } (IoT), { trust } (lowTrust), { multiplier }
 * (lowSpeedtest), { topReason } (rejectedHeartbeats), { onboardedDay }
 * (neverRewarded), { onboardedAt } (settingUp), { reason: "cbrs"|"network"|
 * "none" } (noStatus), { tables } (mobileFailed), { at, frozen }
 * (heartbeatOk), { days, of } (rewardedDays: days with HNT of the days loaded).
 */
export function makeState(key, ctx = {}, data) {
  const def = STATES[key];
  return {
    key,
    tier: def.tier,
    label: def.label(ctx, data),
    window: def.window(ctx, data) ?? null,
    window2: def.window2 ? def.window2(ctx, data) : null,
    network: def.network,
    at: key === "heartbeatOk" && !data?.frozen ? (data?.at ?? null) : null,
  };
}

/**
 * The window labels every state is worded with, built once per derivation:
 *   iotDay           newest liveness data day ("YYYY-MM-DD"), the fallback
 *                    for a row without its own anchor
 *   trafficThrough   newest 30-day messages window end ("YYYY-MM-DD")
 *   iotDayLabel      "Oct 14 (UTC)"; trafficWindow "30 days to Oct 14 (UTC)"
 *   rewardsDay / rewardsFirstDay   newest / oldest of the 7 Mobile reward days
 *   rewardsDayLabel  "Oct 14 (UTC)"; rewardsWindow "7 days to Oct 14 (UTC)"
 *   windows, issueText             aggregateMobile's (sliding windows)
 *   frozen           { heartbeats, invalidHeartbeats, speedtests }: window
 *                    named by its end rather than now
 *   failedTables     Mobile tables whose check failed with no data in
 */
export function statusCtx({ iotStatus, mobile } = {}) {
  const iotDayValue = iotStatus?.livenessRange?.max ?? null;
  const trafficThrough = iotStatus?.trafficRange?.max ?? null;
  const rewardsDay = mobile?.rewards?.latest?.day ?? null;
  const rewardsFirstDay = mobile?.rewards?.firstDay ?? null;
  const windows = mobile?.windows ?? {};
  return {
    iotDay: iotDayValue,
    trafficThrough,
    iotDayLabel: iotDayValue ? `${fmtDataDay(iotDayValue)} (UTC)` : null,
    trafficWindow: trafficThrough ? `30 days to ${fmtDataDay(trafficThrough)} (UTC)` : null,
    rewardsDay,
    rewardsFirstDay,
    rewardsDayLabel: rewardsDay ? `${fmtDataDay(rewardsDay)} (UTC)` : null,
    rewardsWindow: rewardsDay ? `7 days to ${fmtDataDay(rewardsDay)} (UTC)` : null,
    windows,
    issueText: mobile?.issueText ?? {},
    frozen: {
      heartbeats: windows.heartbeats ? !windows.heartbeats.current : false,
      invalidHeartbeats: windows.invalidHeartbeats ? !windows.invalidHeartbeats.current : false,
      speedtests: windows.speedtests ? !windows.speedtests.current : false,
    },
    failedTables: Object.keys(mobile?.failed ?? {}).filter((t) => mobile.failed[t]),
  };
}

/** The IoT state data for an `aggregateIotStatus` row: its own liveness day,
 * messages and their window end. */
export function iotStateData(iotRow) {
  return {
    day: iotRow?.anchor ? livenessDay(iotRow.anchor) : null,
    messages: iotRow?.messages ?? null,
    through: typeof iotRow?.traffic === "object" && iotRow.traffic ? iotRow.traffic.dataThrough : null,
    traffic: typeof iotRow?.traffic === "string" ? iotRow.traffic : "ok",
  };
}

export { isWifiNoIssue };
