// ── Data status ──────────────────────────────────────────────────────────────
// The page-level freshness signal (WdSummary's chip and popover): one row per
// source the page reads, what it covers ("As of 8:05 PM", "Oct 17 (UTC), 2 of
// 2 IoT Hotspots reported") and its state, plus the chip's one-line summary.
// The Mobile row and the chip's Mobile wording come from `mobileFreshness()`,
// never re-derived here. Pure: no React, no fetch.
import { fmtCount, fmtDataDay, indexForBuild, plural } from "../format.js";
import { fmtClock } from "../mobileFormat.js";
import { DATA_ONLY_NOTE } from "../copy.js";

const WAIT = "Waiting for the first check";
const WAIT_FLEET = "Unavailable until Hotspots load";
const LOADED = "Loaded";
const COULDNT_LOAD = "Couldn't load";
const COULDNT_CHECK = "Couldn't check";
const NONE = "None";
const TABLE_WORD = {
  rewards: "earnings",
  usage: "users served",
  bans: "bans",
  heartbeats: "heartbeats",
  invalidHeartbeats: "rejected heartbeats",
  speedtests: "speedtests",
};

/** "A", "A and B", "A, B and C". */
const joinAnd = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// What the Mobile figures cover, by the windows as they stand (a frozen window
// is named by its end: "heartbeats 60 min to 7:42 PM").
function mobileCoverage(list) {
  const ctx = list.ctx;
  const day = ctx.rewardsDayLabel;
  if (list.counts.wifi === 0) {
    return day
      ? `Earnings and bans, ${day}. ${DATA_ONLY_NOTE}`
      : `Earnings and bans. ${DATA_ONLY_NOTE}`;
  }
  const hb = ctx.windows?.heartbeats?.span ?? "last 60 min";
  const sp = ctx.windows?.speedtests?.span ?? "last 24 h";
  return `${day ? `Earnings ${day}` : "Earnings"}, heartbeats ${hb}, speedtests ${sp}`;
}

function mobileSource(list, freshness, activity) {
  const cover = mobileCoverage(list);
  switch (freshness.state) {
    case "checking":
      return { kind: "checking", anchor: WAIT, state: "Checking" };
    case "saved":
      return { kind: "checking", anchor: freshness.from ? `${freshness.from} ${cover}` : cover, state: freshness.word };
    case "error":
    case "frozen": {
      const hasData = Boolean(activity?.rewards || activity?.heartbeats || activity?.bans || activity?.usage);
      return {
        kind: "error",
        // The one note every surface shows ("Couldn't update heartbeats.
        // Showing data from 7:42 PM."), then what the figures cover.
        anchor: hasData && (freshness.note || freshness.from) ? `${freshness.note ?? freshness.from} ${cover}` : "Mobile activity unavailable",
        state: COULDNT_CHECK,
      };
    }
    default: {
      // Live, updating or paused: some tables can still have failed with no data in.
      const failed = list.ctx.failedTables ?? [];
      if (failed.length) {
        return {
          kind: "error",
          anchor: `Couldn't load ${joinAnd(failed.map((t) => TABLE_WORD[t] ?? t))}. ${cover}`,
          state: COULDNT_CHECK,
        };
      }
      return {
        kind: "live",
        anchor: cover,
        state: freshness.word,
        checkedAt: freshness.showChecked ? freshness.checkedAt : null,
        dotClass: freshness.dotClass,
      };
    }
  }
}

