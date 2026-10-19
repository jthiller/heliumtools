// ── The unified Hotspot list ─────────────────────────────────────────────────
// One row per Hotspot, IoT and Mobile together (a dual-network Hotspot is one
// row), derived once per flush from the other aggregates: rewards, IoT
// (`aggregateIotStatus`), Mobile (`aggregateMobile`) and onboard dates. The
// Hotspot list, Summary's "need a look", Health's "No rewarded data" note,
// the map's rings, the detail and the agent tool all read this object; none
// re-derives a row. Pure: no React, no fetch.
import {
  REWARD_DECIMALS,
  deviceKeyOf,
  deviceLabelOf,
  fmtCount,
  fmtDataDay,
  fmtUtcMonth,
  isEarning,
  onboardMonthOf,
  onboardedAtOf,
  plural,
} from "./format.js";
import { isMobileHotspot, isHeartbeatEligible, isWifiNoIssue } from "./mobileFormat.js";
import {
  STATES,
  TIER_ORDER,
  compareStates,
  iotStateData,
  makeState,
  needsALook,
  stateRank,
  statusCtx,
  statusFilterLabel,
} from "./statusRegistry.js";

const TOKENS = ["hnt", "iot", "mobile"];
// Reward reasons where the oracle couldn't say what's pending (the worker then
// reports lifetime = claimed, a lower bound).
const UNCONFIRMED_REASONS = new Set(["no_oracle_response", "error"]);
const MOBILE_TABLES_ALL = ["rewards", "bans"];
const MOBILE_TABLES_WIFI = ["heartbeats", "invalidHeartbeats", "speedtests"];
const SPARK_CAP_ABOVE = 200;

const nameCollator = new Intl.Collator("en-US");
const tokUi = (tok, field, token) => (tok?.[field] ? Number(tok[field]) / 10 ** REWARD_DECIMALS[token] : 0);

/** A place as recorded: { city, state, country, label "Lutz, FL", full "Lutz, FL, United States" }. */
export function placeOf(hotspot) {
  const city = hotspot?.city || null;
  const state = hotspot?.state || null;
  const country = hotspot?.country || null;
  const label = city && state ? `${city}, ${state}` : state || city || null;
  const full = [city, state, country].filter(Boolean).join(", ") || null;
  return { city, state, country, label, full };
}

/** Which networks a fleet row is on: CBRS is `deviceType` cbrs, or Mobile
 * only with an ecc_compact (`11…`) key; `none` is no network at all. */
export function netsOf(hotspot) {
  const networks = hotspot?.networks || [];
  const iot = networks.includes("iot");
  const mobile = networks.includes("mobile");
  const key = hotspot?.entityKey || "";
  const cbrs = hotspot?.deviceType === "cbrs" || (mobile && !iot && key.startsWith("11"));
  return { iot, mobile, dual: iot && mobile, none: networks.length === 0, cbrs };
}

function rewardsOf(r, { hasAsset, done }) {
  if (!hasAsset) {
    return {
      unclaimed: { hnt: null, state: "unavailable", reason: null, claimable: false, destination: null, legacy: null },
      lifetime: { hnt: null, claimed: null, lowerBound: false, never: null, legacyOnly: false, legacy: null, state: "unavailable" },
      earning: null,
    };
  }
  if (r === undefined || r === null) {
    const state = r === null || done ? "failed" : "loading";
    return {
      unclaimed: { hnt: null, state, reason: null, claimable: false, destination: null, legacy: null },
      lifetime: { hnt: null, claimed: null, lowerBound: false, never: null, legacyOnly: false, legacy: null, state },
      earning: null,
    };
  }
  const hnt = r.hnt;
  const unconfirmed = UNCONFIRMED_REASONS.has(hnt?.reason);
  const legacyPending = { iot: tokUi(r.iot, "pending", "iot"), mobile: tokUi(r.mobile, "pending", "mobile") };
  const legacyLife = { iot: tokUi(r.iot, "lifetime", "iot"), mobile: tokUi(r.mobile, "lifetime", "mobile") };
  const lifeHnt = tokUi(hnt, "lifetime", "hnt");
  const earning = isEarning(r);
  return {
    unclaimed: {
      hnt: unconfirmed ? null : tokUi(hnt, "pending", "hnt"),
      state: unconfirmed ? "unconfirmed" : "ok",
      reason: hnt?.reason ?? null,
      claimable: Boolean(hnt?.claimable),
      destination: TOKENS.map((t) => r[t]?.destination).find(Boolean) ?? null,
      legacy: legacyPending,
    },
    lifetime: {
      hnt: lifeHnt,
      claimed: tokUi(hnt, "claimed", "hnt"),
      lowerBound: unconfirmed,
      never: earning === false,
      legacyOnly: lifeHnt === 0 && (legacyLife.iot > 0 || legacyLife.mobile > 0),
      legacy: legacyLife,
      state: "ok",
    },
    earning,
  };
}

function weekOf(mobileRow) {
  if (!mobileRow) return { hnt: null, days: null, daysLoaded: 0, daysWithHnt: 0, keyed: false, state: "na" };
  const days = mobileRow.days7;
  const w = mobileRow.week;
  const loading = days.some((d) => d.state === "loading");
  const allOk = days.every((d) => d.state === "ok");
  const state = loading ? "loading" : allOk ? "ok" : w.daysLoaded > 0 ? "partial" : "failed";
  return {
    hnt: loading || w.daysLoaded === 0 ? null : w.hnt,
    bytes: loading || w.daysLoaded === 0 ? null : w.bytes,
    days,
    daysLoaded: w.daysLoaded,
    daysWithHnt: w.daysWithHnt,
    keyed: w.keyed,
    state,
  };
}

function messagesOf(iot) {
  if (!iot) return { count: null, state: "na" };
  if (iot.status === "pending" || iot.traffic === "pending") return { count: null, state: "pending" };
  if (iot.messages != null) return { count: iot.messages, state: "ok" };
  return { count: null, state: iot.traffic === "unpublished" ? "unpublished" : "unavailable" };
}

function topReasonOf(reasons) {
  let top = null;
  for (const [reason, n] of Object.entries(reasons || {})) if (!top || n > top[1]) top = [reason, n];
  return top?.[0] ?? null;
}

const sameIot = (a, b) =>
  a === b ||
  (a != null &&
    b != null &&
    a.status === b.status &&
    a.traffic === b.traffic &&
    a.health === b.health &&
    a.anchor === b.anchor &&
    a.hex === b.hex &&
    a.lookupFailed === b.lookupFailed);

/**
 * The row's states: every verdict that applies (`verdicts`, filters match on
 * it), what the row shows (`states`, top first: OK-tier states only when no
 * other state applies, "Checking…" while a source is pending and nothing
 * Serious or Check is known yet), and whether it's still checking.
 */
function statesOf(ctx, row, { mobileRow, mobile, iot, rewards, onboardDates }) {
  const all = [];
  const add = (key, data) => all.push(makeState(key, ctx, data));
  const { nets, wifi, dataOnly, week } = row;
  let pending = row.unclaimed.state === "loading";

  if (mobileRow) {
    const relevant = wifi ? [...MOBILE_TABLES_ALL, ...MOBILE_TABLES_WIFI] : MOBILE_TABLES_ALL;
    const failedTables = relevant.filter((t) => mobile.failed?.[t]);
    if (relevant.some((t) => t !== "rewards" && !mobile.loaded?.[t] && !mobile.failed?.[t])) pending = true;
    if (week.state === "loading") pending = true;
    for (const issue of mobileRow.issues) {
      if (issue === "banned") add("banned", { reason: mobileRow.ban?.reason, at: mobileRow.ban?.at });
      else if (issue === "lowTrust") add("lowTrust", { trust: mobileRow.trust });
      else if (issue === "lowSpeedtest") add("lowSpeedtest", { multiplier: mobileRow.speedtestMultiplier });
      else if (issue === "rejectedHeartbeats") add("rejectedHeartbeats", { topReason: topReasonOf(mobileRow.rejectedReasons) });
      else add(issue);
    }
    // No rewarded data (7 days): every day in and keyed per Hotspot, nothing
    // earned or rewarded on any, yet rewarded before (so onboarded before the
    // window). A known Mobile onboard date inside the window vetoes it; a date
    // still loading never holds it.
    const mobileOnb = onboardDates?.mobile;
    const days = mobileRow.days7;
    if (
      week.state === "ok" &&
      week.keyed &&
      days.length === 7 &&
      days.every((d) => d.hnt === 0 && d.bytes === 0) &&
      rewards.earning === true &&
      !(mobileOnb && ctx.rewardsFirstDay && mobileOnb.slice(0, 10) >= ctx.rewardsFirstDay)
    ) {
      add("noRewardedData");
    }
    if (failedTables.length) add("mobileFailed", { tables: failedTables });
    if (wifi && mobileRow.heartbeating === true) {
      add("heartbeatOk", { at: mobileRow.lastHeartbeatAt, frozen: Boolean(ctx.frozen?.heartbeats) });
    }
    // Counted over the days that loaded: a missing day is never "not rewarded".
    if (dataOnly && (week.state === "ok" || week.state === "partial") && week.daysWithHnt > 0) {
      add("rewardedDays", { days: week.daysWithHnt, of: week.daysLoaded });
    }
  }

  if (iot) {
    const data = iotStateData(iot);
    if (iot.status === "pending") pending = true;
    else if (iot.status === "unknown") add(iot.lookupFailed ? "iotFailed" : "iotUnknown");
    else if (iot.status === "settingUp") add("settingUp", { onboardedAt: onboardDates?.iot ?? null });
    else if (iot.health) add(iot.health, data);
    else add(iot.status, data); // active / inactive, traffic not known
  }

  if (nets.cbrs) add("noStatus", { reason: "cbrs" });
  else if (nets.none) add("noStatus", { reason: "network" });

  if (rewards.earning === false) {
    const first = onboardMonthOf(onboardDates)?.at;
    const onboardedDay = first && ctx.rewardsFirstDay && first.slice(0, 10) >= ctx.rewardsFirstDay ? first.slice(0, 10) : null;
    add("neverRewarded", { onboardedDay });
  }
  if (!row.asserted) add("noLocation");

  all.sort(compareStates);
  const verdicts = new Set(all.map((s) => s.key));
  const problems = all.filter((s) => s.tier !== "ok");
  let states = problems.length ? problems : all;
  if (pending && !states.some((s) => needsALook(s.tier))) states = [makeState("checking", ctx)];
  if (!states.length) {
    const fallback = makeState("noStatus", ctx, { reason: "none" });
    states = [fallback];
    verdicts.add("noStatus");
  }
  if (pending) verdicts.add("checking");
  const needs = [...verdicts].some((k) => needsALook(STATES[k]?.tier));
  return { states, verdicts, checking: pending, needs };
}