function iotSources(list, iotStatus, iotDone, utilizationIndex) {
  const total = iotStatus.iotTotal;
  const day = iotStatus.livenessRange?.max ?? null;
  const dayLabel = day ? `${fmtDataDay(day)} (UTC)` : null;
  if (!iotDone) {
    return [
      {
        key: "iot",
        name: "IoT status",
        kind: "checking",
        anchor: `Checking ${fmtCount(iotStatus.counted)} of ${plural(total, "IoT Hotspot")}`,
        state: "Checking",
      },
    ];
  }
  if (iotStatus.failed >= total) {
    return [
      {
        key: "iot",
        name: "IoT status and messages",
        kind: "error",
        anchor: `${dayLabel ? `${dayLabel} status` : "Status"} and 30-day messages unavailable`,
        state: COULDNT_CHECK,
      },
    ];
  }
  const reported = (iotStatus.active ?? 0) + (iotStatus.inactive ?? 0);
  const failed = iotStatus.failed > 0 ? `, ${fmtCount(iotStatus.failed)} couldn't be checked` : "";
  const status = {
    key: "iot",
    name: "IoT status",
    kind: iotStatus.failed > 0 ? "error" : "ok",
    anchor: dayLabel
      ? `${dayLabel}, ${fmtCount(reported)} of ${plural(total, "IoT Hotspot")} reported${failed}`
      : `No status reported for ${plural(total, "IoT Hotspot")}${failed}`,
    state: iotStatus.failed > 0 ? COULDNT_CHECK : LOADED,
  };
  const t = iotStatus.traffic;
  const through = iotStatus.trafficRange?.max ?? null;
  let messages;
  if (t?.known > 0 && through) {
    const idx = indexForBuild(utilizationIndex, through);
    const complete = idx
      ? idx.daysComplete >= idx.days
        ? `, all ${idx.days} days complete`
        : `, ${fmtCount(idx.daysComplete)} of ${idx.days} days complete`
      : "";
    messages = {
      key: "iotMessages",
      name: "IoT messages",
      kind: "ok",
      anchor: `30 days to ${fmtDataDay(through)} (UTC)${complete}`,
      state: LOADED,
    };
  } else if (t?.unpublished > 0) {
    messages = { key: "iotMessages", name: "IoT messages", kind: "na", anchor: "30-day messages aren't published right now", state: NONE };
  } else {
    messages = { key: "iotMessages", name: "IoT messages", kind: "error", anchor: "30-day messages unavailable", state: COULDNT_LOAD };
  }
  return [status, messages];
}

function rewardsSource(money, list) {
  const u = money.unclaimed;
  const total = u.total;
  // A Retry of failed batches: only those Hotspots are checked again, so the
  // row says so (never a full restart's "Checking 1,100 of 2,172").
  if (u.retrying) {
    let n = 0;
    for (const r of list.rows) if (r.unclaimed.state === "loading") n++;
    return { key: "rewards", name: "Rewards", kind: "checking", anchor: `Retrying ${plural(n, "Hotspot")}`, state: "Retrying", retrying: n };
  }
  if (u.hotspotsState === "loading" || u.hotspotsState === "scanning" || (u.hotspotsState === "ready" && u.checked < total)) {
    return {
      key: "rewards",
      name: "Rewards",
      kind: "checking",
      anchor: `Checking ${fmtCount(u.checked)} of ${plural(total, "Hotspot")}`,
      state: "Checking",
    };
  }
  if (u.hotspotsState === "failed") {
    return { key: "rewards", name: "Rewards", kind: "error", anchor: "Hotspot rewards unavailable", state: COULDNT_LOAD };
  }
  if (u.hotspotsState === "none") {
    return { key: "rewards", name: "Rewards", kind: "na", anchor: "No Hotspot rewards to check", state: NONE };
  }
  let failed = 0;
  for (const r of list.rows) if (r.unclaimed.state === "failed") failed++;
  if (failed > 0) {
    return {
      key: "rewards",
      name: "Rewards",
      kind: "error",
      anchor: `${fmtCount(total - failed)} of ${plural(total, "Hotspot")} checked, ${fmtCount(failed)} couldn't be checked`,
      state: COULDNT_LOAD,
    };
  }
  const unconfirmed = list.totals.unconfirmed > 0 ? `, ${fmtCount(list.totals.unconfirmed)} couldn't be confirmed` : "";
  return {
    key: "rewards",
    name: "Rewards",
    kind: "ok",
    anchor: `${fmtCount(total)} of ${plural(total, "Hotspot")} checked${unconfirmed}`,
    state: LOADED,
  };
}