function rowSig(r) {
  const parts = [
    r.name,
    r.unclaimed.state,
    r.unclaimed.hnt,
    r.unclaimed.reason,
    r.unclaimed.claimable,
    r.unclaimed.destination,
    r.unclaimed.legacy ? `${r.unclaimed.legacy.iot},${r.unclaimed.legacy.mobile}` : "",
    r.lifetime.hnt,
    r.lifetime.claimed,
    r.lifetime.legacy ? `${r.lifetime.legacy.iot},${r.lifetime.legacy.mobile}` : "",
    r.day.state,
    r.day.hnt,
    r.week.state,
    r.week.hnt,
    r.week.days ? r.week.days.map((d) => `${d.state}${d.hnt}`).join(",") : "",
    r.messages.state,
    r.messages.count,
    r.onboarded.at,
    r.onboarded.iot,
    r.onboarded.mobile,
    r.users,
    r.checking,
    r.needs,
    [...r.verdicts].join(","),
    r.states.map((s) => `${s.key}:${s.label}:${s.window}:${s.window2}:${s.at}`).join(";"),
  ];
  return parts.join("|");
}

/**
 * @typedef {object} State  see statusRegistry `makeState`:
 *   { key, tier, label, window, window2, network, at }
 *
 * @typedef {object} HotspotRow  one Hotspot (a dual-network Hotspot is one row)
 * @property {string} key            entity key
 * @property {string|null} assetId
 * @property {string|null} name      the UI falls back to "Unnamed Hotspot"
 * @property {object} hotspot        the fleet row
 * @property {string} param          the `hotspot` URL value: asset ID, else the entity key
 * @property {{iot,mobile,dual,none,cbrs}} nets
 * @property {boolean} wifi          WiFi indoor/outdoor (heartbeats, speedtests)
 * @property {boolean} dataOnly      Mobile WiFi data-only
 * @property {string} device         DEVICE_LABEL key, or "unknown"
 * @property {string} deviceLabel    "Mobile WiFi Indoor", "Unknown device"
 * @property {{city,state,country,label,full}} place
 * @property {string} placeText      place label, else "Place not reported" / "No asserted location"
 * @property {boolean} asserted
 * @property {object|null} iot       aggregateIotStatus row
 * @property {object|null} mobile    aggregateMobile row (Mobile-table Hotspots only)
 * @property {State[]} states        shown, top first
 * @property {State} top
 * @property {string} tier           top's tier
 * @property {boolean} needs         any Serious or Check verdict
 * @property {boolean} checking      a verdict source is still pending
 * @property {Set<string>} verdicts  every applying state key (OK-tier network verdicts too, plus "checking")
 * @property {string|null} netLine   "Mobile: No status reported" for a dual row outside the Mobile tables
 * @property {string|null} noDaily   why there's no daily HNT: "iot" | "cbrs" | "none" (null for Mobile rows)
 * @property {object} unclaimed      { hnt, state: "loading"|"ok"|"failed"|"unconfirmed"|"unavailable",
 *                                     reason, claimable, destination, legacy: {iot, mobile} }
 * @property {object} lifetime       { hnt, claimed, lowerBound, never, legacyOnly, legacy: {iot, mobile}, state }
 * @property {object} day            latest UTC day, Mobile only: { day, hnt, bytes, state:
 *                                     "loading"|"ok"|"missing"|"failed"|"na" }
 * @property {object} week           { hnt, bytes, days (7, oldest first), daysLoaded, daysWithHnt, keyed,
 *                                     state: "loading"|"ok"|"partial"|"failed"|"na" }
 * @property {object} messages       { count, state: "pending"|"ok"|"unavailable"|"unpublished"|"na" }
 * @property {number|null} users     users served on the usage day (null = not reported)
 * @property {object} onboarded      { at (earliest; undefined loading, null unknown), iot, mobile, month }
 * @property {string} search         lowercased name, entity key, asset ID, city, state
 * @property {string} sig            identity-reuse signature
 */

/**
 * The unified list, derived once per flush.
 *
 * @param {object} p
 * @param {object[]|undefined} p.hotspots  the wallet's fleet rows (undefined while loading)
 * @param {object} p.iotStatus             aggregateIotStatus result
 * @param {boolean} p.iotDone              the IoT figures are final (scan done, no row pending),
 *                                         or a Retry of failed lookups runs (its rows read
 *                                         "Checking…")
 * @param {object} p.mobile                aggregateMobile result
 * @param {boolean} p.mobileSettled        activity.checked || phase "error" || no Mobile Hotspots
 * @param {object} p.rewardsByKey, p.onboardedByKey
 * @param {boolean} p.rewardsDone, p.onboardedDone
 * @param {boolean} [p.rewardsRetrying]    a Retry of failed batches runs: its rows read
 *                                         "Checking…" but `settled.rewards` stays true
 *                                         (the figures that settled don't drop back)
 * @param {number|null} p.fleetCount       summary.fleet.count, for "{n} Hotspots couldn't be listed"
 * @param {object|null} p.prev             the previous result: unchanged rows keep their identity
 * @returns {HotspotListAgg}
 *   { rows, byKey, byParam, ctx, settled, counts, members, totals, spark }
 *   settled: { rewards, iot, mobile, verdicts (rewards && iot && mobile), onboard, all }
 *   counts: { total, unlisted, iot, mobile, dual, noNetwork, wifi, dataOnly, mobileTables,
 *             devices: { [device]: n }, needs (null until settled.verdicts),
 *             byState: { [stateKey | "needs" | "ok" | "mobileOk"]: n } (over verdicts),
 *             byTier: { [tier]: n } (top tiers) }
 *   members: { [stateKey | "needs" | "ok" | "mobileOk"]: HotspotRow[] } in fleet order
 *   totals: sumRows(rows)
 *   spark: { scaleMax, capped } the shared sparkline scale (95th percentile above 200 rows)
 */
export function aggregateHotspotList({
  hotspots,
  iotStatus,
  iotDone,
  mobile,
  mobileSettled,
  rewardsByKey,
  rewardsDone,
  rewardsRetrying = false,
  onboardedByKey,
  onboardedDone,
  fleetCount = null,
  prev = null,
}) {
  const ctx = statusCtx({ iotStatus, mobile });
  const rows = [];
  const byKey = new Map();
  const byParam = new Map();
  const counts = {
    total: 0,
    unlisted: 0,
    iot: 0,
    mobile: 0,
    dual: 0,
    noNetwork: 0,
    wifi: 0,
    dataOnly: 0,
    mobileTables: 0,
    devices: {},
    needs: null,
    byState: {},
    byTier: Object.fromEntries(TIER_ORDER.map((t) => [t, 0])),
  };
  const members = {};
  const member = (key, row) => {
    (members[key] ??= []).push(row);
    counts.byState[key] = (counts.byState[key] ?? 0) + 1;
  };

  for (const h of hotspots || []) {
    const key = h.entityKey;
    if (!key) continue;
    const nets = netsOf(h);
    const onMobileTables = isMobileHotspot(h);
    const mobileRow = mobile?.rows?.get(key) ?? null;
    const wifi = onMobileTables && isHeartbeatEligible(h);
    const dataOnly = onMobileTables && !wifi;
    const iot = iotStatus?.rows?.get(key) ?? null;
    const hasAsset = Boolean(h.assetId);
    const rewards = rewardsOf(rewardsByKey?.[key], { hasAsset, done: rewardsDone });
    const onboardDates = onboardedByKey?.[key];
    const place = placeOf(h);
    const asserted = Boolean(h.location);
    const device = deviceKeyOf(h.deviceType);
    const week = weekOf(mobileRow);
    const lastDay = mobileRow?.days7?.[mobileRow.days7.length - 1];
    const row = {
      key,
      assetId: h.assetId || null,
      name: h.name || null,
      hotspot: h,
      param: h.assetId || key,
      nets,
      wifi,
      dataOnly,
      device,
      deviceLabel: deviceLabelOf(h.deviceType || device),
      place,
      placeText: place.label || (asserted ? "Place not reported" : "No asserted location"),
      asserted,
      iot,
      mobile: mobileRow,
      unclaimed: rewards.unclaimed,
      lifetime: rewards.lifetime,
      day: mobileRow
        ? { day: lastDay?.day ?? null, hnt: lastDay?.hnt ?? null, bytes: lastDay?.bytes ?? null, state: lastDay?.state ?? "loading" }
        : { day: null, hnt: null, bytes: null, state: "na" },
      week,
      noDaily: mobileRow ? null : nets.cbrs ? "cbrs" : nets.iot ? "iot" : "none",
      messages: messagesOf(iot),
      users: mobileRow?.users ?? null,
      onboarded: {
        at: onboardedAtOf(onboardDates),
        iot: onboardDates === undefined ? undefined : (onboardDates.iot ?? null),
        mobile: onboardDates === undefined ? undefined : (onboardDates.mobile ?? null),
        month: onboardMonthOf(onboardDates)?.month ?? null,
      },
      netLine: nets.dual && !mobileRow ? "Mobile: No status reported" : null,
      search: [h.name, key, h.assetId, place.city, place.state].filter(Boolean).join("\n").toLowerCase(),
    };
    const s = statesOf(ctx, row, { mobileRow, mobile, iot, rewards, onboardDates });
    row.states = s.states;
    row.top = s.states[0];
    row.tier = row.top.tier;
    row.verdicts = s.verdicts;
    row.checking = s.checking;
    row.needs = s.needs;
    row.sig = rowSig(row);

    const old = prev?.byKey?.get(key);
    const out =
      old && old.sig === row.sig && old.hotspot === h && old.mobile === mobileRow && sameIot(old.iot, iot) ? old : row;
    rows.push(out);
    byKey.set(key, out);
    byParam.set(out.param, out);

    counts.total++;
    if (nets.iot) counts.iot++;
    if (nets.mobile) counts.mobile++;
    if (nets.dual) counts.dual++;
    if (nets.none) counts.noNetwork++;
    if (wifi) counts.wifi++;
    if (dataOnly) counts.dataOnly++;
    if (onMobileTables) counts.mobileTables++;
    counts.devices[device] = (counts.devices[device] ?? 0) + 1;
    counts.byTier[out.tier]++;
    for (const k of out.verdicts) member(k, out);
    if (out.needs) member("needs", out);
    if (out.tier === "ok" && !out.checking) member("ok", out);
    if (isWifiNoIssue(out.mobile)) member("mobileOk", out);
  }

  const settledRewards = Boolean(rewardsDone) || Boolean(rewardsRetrying);
  const settledIot = Boolean(iotDone) && (iotStatus?.awaitingDate ?? 0) === 0;
  const settledMobile = Boolean(mobileSettled);
  const verdicts = settledRewards && settledIot && settledMobile && hotspots !== undefined;
  const settled = {
    rewards: settledRewards,
    iot: settledIot,
    mobile: settledMobile,
    verdicts,
    onboard: Boolean(onboardedDone),
    all: verdicts && Boolean(onboardedDone),
  };
  counts.unlisted = fleetCount != null && fleetCount > counts.total ? fleetCount - counts.total : 0;
  counts.needs = verdicts ? (counts.byState.needs ?? 0) : null;

  return {
    rows,
    byKey,
    byParam,
    ctx,
    settled,
    counts,
    members,
    totals: sumRows(rows),
    spark: sparkScale(rows),
  };
}