function onboardSource(list, onboarding) {
  const total = list.counts.total;
  if (!onboarding?.done) {
    return {
      key: "onboard",
      name: "Onboard dates",
      kind: "checking",
      anchor: `Checking ${fmtCount(onboarding?.progress?.done ?? 0)} of ${plural(total, "Hotspot")}`,
      state: "Checking",
    };
  }
  let dated = 0;
  for (const r of list.rows) if (r.onboarded.at) dated++;
  const unknown = total - dated;
  return {
    key: "onboard",
    name: "Onboard dates",
    kind: "ok",
    anchor: `${fmtCount(dated)} of ${plural(total, "Hotspot")}${unknown > 0 ? `, ${fmtCount(unknown)} unknown` : ""}`,
    state: LOADED,
  };
}

/**
 * @param {object} p
 * @param {{data, loading, error}} p.summary      useWalletSummary state
 * @param {{state: "loading"|"ready"|"failed"}} p.fleetState
 * @param {object} p.list                          aggregateHotspotList
 * @param {object} p.money                         deriveMoney
 * @param {{done, progress}} p.onboarding
 * @param {object} p.iotStatus                     aggregateIotStatus
 * @param {boolean} p.iotDone
 * @param {object|null} p.utilizationIndex
 * @param {object} p.freshness                     mobileFreshness
 * @param {object} p.activity                      useMobileActivity
 * @param {{data, loading, error}} p.governance, p.transactions
 * @returns {{
 *   chip: { tone: "checking"|"error"|"live"|"ok", label, checkedAt, dotClass },
 *   sources: [{ key, name, anchor, kind: "ok"|"live"|"na"|"checking"|"error", state, checkedAt?, dotClass? }]
 * }}
 *   chip.label is the whole chip text, except that a live Mobile chip names
 *   its check with `checkedAt` ("Live" + " · checked 1m ago", ticking).
 */