/**
 * Totals over any set of rows (the whole list, or the filtered rows for
 * "Total, 3 shown"): numbers over the rows whose value is known.
 *   { unclaimedHnt, unclaimedKnown (rows with a known unclaimed figure),
 *     unconfirmed, rewardsFailed (rows whose rewards batch failed),
 *     latestDayHnt, weekHnt, lifetimeHnt, lifetimeLowerBound, messages30d,
 *     rewardsChecked (rows with a lifetime figure), count }
 */
export function sumRows(rows) {
  const t = {
    count: 0,
    unclaimedHnt: 0,
    unclaimedKnown: 0,
    unconfirmed: 0,
    rewardsFailed: 0,
    latestDayHnt: 0,
    weekHnt: 0,
    lifetimeHnt: 0,
    lifetimeLowerBound: false,
    messages30d: 0,
    rewardsChecked: 0,
  };
  for (const r of rows) {
    t.count++;
    if (r.unclaimed.state === "ok") {
      t.unclaimedHnt += r.unclaimed.hnt;
      t.unclaimedKnown++;
    }
    if (r.unclaimed.state === "unconfirmed") t.unconfirmed++;
    if (r.unclaimed.state === "failed") t.rewardsFailed++;
    if (r.lifetime.state === "ok") {
      t.rewardsChecked++;
      t.lifetimeHnt += r.lifetime.hnt;
      if (r.lifetime.lowerBound) t.lifetimeLowerBound = true;
    }
    if (r.day.state === "ok") t.latestDayHnt += r.day.hnt;
    if (r.week.hnt != null) t.weekHnt += r.week.hnt;
    if (r.messages.state === "ok") t.messages30d += r.messages.count;
  }
  return t;
}

/** The list's one sparkline scale: the largest single-Hotspot day, capped at
 * the 95th percentile of positive days above 200 rows (`capped`: some bar is
 * clipped, and gets a notch). */
export function sparkScale(rows) {
  const values = [];
  for (const r of rows) for (const d of r.week.days || []) if (d.state === "ok" && d.hnt > 0) values.push(d.hnt);
  if (!values.length) return { scaleMax: 0, capped: false };
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (rows.length <= SPARK_CAP_ABOVE) return { scaleMax: max, capped: false };
  values.sort((a, b) => a - b);
  const p95 = values[Math.floor(0.95 * (values.length - 1))];
  return { scaleMax: p95, capped: max > p95 };
}

// ── Filters and facets ──────────────────────────────────────────────────────

/** Whether a row passes the status filter (a state key, "needs", "ok" or "mobileOk"). */
export function matchesStatus(row, status) {
  if (!status || status === "all") return true;
  if (status === "needs") return row.needs;
  if (status === "ok") return row.tier === "ok" && !row.checking;
  if (status === "mobileOk") return isWifiNoIssue(row.mobile);
  return row.verdicts.has(status);
}

const matchesNet = (row, net) => !net || net === "all" || (net === "iot" ? row.nets.iot : row.nets.mobile);
const matchesDevice = (row, device) => !device || device === "all" || row.device === device;
const matchesMonth = (row, month) => !month || row.onboarded.month === month;
const matchesQuery = (row, q) => !q || row.search.includes(q);
const normQuery = (q) => (q || "").trim().toLowerCase();