export function deriveDataStatus({
  summary,
  fleetState,
  list,
  money,
  onboarding,
  iotStatus,
  iotDone,
  utilizationIndex,
  freshness,
  activity,
  governance,
  transactions,
}) {
  const sources = [];
  const add = (key, name, kind, anchor, state, extra) => sources.push({ key, name, kind, anchor, state, ...extra });
  const s = summary?.data;
  const byNetwork = s?.fleet?.byNetwork ?? {};
  const firstLoad = !s && !summary?.error && fleetState.state === "loading";

  if (s) add("balances", "Balances and prices", "ok", `As of ${fmtClock(s.pricesFetchedAt ?? s.generatedAt ?? Date.now())}`, LOADED);
  else if (summary?.error)
    add("balances", "Balances and prices", "error", "Wallet value and USD at today's price are unavailable", COULDNT_LOAD);
  else add("balances", "Balances and prices", "checking", WAIT, "Checking");

  if (fleetState.state === "loading") {
    for (const [key, name] of [
      ["rewards", "Rewards"],
      ["onboard", "Onboard dates"],
    ]) {
      add(key, name, "checking", WAIT, "Checking");
    }
    // /summary leaves a network out of `byNetwork` when the wallet has none on it.
    if (byNetwork.iot > 0 || !s) add("iot", "IoT status", "checking", WAIT, "Checking");
    else add("iot", "IoT", "na", "No IoT Hotspots in this wallet", NONE);
    if (byNetwork.mobile > 0 || !s) add("mobile", "Mobile", "checking", WAIT, "Checking");
    else add("mobile", "Mobile", "na", "No Mobile Hotspots in this wallet", NONE);
  } else if (fleetState.state === "failed") {
    const count = s?.fleet?.count;
    add(
      "hotspots",
      "Hotspots",
      "error",
      count != null ? `List of ${plural(count, "Hotspot")} unavailable` : "List of Hotspots unavailable",
      COULDNT_LOAD,
    );
    add("rewards", "Rewards", "error", WAIT_FLEET, COULDNT_LOAD);
    add("onboard", "Onboard dates", "error", WAIT_FLEET, COULDNT_LOAD);
    if (byNetwork.iot > 0 || !s) add("iot", "IoT status and messages", "error", WAIT_FLEET, COULDNT_LOAD);
    if (byNetwork.mobile > 0 || !s) add("mobile", "Mobile", "error", WAIT_FLEET, COULDNT_LOAD);
  } else if (list.counts.total === 0) {
    add("hotspots", "Hotspots", "na", "No Hotspots in this wallet", NONE);
  } else {
    sources.push(rewardsSource(money, list));
    sources.push(onboardSource(list, onboarding));
    if (iotStatus.iotTotal > 0) sources.push(...iotSources(list, iotStatus, iotDone, utilizationIndex));
    else add("iot", "IoT", "na", "No IoT Hotspots in this wallet", NONE);
    if (freshness.state !== "none") sources.push({ key: "mobile", name: "Mobile", ...mobileSource(list, freshness, activity) });
    else add("mobile", "Mobile", "na", "No Mobile Hotspots in this wallet", NONE);
  }

  if (governance?.data) {
    const n = Number(governance.data.totals?.positionCount) || 0;
    add("vehnt", "veHNT", "ok", n > 0 ? plural(n, "position") : "No positions", LOADED);
  } else if (governance?.error) add("vehnt", "veHNT", "error", "veHNT positions unavailable", COULDNT_LOAD);
  else add("vehnt", "veHNT", "checking", WAIT, "Checking");

  if (transactions?.data) {
    const n = transactions.data.transactions?.length ?? 0;
    add(
      "activity",
      "Activity",
      "ok",
      n > 0 ? `${fmtCount(n)} most recent ${n === 1 ? "transaction" : "transactions"}` : "No transactions yet",
      LOADED,
    );
  } else if (transactions?.error) add("activity", "Activity", "error", "Recent transactions unavailable", COULDNT_LOAD);
  else add("activity", "Activity", "checking", WAIT, "Checking");

  // ── The chip: the most important thing about the sources, in one line ──
  let chip;
  const errors = sources.filter((x) => x.kind === "error");
  const mobile = sources.find((x) => x.key === "mobile");
  const checking = sources.filter((x) => x.kind === "checking" && x.key !== "mobile");
  // A failed Hotspot list takes its rewards, onboard, IoT and Mobile rows with
  // it: one source. Balances, veHNT and activity fail on their own.
  const FLEET_ROWS = new Set(["hotspots", "rewards", "onboard", "iot", "mobile"]);
  const otherErrors = errors.filter((x) => !FLEET_ROWS.has(x.key)).length;
  if (firstLoad) chip = { tone: "checking", label: "Checking" };
  else if (fleetState.state === "failed") {
    chip = { tone: "error", label: otherErrors ? `${otherErrors + 1} sources couldn't load` : "Hotspots couldn't load" };
  } else if (errors.length > 1 || (errors.length === 1 && errors[0].key !== "mobile")) {
    chip = { tone: "error", label: `${errors.length} ${errors.length === 1 ? "source" : "sources"} couldn't load` };
  } else if (errors.length === 1) {
    // Mobile alone: its own words when the whole check froze or failed ("Couldn't
    // check · data from 7:42 PM"); a live check with a table that failed is one
    // source that couldn't load, never "Live" beside an error dot.
    const frozen = freshness.state === "error" || freshness.state === "frozen";
    chip = { tone: "error", label: frozen && freshness.line ? freshness.line : "1 source couldn't load" };
  } else if (checking.length) {
    const u = money.unclaimed;
    const rewards = checking.find((x) => x.key === "rewards");
    const scanning = Boolean(rewards) && u.total > 0;
    chip = {
      tone: "checking",
      label: rewards?.retrying != null
        ? `Retrying ${plural(rewards.retrying, "Hotspot")}`
        : scanning
          ? `Checking ${fmtCount(u.checked)} of ${fmtCount(u.total)}`
          : "Checking",
    };
  } else if (mobile && mobile.kind === "live") {
    chip = { tone: "live", label: freshness.word, checkedAt: mobile.checkedAt ?? null, dotClass: freshness.dotClass };
  } else if (mobile && mobile.kind === "checking") {
    chip = { tone: "checking", label: freshness.word ?? "Checking" };
  } else chip = { tone: "ok", label: "All sources loaded" };

  return { chip, sources };
}