// A short FNV-1a hash, so a filter's signature changes exactly when its rows do.
function hashKeys(rows) {
  let h = 0x811c9dc5;
  for (const r of rows) {
    const k = r.key;
    for (let i = 0; i < k.length; i += 7) {
      h ^= k.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The rows matching the URL's filters, in list (fleet) order: search (name,
 * entity key, asset ID, city, state), network (dual rows match both),
 * device (`unknown` = a null or unlisted type), status (a state key matched
 * on `verdicts`, `needs`, `ok`, `mobileOk`) and onboard `month` (YYYY-MM, the
 * `onboardMonthOf` rule the About timeline buckets with).
 * @returns {{ keys: Set<string>, rows: HotspotRow[], count, sig, narrowed, label }}
 *   `label` names the active filters for the result line ("No heartbeat (60 min)"),
 *   null when nothing narrows the list.
 */
export function filterRows(list, { q, net, device, status, month } = {}) {
  const query = normQuery(q);
  const rows = (list?.rows || []).filter(
    (r) =>
      matchesQuery(r, query) &&
      matchesNet(r, net) &&
      matchesDevice(r, device) &&
      matchesStatus(r, status) &&
      matchesMonth(r, month),
  );
  const narrowed = Boolean(query) || (net && net !== "all") || (device && device !== "all") || (status && status !== "all") || Boolean(month);
  const label =
    [
      status && status !== "all" ? statusFilterLabel(status, list?.ctx) : null,
      net === "iot" ? "IoT" : net === "mobile" ? "Mobile" : null,
      device && device !== "all" ? deviceLabelOf(device) : null,
      month ? `Onboarded ${fmtUtcMonth(month)} (UTC)` : null,
      query ? `matching "${q.trim()}"` : null,
    ]
      .filter(Boolean)
      .join(", ") || null;
  return {
    keys: new Set(rows.map((r) => r.key)),
    rows,
    count: rows.length,
    sig: `${rows.length}:${hashKeys(rows)}`,
    narrowed: Boolean(narrowed),
    label,
  };
}

/**
 * Faceted counts (JUDGE 7): each facet is counted over the search, the onboard
 * month and the other facets, never over itself, and the network and device
 * counts ignore the status filter (as the design's controls do).
 * @returns {{ net: {all, mobile, iot}, device: {all, [type]: n}, status: {all, needs, ok, mobileOk, [key]: n} }}
 */
export function facetCounts(list, { q, net, device, month } = {}) {
  const query = normQuery(q);
  const out = { net: { all: 0, mobile: 0, iot: 0 }, device: { all: 0 }, status: { all: 0 } };
  for (const r of list?.rows || []) {
    if (!matchesQuery(r, query) || !matchesMonth(r, month)) continue;
    const devOk = matchesDevice(r, device);
    const netOk = matchesNet(r, net);
    if (devOk) {
      out.net.all++;
      if (r.nets.mobile) out.net.mobile++;
      if (r.nets.iot) out.net.iot++;
    }
    if (netOk) {
      out.device.all++;
      out.device[r.device] = (out.device[r.device] ?? 0) + 1;
    }
    if (devOk && netOk) {
      const s = out.status;
      s.all++;
      for (const k of r.verdicts) s[k] = (s[k] ?? 0) + 1;
      if (r.needs) s.needs = (s.needs ?? 0) + 1;
      if (r.tier === "ok" && !r.checking) s.ok = (s.ok ?? 0) + 1;
      if (isWifiNoIssue(r.mobile)) s.mobileOk = (s.mobileOk ?? 0) + 1;
    }
  }
  return out;
}

// ── Sorting ─────────────────────────────────────────────────────────────────

// Name sorts A to Z by default, every other sort most first.
function defaultDir(key) {
  return key === "name" ? "asc" : "desc";
}

const hasDaily = (list) => (list?.counts?.mobileTables ?? 0) > 0;
const hasIot = (list) => (list?.counts?.iot ?? 0) > 0;
const dayLabel = (ctx) => `Earned ${ctx?.rewardsDayLabel ?? "latest UTC day"}`;

/**
 * The sort options. `value` is the URL form (`sort=lifetime`,
 * `sort=lifetime.asc`); `label(ctx)` the select option ("Unclaimed, most
 * first"), `short(ctx)` the "by Unclaimed" form, `phoneLabel(ctx)` the
 * phone select's ("Sort: Unclaimed, most first"); `available(list)`: Earned
 * and 7 days only with Mobile daily HNT, Messages only with IoT. The default
 * sort, Unclaimed most first, stays out of the URL.
 */
export const SORTS = [
  ["unclaimed", "desc", () => "Unclaimed, most first", () => "Unclaimed", () => true],
  ["unclaimed", "asc", () => "Unclaimed, least first", () => "Unclaimed", () => true],
  ["day", "desc", (c) => `${dayLabel(c)}, most first`, dayLabel, hasDaily],
  ["day", "asc", (c) => `${dayLabel(c)}, least first`, dayLabel, hasDaily],
  ["week", "desc", () => "7 days, most first", () => "7 days", hasDaily],
  ["week", "asc", () => "7 days, least first", () => "7 days", hasDaily],
  ["lifetime", "desc", () => "Lifetime, most first", () => "Lifetime", () => true],
  ["lifetime", "asc", () => "Lifetime, least first", () => "Lifetime", () => true],
  ["status", "desc", () => "Status, needs a look first", () => "Status", () => true],
  ["status", "asc", () => "Status, no issues first", () => "Status", () => true],
  ["name", "asc", () => "Name, A to Z", () => "Name", () => true],
  ["name", "desc", () => "Name, Z to A", () => "Name", () => true],
  ["onboarded", "desc", () => "Onboarded, newest first", () => "Onboarded", () => true],
  ["onboarded", "asc", () => "Onboarded, oldest first", () => "Onboarded", () => true],
  ["messages", "desc", () => "Messages, 30 days (IoT), most first", () => "Messages", hasIot],
  ["messages", "asc", () => "Messages, 30 days (IoT), least first", () => "Messages", hasIot],
].map(([key, dir, label, short, available]) => ({
  key,
  dir,
  value: serializeSort({ key, dir }),
  label,
  short,
  phoneLabel: (ctx) => `Sort: ${label(ctx)}`,
  available,
}));

export const SORT_KEYS = [...new Set(SORTS.map((s) => s.key))];
export const DEFAULT_SORT = Object.freeze({ key: "unclaimed", dir: "desc" });

/** "unclaimed" → { key, dir: "desc" }; "unclaimed.asc"; "name" is A to Z
 * by default. null for anything not a sort. */
export function parseSort(str) {
  if (typeof str !== "string" || !str) return null;
  const [key, dir, extra] = str.split(".");
  if (extra !== undefined || !SORT_KEYS.includes(key)) return null;
  if (dir === undefined) return { key, dir: defaultDir(key) };
  return dir === "asc" || dir === "desc" ? { key, dir } : null;
}

/** The URL form of a sort: the key alone in its default direction. */
export function serializeSort({ key, dir }) {
  return dir === defaultDir(key) ? key : `${key}.${dir}`;
}

/** The SORTS entry for a sort (or the default's). */
export const sortOption = (sort) =>
  SORTS.find((s) => s.key === sort?.key && s.dir === sort?.dir) ?? SORTS[0];

// A row's value for a sort key; null sends it to a labelled group after the
// ranked rows.
function sortValue(r, key) {
  switch (key) {
    case "unclaimed":
      return r.unclaimed.state === "ok" ? r.unclaimed.hnt : null;
    case "day":
      return r.day.state === "ok" ? r.day.hnt : null;
    case "week":
      return r.week.hnt;
    case "lifetime":
      return r.lifetime.state === "ok" ? r.lifetime.hnt : null;
    case "onboarded":
      return r.onboarded.at ? Date.parse(r.onboarded.at) : null;
    case "messages":
      return r.messages.state === "ok" ? r.messages.count : null;
    default:
      return null;
  }
}

// Whether a row without a value has an answer (a known "none") or is still
// being checked.
function answered(r, key) {
  switch (key) {
    case "unclaimed":
    case "lifetime":
      return r.unclaimed.state !== "loading";
    case "day":
      return r.day.state !== "loading";
    case "week":
      return r.week.state !== "loading";
    case "onboarded":
      return r.onboarded.at !== undefined;
    case "messages":
      return r.messages.state !== "pending";
    default:
      return true;
  }
}

const byName = (a, b) => nameCollator.compare(a.name || "", b.name || "");
const byLifetime = (a, b) => (sortValue(b, "lifetime") ?? -1) - (sortValue(a, "lifetime") ?? -1) || byName(a, b);
const statusRankOf = (r) => stateRank(r.top.key);

function restGroups(key, rest) {
  const groups = [];
  const known = rest.filter((r) => answered(r, key)).sort(byLifetime);
  const unchecked = rest.filter((r) => !answered(r, key)).sort(byLifetime);
  const allIot = (rows) => rows.every((r) => r.nets.iot);
  const allMobile = (rows) => rows.every((r) => r.nets.mobile);
  if (known.length) {
    if (key === "messages") {
      const iotRows = known.filter((r) => r.nets.iot);
      const other = known.filter((r) => !r.nets.iot);
      if (iotRows.length) {
        groups.push({ kind: "iotNoMsg", label: `Messages unavailable: ${plural(iotRows.length, "IoT Hotspot")}`, rows: iotRows });
      }
      if (other.length) {
        const noun = allMobile(other) ? "Mobile Hotspot" : "Hotspot";
        groups.push({ kind: "notOnIot", label: `Not on IoT: ${plural(other.length, noun)}`, rows: other });
      }
    } else if (key === "day" || key === "week") {
      // Hotspots with no daily HNT at all (IoT, CBRS, no network), apart from
      // Mobile ones whose day (or every one of the 7) is missing or failed.
      const none = known.filter((r) => r.noDaily);
      const gaps = known.filter((r) => !r.noDaily);
      if (none.length) {
        const noun = allIot(none) ? "IoT Hotspot" : "Hotspot";
        groups.push({ kind: "noDaily", label: `No daily HNT: ${plural(none.length, noun)}`, rows: none });
      }
      if (gaps.length) {
        groups.push({ kind: "dayUnavailable", label: `Daily HNT unavailable: ${plural(gaps.length, "Mobile Hotspot")}`, rows: gaps });
      }
    } else if (key === "onboarded") {
      groups.push({ kind: "onbUnknown", label: `Onboard date unknown: ${plural(known.length, "Hotspot")}`, rows: known });
    } else {
      const what = key === "lifetime" ? "Lifetime" : "Unclaimed";
      const unconfirmed = known.filter((r) => r.unclaimed.state === "unconfirmed");
      // No asset ID: rewards can't be asked for (the cells read "Unavailable").
      const noAsset = known.filter((r) => r.unclaimed.state === "unavailable");
      const failed = known.filter((r) => r.unclaimed.state !== "unconfirmed" && r.unclaimed.state !== "unavailable");
      if (unconfirmed.length) {
        groups.push({ kind: "unconfirmed", label: `Couldn't confirm Unclaimed: ${plural(unconfirmed.length, "Hotspot")}`, rows: unconfirmed });
      }
      if (failed.length) {
        groups.push({ kind: "failed", label: `Couldn't load ${what}: ${plural(failed.length, "Hotspot")}`, rows: failed });
      }
      if (noAsset.length) {
        groups.push({ kind: "unavailable", label: `${what} unavailable: ${plural(noAsset.length, "Hotspot")}`, rows: noAsset });
      }
    }
  }
  if (unchecked.length) {
    groups.push({ kind: "notChecked", label: `Not checked yet: ${plural(unchecked.length, "Hotspot")}`, rows: unchecked });
  }
  return groups;
}

/**
 * Order rows for a sort (WdHotspots `order()`): ranked rows first, then
 * labelled groups for rows without the sort's value ("No daily HNT: 2 IoT
 * Hotspots", "Daily HNT unavailable: …", "Not on IoT: 8 Mobile Hotspots",
 * "Messages unavailable: …", "Onboard date unknown: …", "Couldn't confirm
 * Unclaimed: …", "Couldn't load Unclaimed: …", "Unclaimed unavailable: …",
 * "Not checked yet: …"), each by Lifetime. Money sorts tie on 7 days, then Lifetime, then
 * name; the Status sort is tier, state order, Unclaimed, Lifetime, name.
 * @returns {{ groups: Array<{ kind: string|null, label: string|null, rows: HotspotRow[] }>, keys: string[] }}
 */
export function orderRows(rows, sort = DEFAULT_SORT) {
  const { key, dir } = sort && SORT_KEYS.includes(sort.key) ? sort : DEFAULT_SORT;
  const desc = dir !== "asc";
  let groups;
  if (key === "name") {
    // Unnamed Hotspots after the named ones in both directions (by entity key).
    const named = rows.filter((r) => r.name).sort((a, b) => (desc ? byName(b, a) : byName(a, b)));
    const unnamed = rows.filter((r) => !r.name).sort((a, b) => nameCollator.compare(a.key, b.key));
    groups = [{ kind: null, label: null, rows: [...named, ...unnamed] }];
  } else if (key === "status") {
    const cmp = (a, b) =>
      statusRankOf(a) - statusRankOf(b) ||
      (sortValue(b, "unclaimed") ?? -1) - (sortValue(a, "unclaimed") ?? -1) ||
      byLifetime(a, b);
    groups = [{ kind: null, label: null, rows: [...rows].sort((a, b) => (desc ? cmp(a, b) : cmp(b, a))) }];
  } else {
    const ranked = [];
    const rest = [];
    for (const r of rows) (sortValue(r, key) == null ? rest : ranked).push(r);
    const tie = (a, b) => (b.week.hnt ?? -1) - (a.week.hnt ?? -1) || byLifetime(a, b);
    ranked.sort((a, b) => {
      const d = sortValue(b, key) - sortValue(a, key);
      return (desc ? d : -d) || tie(a, b);
    });
    groups = [{ kind: null, label: null, rows: ranked }, ...restGroups(key, rest)];
  }
  groups = groups.filter((g) => g.rows.length);
  return { groups, keys: groups.flatMap((g) => g.rows.map((r) => r.key)) };
}

// ── Presentation helpers ────────────────────────────────────────────────────

/**
 * The line above the rows when every Hotspot shares one no-traffic IoT state
 * on one day (WdHotspots): "All 26 are Inactive, no traffic on Oct 14 (UTC),
 * with no messages in the 30 days to Oct 14 (UTC)." Null otherwise, and
 * until the verdicts settle.
 */
export function summaryLine(list) {
  const rows = list?.rows || [];
  if (rows.length < 2 || !list.settled?.verdicts) return null;
  const top = rows[0].top;
  if (top.key !== "inactiveQuiet" && top.key !== "activeQuiet") return null;
  if (!rows.every((r) => r.top.key === top.key && r.top.window === top.window && r.top.window2 === top.window2)) return null;
  const through = rows[0].iot?.traffic?.dataThrough ?? list.ctx?.trafficThrough;
  const label = STATES[top.key].label(list.ctx);
  const end = through ? `${fmtDataDay(through)} (UTC)` : "the latest reported day";
  return `All ${fmtCount(rows.length)} are ${label} on ${top.window}, with no messages in the 30 days to ${end}.`;
}

/**
 * What a line waiting on the verdicts says, the one wording for the Hotspot
 * list's subtitle, Summary's status line and the map: the rewards scan
 * ("Checking 150 of 1,659 Hotspots…"), then IoT ("Checking 1 of 2 IoT
 * Hotspots…"), then Mobile ("Checking 8 Mobile Hotspots…": a saved paint can
 * have every row answered while the live check runs, so no count that reads
 * complete), else "Checking 10 Hotspots…".
 */
export function checkingText(list) {
  const rows = list?.rows || [];
  const total = list?.counts?.total ?? rows.length;
  const s = list?.settled || {};
  if (!s.rewards) {
    const n = rows.reduce((k, r) => k + (r.unclaimed.state === "loading" ? 0 : 1), 0);
    if (n < total) return `Checking ${fmtCount(n)} of ${plural(total, "Hotspot")}…`;
  }
  const iot = list?.counts?.iot ?? 0;
  if (!s.iot && iot > 0) {
    const n = rows.reduce((k, r) => k + (r.nets.iot && r.iot && r.iot.status !== "pending" ? 1 : 0), 0);
    return n < iot ? `Checking ${fmtCount(n)} of ${plural(iot, "IoT Hotspot")}…` : `Checking ${plural(iot, "IoT Hotspot")}…`;
  }
  const mobileN = list?.counts?.mobileTables ?? 0;
  if (!s.mobile && mobileN > 0) return `Checking ${plural(mobileN, "Mobile Hotspot")}…`;
  return `Checking ${plural(total, "Hotspot")}…`;
}

/**
 * Whether a verdict source failed or froze, so "No issues" would be a claim
 * the page can't make ("0 of 10 need a look" instead): an IoT lookup or a
 * rewards batch that failed, a Mobile table that couldn't load, or Mobile
 * data shown from an older check (mobileFreshness frozen or error).
 */
export function verdictsPartial(list, freshness) {
  const b = list?.counts?.byState || {};
  if ((b.iotFailed ?? 0) > 0 || (b.mobileFailed ?? 0) > 0 || (list?.totals?.rewardsFailed ?? 0) > 0) return true;
  return (list?.counts?.mobileTables ?? 0) > 0 && (freshness?.state === "frozen" || freshness?.state === "error");
}

/**
 * How the Hotspot detail is presented: "inline" (the wallet has exactly one
 * Hotspot: the detail is the section body), "aside" (≥ 1280 px, beside the
 * list), "drawer" (768 to 1279, a modal dialog from the right) or
 * "fullscreen" (below 768). `wide` / `medium`: the (min-width: 1280px) and
 * (min-width: 768px) media queries.
 */
export function detailModeOf(total, { wide, medium }) {
  if (total === 1) return "inline";
  return wide ? "aside" : medium ? "drawer" : "fullscreen";
}
