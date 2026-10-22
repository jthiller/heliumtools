import { fetchSummary, fetchFleet, fetchRewards, scanOnboardDates, fetchTransactions } from "../lib/walletDashboardApi.js";
import {
  scanGatewayStatuses,
  fetchUtilizationIndex,
  fetchGatewayUtilizationDetail,
} from "../lib/iotStatusApi.js";
import { fetchWellKnownOuiNames, labelOuis, WELL_KNOWN_REPO_URL } from "../lib/wellKnownOuis.js";
import { ENTITY_KEY_SCHEMA, SOLANA_ADDRESS_SCHEMA, capListField } from "../webmcp/helpers.js";
import {
  REWARD_DECIMALS,
  IOT_MESSAGES_NOTE,
  IOT_CONNECTIVITY_NOTE,
  DEVICE_LABEL,
  UNKNOWN_DEVICE,
  deviceLabelOf,
  hasIotStatus,
  isTrafficKnown,
  iotStatusOf,
  iotActionRank,
  byMessagesDesc,
  indexForBuild,
  aggregateIotStatus,
  deriveTrafficDetail,
  onboardingStats,
  onboardedAtOf,
} from "./format.js";
import { REWARDS_BATCH_SIZE, eligibleRewardHotspots } from "./useFleetRewards.js";
import { MOBILE_ISSUE_ORDER, aggregateMobile, isMobileHotspot, mobileActionRank } from "./mobileFormat.js";
import {
  STATES,
  TIERS,
  TIER_ORDER,
  DERIVED_FILTERS,
  STATUS_FILTERS,
  iotStateData,
  needsALook,
} from "./statusRegistry.js";
import { DEFAULT_SORT, SORT_KEYS, filterRows, orderRows, parseSort, sortOption, sumRows } from "./hotspotList.js";
import { deriveFleetPlaces } from "./fleetPlaces.js";
import { mobileFreshness } from "./mobileFreshness.js";
import { dashboardSearch } from "./urlState.js";
import { checkMobileOnce } from "./mobile/mobileClient.js";
import { mobileFleetOf } from "./mobile/useMobileActivity.js";
import { FRESH_MS, windowLength } from "./mobile/tableMeta.js";
import { sleep } from "../lib/utils.js";

const ADDRESS_SCHEMA = {
  ...SOLANA_ADDRESS_SCHEMA,
  description:
    "Solana wallet address (base58). Optional when the dashboard already shows a wallet; defaults to that one.",
};

/** Cap fleet lists in tool results; the UI still shows everything. */
const FLEET_RESULT_CAP = 200;
/** Two reward batches keeps the tool bounded on maker-sized fleets. */
const REWARDS_HOTSPOT_CAP = 100;
/** Four onboard batches, matching the fleet tool's row cap. */
const ONBOARDED_HOTSPOT_CAP = FLEET_RESULT_CAP;
/** IoT status lookups when the tool scans a wallet itself (one GET each).
 * Kept equal to FLEET_RESULT_CAP so a scanned list never also hits the list
 * cap: the two `truncated` notes can't collide. */
const IOT_SCAN_HOTSPOT_CAP = FLEET_RESULT_CAP;
/** Mobile Hotspots listed by default: WiFi keys run 366 chars, so rows are
 * large. The agent can raise it to FLEET_RESULT_CAP. */
const MOBILE_LIST_DEFAULT = 50;
/** How long the tool waits for the page's first Mobile check (wallet on screen). */
const MOBILE_PAGE_WAIT_MS = 45_000;
const MOBILE_PAGE_POLL_MS = 500;
/** An off-screen check's time limit; a slower one returns what it has. */
const MOBILE_CHECK_TIMEOUT_MS = 60_000;
/** Reported positions listed per WiFi Hotspot. */
const MOBILE_POSITIONS_SHOWN = 5;
/** get-wallet-hotspots: rows listed by default, and how long it waits for
 * the page's checks (rewards, IoT, Mobile, onboard dates) to finish. */
const HOTSPOT_LIST_DEFAULT = 50;
const LIST_PAGE_WAIT_MS = 45_000;
const LIST_PAGE_POLL_MS = 500;
/** Sites (Hotspots within 1 km) listed in get-wallet-hotspots' `places`. */
const SITES_SHOWN = 10;

const NOT_ON_SCREEN =
  "this tool reads the dashboard's own Hotspot list, and this wallet isn't the one on screen: open it with open-wallet-dashboard first, then call again";

// The page's view parameters, as the URL takes them (urlState.js).
const NETWORK_SCHEMA = {
  type: "string",
  enum: ["all", "iot", "mobile"],
  description:
    "Network filter: iot or mobile (a Hotspot on both networks matches either), all for every Hotspot. The page offers it only when the wallet has Hotspots on both networks.",
};
const DEVICE_SCHEMA = {
  type: "string",
  enum: [...Object.keys(DEVICE_LABEL), UNKNOWN_DEVICE],
  description: `Device filter: ${Object.entries(DEVICE_LABEL)
    .map(([k, label]) => `${k} (${label})`)
    .join(", ")}, or ${UNKNOWN_DEVICE} (no or an unlisted device type). The page keeps it only when the wallet has that device type.`,
};
const SORT_SCHEMA = {
  type: "string",
  enum: SORT_KEYS.flatMap((k) => [k, `${k}.asc`, `${k}.desc`]),
  description:
    "Hotspot list sort: unclaimed (Unclaimed HNT; the page's default, most first), day (HNT earned on the latest UTC day, Mobile only), week (HNT over the 7 days, Mobile only), lifetime (lifetime HNT), status (needs a look first: tier, then state, then Unclaimed), name (A to Z), onboarded (newest first) or messages (30-day IoT messages). A bare key sorts most first (name: A to Z); add .asc or .desc for the other direction (status.asc: no issues first). Without a sort, a status filter sorts by status.",
};
const Q_SCHEMA = {
  type: "string",
  maxLength: 100,
  description: "Search the list: matches a Hotspot's name, entity key, asset ID, city or state (case-insensitive).",
};
const MONTH_SCHEMA = {
  type: "string",
  pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
  description:
    "Onboard month filter, YYYY-MM (UTC): Hotspots whose earliest on-chain onboard date falls in that month (a month of get-wallet-onboarding's byMonth).",
};

/** Format a base-unit BigInt as a decimal token string, trimming zeros. */
function formatBaseUnits(amount, decimals) {
  if (!decimals) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

const isoOf = (ms) => (ms ? new Date(ms).toISOString() : null);
const roundTo = (x, digits) => (x == null ? null : Number(x.toFixed(digits)));
const hnt8 = (x) => roundTo(x, 8);

/** `${key} "Label"` for the descriptions, from the status registry. */
const stateText = (key) => `${key} "${STATES[key].chip({})}"`;

/**
 * Every status filter value with its label, grouped by tier, for the
 * `status` parameter's description (generated from the registry, so it can't
 * drift from the page's chips).
 */
function statusGuide() {
  const byTier = new Map();
  for (const [key, def] of Object.entries(STATES)) {
    if (key === "checking") continue;
    if (!byTier.has(def.tier)) byTier.set(def.tier, []);
    byTier.get(def.tier).push(stateText(key));
  }
  const tiers = TIER_ORDER.filter((t) => byTier.has(t)).map((t) => `${TIERS[t].word}: ${byTier.get(t).join(", ")}`);
  return `${tiers.join(". ")}. Also needs (any Serious or Check state, the page's "need a look"), ok (no issues: the top state is OK and nothing is still being checked), mobileOk ("${DERIVED_FILTERS.mobileOk.chip({})}": WiFi Hotspots whose heartbeat, speedtest, ban and rejected-heartbeat checks all answered with no issue) and checking (still being checked).`;
}

/**
 * A row's IoT state in the status registry: the key the Hotspot list's
 * status filter, Health and get-wallet-hotspots use for it.
 */
function iotStateKey(row) {
  if (row.health) return row.health;
  if (row.status === "unknown") return row.lookupFailed ? "iotFailed" : "iotUnknown";
  if (row.status === "pending") return "checking";
  return row.status; // active, inactive, settingUp
}

/**
 * Per-Hotspot IoT rows from the dashboard's aggregate (`aggregateIotStatus`),
 * most actionable first (the same `iotActionRank` order as the list's Status
 * sort), then most messages, then name. Each carries its registry state,
 * tier and label.
 */
function iotRows(hotspots, agg) {
  return hotspots
    .map((hotspot) => ({ hotspot, row: agg.rows.get(hotspot.entityKey) }))
    .filter((e) => e.row)
    .sort(
      (a, b) =>
        iotActionRank(a.row.status, a.row.health) - iotActionRank(b.row.status, b.row.health) || byMessagesDesc(a, b),
    )
    .map(({ hotspot, row }) => {
      const state = iotStateKey(row);
      return {
        entityKey: hotspot.entityKey,
        name: hotspot.name || null,
        state,
        tier: STATES[state].tier,
        healthLabel: STATES[state].label({}, iotStateData(row)),
        status: row.status,
        health: row.health,
        messages30d: row.messages,
        ouiIds: isTrafficKnown(row.traffic) ? [...row.traffic.ouis] : null,
      };
    });
}

/**
 * Whether the page's Mobile state for its wallet is ready to read: a check
 * has finished on the page (`checked`) and, while the page is visible, its
 * data isn't stale (the next check is already running); or the worker
 * failed, or the fleet has nothing to check.
 */
function pageSettled(activity, mobile) {
  if (mobile.mobileTotal === 0 || activity.phase === "error") return true;
  return activity.checked && (activity.paused || !activity.stale);
}

// Off-screen checks by wallet: { promise, doneAt } (doneAt null while running).
const offScreenChecks = new Map();
const OFF_SCREEN_REUSE_MS = 30_000;

/**
 * One check of a wallet that isn't on screen: its fleet, then one check in a
 * worker of its own (same engine and caches as the page). Per wallet, a
 * running call is shared and a finished one is reused for 30 s after it
 * finishes; a timed-out or failed one never is. Sharing is safe because every
 * call settles: the fleet fetch and the check both have time limits.
 */
function checkWalletMobile(wallet) {
  const now = Date.now();
  for (const [w, e] of offScreenChecks) {
    if (e.doneAt != null && now - e.doneAt >= OFF_SCREEN_REUSE_MS) offScreenChecks.delete(w);
  }
  const hit = offScreenChecks.get(wallet);
  if (hit) return hit.promise;
  const entry = { promise: runWalletMobile(wallet), doneAt: null };
  offScreenChecks.set(wallet, entry);
  const drop = () => offScreenChecks.get(wallet) === entry && offScreenChecks.delete(wallet);
  entry.promise.then(({ timedOut }) => {
    if (timedOut) drop();
    else entry.doneAt = Date.now();
  }, drop);
  return entry.promise;
}

async function runWalletMobile(wallet) {
  let hotspots;
  try {
    hotspots = (await fetchFleet(wallet))?.hotspots || [];
  } catch (err) {
    // Said as what it is (the Hotspot list), not a bare network error.
    throw Object.assign(new Error(err?.message || String(err)), { fleet: true });
  }
  const fleet = mobileFleetOf(hotspots);
  if (fleet.mobileTotal === 0) return { hotspots, activity: null, timedOut: false };
  const { state, timedOut } = await checkMobileOnce(
    { wallet, keys: fleet.keys, wifi: fleet.wifiTotal > 0 },
    { timeoutMs: MOBILE_CHECK_TIMEOUT_MS },
  );
  return { hotspots, activity: state, timedOut };
}

// The Mobile health tables a row's issues come from.
const HEALTH_TABLES_WIFI = ["bans", "heartbeats", "invalidHeartbeats", "speedtests"];
const HEALTH_TABLES_DATA_ONLY = ["bans"];

/**
 * A Mobile row's status tier: its most serious issue's (banned Serious, the
 * WiFi signals Check); "ok" once every table behind its issues answered with
 * none; "unknown" when one of them failed; "checking" while one hasn't
 * answered.
 */
function mobileTier(row, agg) {
  if (row.issue) return STATES[row.issue].tier;
  const tables = row.wifi ? HEALTH_TABLES_WIFI : HEALTH_TABLES_DATA_ONLY;
  if (tables.some((t) => agg.failed?.[t])) return "unknown";
  return tables.every((t) => agg.loaded?.[t]) ? "ok" : "checking";
}

/** One Mobile Hotspot's row for the agent, from `aggregateMobile`'s row. */
function mobileRow(hotspot, row, agg) {
  const week = row.week;
  // Per-Hotspot days are known only when every loaded day is keyed per
  // Hotspot (a large fleet's saved check keeps daily totals only).
  const weekKnown = Boolean(week?.keyed) && week.daysLoaded > 0;
  const out = {
    entityKey: hotspot.entityKey,
    name: hotspot.name || null,
    wifi: row.wifi,
    tier: mobileTier(row, agg),
    issues: row.issues,
    hntLatestDay: hnt8(row.hntLatestDay),
    rewardedBytesLatestDay: row.bytesLatestDay,
    hnt7d: weekKnown ? hnt8(week.hnt) : null,
    daysWithHnt: weekKnown ? week.daysWithHnt : null,
    hntDays: (row.days7 || [])
      .slice()
      .reverse()
      .map((d) => {
        const ok = d.state === "ok";
        return { day: d.day, state: d.state, hnt: ok ? hnt8(d.hnt) : null, rewardedBytes: ok ? d.bytes : null };
      }),
    usersServed: row.users,
    banned: row.banned,
  };
  if (row.ban) out.ban = { reason: row.ban.reason, message: row.ban.message, at: isoOf(row.ban.at) };
  if (!row.wifi) return out;
  const st = row.speedtest;
  return {
    ...out,
    heartbeats60m: row.heartbeats,
    lastHeartbeatAt: isoOf(row.lastHeartbeatAt),
    locationTrust: row.trust,
    distanceFromAssertedM: row.distance,
    locationSource: row.locationSource,
    assertedCell: row.assertedCell,
    reportedPositions:
      row.heartbeats == null
        ? null
        : row.points.slice(0, MOBILE_POSITIONS_SHOWN).map((p) => ({
            lat: p.lat,
            lon: p.lon,
            heartbeats: p.n,
            lastAt: isoOf(p.lastAt),
            distanceFromAssertedM: p.distance,
          })),
    rejectedHeartbeats60m: row.rejectedHeartbeats,
    ...(row.rejectedReasons ? { rejectedReasons: row.rejectedReasons } : {}),
    speedtest24h: st
      ? {
          downloadBps: st.down,
          uploadBps: st.up,
          latencyMs: st.latency,
          multiplier: st.multiplier,
          samples: st.samples,
          at: isoOf(st.at),
        }
      : null,
  };
}

const TABLE_NOTE_LABEL = {
  rewards: "Data-transfer HNT",
  usage: "Usage",
  bans: "Ban status",
  heartbeats: "Heartbeats",
  invalidHeartbeats: "Rejected heartbeats",
  speedtests: "Speedtest averages",
};

// Each sliding section's window, from `aggregateMobile`'s `windows`: its
// length, its end, and whether it still ends at about now (the UI's "in the
// last 60 min"). One that doesn't is frozen at its table's last successful
// check (a failed or overdue check, a hidden tab, a saved check) and is named
// by its end. `current` is null while the section isn't loaded.
function windowsOf(agg) {
  return Object.fromEntries(
    Object.entries(agg.windows).map(([s, w]) => [
      s,
      { ...windowLength(s), end: isoOf(w.until), current: w.until == null ? null : w.current },
    ]),
  );
}

// "the last 60 minutes", or "the 60 minutes ending 2026-10-14T15:42:00.000Z".
function windowPhrase(w) {
  const length = w.minutes ? `${w.minutes} minutes` : `${w.hours} hours`;
  return w.current === false ? `the ${length} ending ${w.end}` : `the last ${length}`;
}

/**
 * The page's Mobile data status (`mobileFreshness`, the same derivation as
 * its Data status chip and Health's Mobile chip), for the agent: its state
 * and times as ISO. null without Mobile Hotspots.
 */
function freshnessOut(activity, agg) {
  const f = mobileFreshness(activity, agg);
  if (f.state === "none") return null;
  return {
    state: f.state,
    checkedAt: isoOf(f.checkedAt),
    ...(f.dataAt ? { dataFrom: isoOf(f.dataAt) } : {}),
    ...(f.savedAt ? { savedCheckFrom: isoOf(f.savedAt) } : {}),
    ...(f.failedTables.length ? { failedTables: f.failedTables } : {}),
  };
}

const FRESHNESS_NOTE =
  "freshness is the dashboard's Mobile data status: live (a check finished in the last few minutes), updating (a newer check is running), paused (the tab is hidden, so it isn't checking), saved (figures from this browser's saved check while the first check runs), frozen (a table's latest check failed or a window is overdue: dataFrom is when its figures are from) or error (the check failed: figures are from before).";

/**
 * The agent's view of a wallet's Mobile activity: fleet-wide figures, issue
 * counts over every Mobile Hotspot, and per-Hotspot rows most actionable
 * first (mobileActionRank, the list's Status order, then latest-day HNT,
 * then name), filtered by `issue` and capped at `limit`. A count whose data
 * isn't in is null, never 0. `hiddenAt`: the last check of a hidden dashboard
 * tab this fresh check stands in for.
 */
function mobileActivityResult({ wallet, hotspots, activity, agg, page, timedOut, hiddenAt, issue, limit }) {
  const notes = [];
  // Mobile rows with ecc_compact keys (CBRS radios) never appear in the data.
  const uncovered = (hotspots || []).filter((h) => (h.networks || []).includes("mobile") && !isMobileHotspot(h)).length;
  const uncoveredNote = uncovered
    ? `${uncovered === 1 ? "1 Mobile Hotspot has" : `${uncovered} Mobile Hotspots have`} an ecc_compact key (starting 11, e.g. a CBRS radio) and ${uncovered === 1 ? "isn't" : "aren't"} covered: only WiFi Hotspots appear in this data.`
    : null;
  if (agg.mobileTotal === 0) {
    return {
      wallet,
      mobileHotspots: 0,
      hotspots: [],
      notes: [uncoveredNote ?? "This wallet has no Mobile Hotspots."],
    };
  }

  // Each table's state with when it was last checked (ok or not) and last
  // succeeded, so the agent can tell how old each section is.
  const tables = Object.fromEntries(
    Object.entries(activity?.tables || {}).map(([name, t]) => [
      name,
      {
        state: t.state,
        ...(t.checkedAt ? { checkedAt: isoOf(t.checkedAt) } : {}),
        ...(t.okAt ? { okAt: isoOf(t.okAt) } : {}),
        ...(t.error ? { error: t.error } : {}),
      },
    ]),
  );
  const rows = (hotspots || [])
    .map((hotspot) => ({ hotspot, row: agg.rows.get(hotspot.entityKey) }))
    .filter((e) => e.row && (!issue || e.row.issues.includes(issue)))
    .sort(
      (a, b) =>
        mobileActionRank(a.row) - mobileActionRank(b.row) ||
        (b.row.hntLatestDay ?? -1) - (a.row.hntLatestDay ?? -1) ||
        (a.hotspot.name || "").localeCompare(b.hotspot.name || ""),
    )
    .map(({ hotspot, row }) => mobileRow(hotspot, row, agg));

  const r = agg.rewards;
  const latest = r?.latest?.state === "ok" ? r.latest : null;
  const rewards = r && {
    latestDay: latest?.day ?? null,
    latestDayHnt: latest ? hnt8(latest.hnt) : null,
    latestDayUsd: roundTo(r.latestUsd, 2),
    latestDayRewardedBytes: latest ? latest.bytes : null,
    hotspotsRewardedLatestDay: latest?.hotspots ?? null,
    hntOverLoadedDays: hnt8(r.weekHnt),
    daysLoaded: r.daysLoaded,
    days: r.days.map((d) => {
      const ok = d.state === "ok";
      return {
        day: d.day,
        state: d.state,
        hnt: ok ? hnt8(d.hnt) : null,
        rewardedBytes: ok ? d.bytes : null,
        hntPriceUsd: d.priceUsd,
        hotspotsRewarded: ok ? d.hotspots : null,
      };
    }),
  };
  const u = agg.usage;
  const usage = u && {
    day: u.day,
    usersServedSummedAcrossHotspots: u.hotspots ? u.users : null,
    hotspotsReported: u.hotspots,
    ...(u.coverage ? { rewardedHotspots: u.coverage.rewarded, rewardedHotspotsReported: u.coverage.reported } : {}),
  };

  // A count is null while the table behind it isn't in (still loading, or
  // failed with nothing to show); a WiFi issue is a real 0 without WiFi
  // Hotspots (`agg.known`).
  const { counts, loaded, known } = agg;
  const wifi = agg.wifiTotal > 0;
  const windows = wifi ? windowsOf(agg) : null;
  const freshness = page ? freshnessOut(activity, agg) : null;

  if (windows) {
    const { heartbeats: hb, invalidHeartbeats: inv, speedtests: st } = windows;
    notes.push(
      `Windows: heartbeats60m, lastHeartbeatAt, locationTrust and reportedPositions cover ${windowPhrase(hb)} by received time (a heartbeat in that window, not online now); rejectedHeartbeats60m covers ${windowPhrase(inv)}; speedtest24h is the latest average in ${windowPhrase(st)}.`,
    );
    if (Object.values(windows).some((w) => w.current === false)) {
      notes.push(
        "A window with current: false ended at its end time, its table's last successful check (a later check failed or is overdue, the dashboard tab is hidden, or it's a saved check): its counts describe that window, not the present.",
      );
    }
  }
  notes.push(
    "HNT is data-transfer rewards per UTC day (rewards.days and each Hotspot's hntDays, newest first; latestDay is the newest day published), paid per rewarded byte: rewardedBytes are the bytes that day's HNT paid for. hnt7d and daysWithHnt are over the days loaded (rewards.daysLoaded), and null while only the daily totals are known (a large fleet's saved check). usage covers one UTC day (usage.day), which can differ from latestDay.",
    "Heartbeats, location trust and the speedtest multiplier don't change data-transfer HNT: they are WiFi health signals, sent only by WiFi indoor/outdoor Hotspots (wifi: true). banned is the most serious issue.",
    `tier is the dashboard's status tier of a Hotspot's most serious issue (banned Serious; noHeartbeat, lowTrust, lowSpeedtest and rejectedHeartbeats Check, which the page counts as "need a look"), ok when every check behind them answered with none, checking while one hasn't, unknown when one failed. "No rewarded data (7 days)" (Check: no rewarded data on any of the 7 days, though the Hotspot earned before) combines these days with lifetime rewards, so it's in get-wallet-hotspots.`,
    "usage.usersServedSummedAcrossHotspots adds up each Hotspot's usersServed, so a user served by two Hotspots counts twice; each Hotspot's usersServed is its own count for usage.day, and with usage loaded a null one means that day's report has no row for it (not reported, not zero).",
    "A null field or count means its data hasn't loaded or couldn't be checked (see tables), never zero. With its data in, a null speedtest24h means no average in its window, and a null lastHeartbeatAt no heartbeat in its window.",
  );
  if (freshness) notes.push(FRESHNESS_NOTE);
  if (u?.coverage && u.coverage.reported < u.coverage.rewarded) {
    notes.push(
      `usage.day's report covers ${u.coverage.reported} of the ${u.coverage.rewarded} Hotspots rewarded that day, so usersServedSummedAcrossHotspots leaves the others out.`,
    );
  }
  if (rewards?.days.some((d) => d.state === "missing")) {
    notes.push("A rewards day with state missing has no published data (not zero).");
  }
  if (rewards?.days.some((d) => d.state === "failed")) {
    notes.push("A rewards day with state failed couldn't be read in the latest check (unknown, not zero).");
  }
  // Worded by what the section actually holds: nothing, the dashboard's saved
  // check, or this table's last successful check. A saved sliding section is
  // dated by its own window end (a failed table's copy can predate the rest).
  const saved = new Set(activity?.cachedSections || []);
  const savedAt = (name) => isoOf(activity.tables?.[name]?.until ?? activity.cachedAt);
  for (const [name, t] of Object.entries(activity?.tables || {})) {
    if (t.state === "ok") continue;
    const label = TABLE_NOTE_LABEL[name] || name;
    const why = t.state === "error" ? `latest check failed (${t.error || "error"})` : "check is still running";
    if (activity[name] == null) notes.push(`${label}: ${why}; those fields and counts are null.`);
    else if (saved.has(name)) notes.push(`${label}: ${why}; its fields are the dashboard's saved check from ${savedAt(name)}.`);
    else {
      notes.push(
        `${label}: ${why}; ${t.okAt ? `its fields are from its last successful check at ${isoOf(t.okAt)}` : "its fields are partial"}.`,
      );
    }
  }
  const notReplaced = new Map(); // saved check time → labels
  for (const name of saved) {
    const state = activity.tables?.[name]?.state;
    if (state === "error" || state === "loading") continue;
    const at = savedAt(name);
    notReplaced.set(at, [...(notReplaced.get(at) || []), TABLE_NOTE_LABEL[name] || name]);
  }
  if (notReplaced.size) {
    const parts = [...notReplaced].map(([at, labels]) => `${labels.join(", ")} (${at})`);
    notes.push(`From the dashboard's saved check, not yet replaced by its live check: ${parts.join("; ")}.`);
  }
  if (page) {
    if (!page.settled) notes.push("The dashboard's first check hadn't finished; call again shortly for the rest.");
    if (activity.phase === "error") {
      const kept = Object.keys(TABLE_NOTE_LABEL).some((name) => activity[name] != null);
      notes.push(
        kept
          ? "The dashboard's latest check failed (see tables); data here is what it had before."
          : "The dashboard's Mobile check failed (see tables) and it has no Mobile data for this wallet yet.",
      );
    }
    if (activity.paused && activity.phase !== "error") {
      notes.push(`The dashboard tab is hidden, so it isn't checking; its last check was at ${isoOf(activity.checkedAt)}.`);
    }
  } else {
    if (hiddenAt) {
      notes.push(
        `The dashboard tab showing this wallet is hidden and last checked at ${isoOf(hiddenAt)}, so this is a fresh check of its own.`,
      );
    }
    if (timedOut) {
      notes.push(
        `The check didn't finish within ${MOBILE_CHECK_TIMEOUT_MS / 1000} s. Downloaded files stay cached, so calling again continues from there.`,
      );
    }
  }
  if (issue) notes.push(`hotspots lists only Hotspots with issue ${issue}; counts cover every Mobile Hotspot.`);
  if (uncoveredNote) notes.push(uncoveredNote);

  return capListField(
    {
      wallet,
      source: page ? "dashboard" : "check",
      mobileHotspots: agg.mobileTotal,
      wifiHotspots: agg.wifiTotal,
      checkedAt: isoOf(activity?.checkedAt),
      ...(freshness ? { freshness } : {}),
      tables,
      ...(saved.size ? { savedCheck: { sections: [...saved], checkedAt: isoOf(activity.cachedAt) } } : {}),
      ...(windows ? { windows } : {}),
      rewards,
      usage,
      counts: {
        withIssues: MOBILE_ISSUE_ORDER.every((k) => known[k]) ? counts.withIssues : null,
        ...Object.fromEntries(MOBILE_ISSUE_ORDER.map((k) => [k, known[k] ? counts[k] : null])),
        ...(wifi ? { heartbeatIn60m: loaded.heartbeats ? counts.heartbeating : null } : {}),
      },
      hotspots: rows,
      notes,
    },
    "hotspots",
    limit,
  );
}

// ── get-wallet-hotspots: the page's unified list ────────────────────────────

/** One shown state, for the agent: its key, tier, label and window. */
function stateOut(s) {
  return {
    key: s.key,
    tier: s.tier,
    label: s.label,
    window: s.window,
    ...(s.window2 ? { detail: s.window2 } : {}),
    ...(s.at ? { at: isoOf(s.at) } : {}),
  };
}

/** UI token amounts, listed only when one is above zero. */
const legacyOut = (legacy) => (legacy && (legacy.iot > 0 || legacy.mobile > 0) ? { iot: legacy.iot, mobile: legacy.mobile } : null);

/** One `aggregateHotspotList` row for the agent (null = not known, never 0). */
function hotspotRowOut(r) {
  const u = r.unclaimed;
  const life = r.lifetime;
  const week = r.week;
  const legacyUnclaimed = legacyOut(u.legacy);
  const legacyLifetime = legacyOut(life.legacy);
  return {
    name: r.name,
    entityKey: r.key,
    assetId: r.assetId,
    networks: r.hotspot.networks || [],
    deviceType: r.device,
    deviceLabel: r.deviceLabel,
    place: r.place.full,
    tier: r.tier,
    needsALook: r.needs,
    ...(r.checking ? { checking: true } : {}),
    states: r.states.map(stateOut),
    verdicts: [...r.verdicts],
    ...(r.netLine ? { note: r.netLine } : {}),
    unclaimedHnt: u.state === "ok" ? hnt8(u.hnt) : null,
    rewardsState: u.state === "loading" ? "checking" : u.state,
    claimable: u.state === "ok" ? u.claimable : null,
    claimReason: u.reason,
    ...(u.destination ? { claimDestination: u.destination } : {}),
    lifetimeHnt: life.state === "ok" ? hnt8(life.hnt) : null,
    lifetimeLowerBound: life.lowerBound,
    neverRewarded: life.never,
    ...(legacyUnclaimed ? { legacyUnclaimed } : {}),
    ...(legacyLifetime ? { legacyLifetime } : {}),
    // Daily HNT only for Hotspots in the Mobile data (noDailyHnt says why not).
    ...(r.noDaily
      ? { noDailyHnt: r.noDaily }
      : {
          latestDayHnt: r.day.state === "ok" ? hnt8(r.day.hnt) : null,
          hnt7d: week.hnt != null ? hnt8(week.hnt) : null,
          daysWithHnt: week.state === "ok" || week.state === "partial" ? week.daysWithHnt : null,
          ...(week.state === "partial" ? { hntDaysLoaded: week.daysLoaded } : {}),
        }),
    // Messages only for IoT Hotspots.
    ...(r.messages.state === "na"
      ? {}
      : {
          messages30d: r.messages.state === "ok" ? r.messages.count : null,
          ...(r.messages.state === "unavailable" || r.messages.state === "unpublished" ? { messagesState: r.messages.state } : {}),
        }),
    onboardedAt: r.onboarded.at ?? null,
  };
}

/**
 * HNT totals over a set of rows (`sumRows`), rounded for the agent. A total
 * none of whose Hotspots' figures is known yet is null (never 0), and each
 * says how many Hotspots it sums (`…Known`); lifetime is a lower bound while
 * any Hotspot's lifetime isn't known.
 */
function totalsOut(t) {
  const sum = (known, v) => (t.count === 0 ? v : known > 0 ? v : null);
  return {
    hotspots: t.count,
    unclaimedHnt: sum(t.unclaimedKnown, hnt8(t.unclaimedHnt)),
    unclaimedKnown: t.unclaimedKnown,
    ...(t.unconfirmed ? { unclaimedUnconfirmed: t.unconfirmed } : {}),
    ...(t.rewardsFailed ? { rewardsFailed: t.rewardsFailed } : {}),
    latestDayHnt: sum(t.dayKnown, hnt8(t.latestDayHnt)),
    latestDayKnown: t.dayKnown,
    weekHnt: sum(t.weekKnown, hnt8(t.weekHnt)),
    weekKnown: t.weekKnown,
    lifetimeHnt: sum(t.rewardsChecked, hnt8(t.lifetimeHnt)),
    lifetimeKnown: t.rewardsChecked,
    lifetimeLowerBound: t.lifetimeLowerBound || (t.rewardsChecked > 0 && t.rewardsChecked < t.count),
    messages30d: sum(t.messagesKnown, t.messages30d),
    messagesKnown: t.messagesKnown,
  };
}

/**
 * Where each verdict source stands: still checking, being re-checked (the
 * page's Retry re-checks only what failed; its rows read checking while the
 * rest stay settled), or done, with what failed (what Retry would re-check).
 */
function checksOut(list, freshness, paused, onboard = {}) {
  const { settled, rows } = list;
  let rewardsChecking = 0;
  let iotChecking = 0;
  for (const r of rows) {
    if (r.unclaimed.state === "loading") rewardsChecking++;
    if (r.iot?.status === "pending") iotChecking++;
  }
  const by = list.counts.byState;
  const stateOf = (done, checking) => (!done ? "checking" : checking > 0 ? "retrying" : "done");
  return {
    rewards: {
      state: stateOf(settled.rewards, rewardsChecking),
      ...(rewardsChecking ? { checking: rewardsChecking } : {}),
      failed: list.totals.rewardsFailed,
      unconfirmed: list.totals.unconfirmed,
    },
    iot:
      list.counts.iot > 0
        ? {
            state: stateOf(settled.iot, iotChecking),
            ...(iotChecking ? { checking: iotChecking } : {}),
            failed: by.iotFailed ?? 0,
            notFound: by.iotUnknown ?? 0,
          }
        : null,
    mobile:
      list.counts.mobileTables > 0
        ? {
            state: settled.mobile ? "done" : paused ? "paused" : "checking",
            ...(by.mobileFailed ? { failed: by.mobileFailed } : {}),
            ...(freshness ? { freshness } : {}),
          }
        : null,
    onboardDates: {
      state: !settled.onboard ? "checking" : onboard.retrying ? "retrying" : "done",
      ...(onboard.failed ? { failed: onboard.failed } : {}),
    },
  };
}

/** The windows the list's states cover, with ISO ends (the labels name local times). */
function listWindowsOut(list, mobileAgg) {
  const ctx = list.ctx;
  const out = {};
  if (list.counts.iot > 0) out.iot = { connectivityDay: ctx.iotDay, trafficThrough: ctx.trafficThrough };
  if (list.counts.mobileTables > 0) {
    out.rewards = {
      firstDay: ctx.rewardsFirstDay,
      latestDay: ctx.rewardsDay,
      latestDayState: mobileAgg?.rewards?.latest?.state ?? (mobileAgg?.failed?.rewards ? "failed" : "loading"),
    };
    if (list.counts.wifi > 0) Object.assign(out, windowsOf({ windows: ctx.windows || {} }));
  }
  return out;
}

/** The fleet's places (`deriveFleetPlaces`, the page's caption and sites). */
function placesOut(rows) {
  const places = deriveFleetPlaces(rows.map((r) => r.hotspot));
  if (!places) return null;
  return {
    caption: places.caption(),
    sites: places.sites.length,
    region: places.region,
    unasserted: places.unasserted,
    largestSites: places.sites.slice(0, SITES_SHOWN).map((s) => ({
      label: s.label,
      hotspots: s.count,
      lat: roundTo(s.lat, 5),
      lng: roundTo(s.lng, 5),
    })),
  };
}

const LIST_NOTES = [
  'Tiers, most severe first: serious, check, quiet, info, unknown, ok, checking. needsALook (per Hotspot, and counts.needsALook) means any Serious or Check state, the page\'s "need a look"; counts.needsALook stays null until the rewards, IoT and Mobile checks are in (settled.verdicts).',
  "states are what a Hotspot's row shows, most severe first: an OK state only when nothing else applies, and checking while a source is still being checked and nothing Serious or Check is known yet. verdicts lists every state that applies, OK ones included; the status filter and counts.byState match on verdicts.",
  "Each state's window says what it covers. IoT states are per UTC data day (connectivity on windows.iot.connectivityDay, not online now; messages over the 30 days to windows.iot.trafficThrough). noRewardedData and rewardedDays cover the 7 UTC days in windows.rewards. Heartbeat and speedtest states cover windows.heartbeats, windows.invalidHeartbeats and windows.speedtests; one with current: false ended at its end time (the latest Mobile check couldn't update it), and the state labels name that end in this browser's local time.",
  "HNT: unclaimedHnt is HNT earned and not yet claimed (per Hotspot, from a cache of about 15 minutes, so it can lag a claim). latestDayHnt, hnt7d and daysWithHnt are HNT from Mobile data transfer per UTC day (windows.rewards), listed for Hotspots in the Mobile data; IoT, CBRS and no-network Hotspots have noDailyHnt (iot, cbrs or none) instead. messages30d is listed for IoT Hotspots only. lifetimeHnt is all HNT earned, a lower bound when lifetimeLowerBound (unclaimed couldn't be confirmed: rewardsState unconfirmed). IOT and MOBILE are legacy tokens, listed only when above zero.",
  "A null figure isn't known: still checking, or couldn't be checked (rewardsState, messagesState, checks). It is never 0.",
  "totals cover this wallet's Hotspots only; the page's Unclaimed at the top also adds veHNT rewards. Each total sums the Hotspots whose figure is known (unclaimedKnown, latestDayKnown, weekKnown, lifetimeKnown, messagesKnown) and is null when none is; lifetimeLowerBound is true while any Hotspot's lifetime isn't known.",
  "Order: the page's sort. Hotspots with the sorted figure come first, then labelled groups (groups) of Hotspots without it, each by Lifetime. These rows are in the order computed now. The page never moves rows while the viewer reads: when the figures change the order it says \"Order is out of date\" and keeps its rows where they were until the viewer presses Sort now or changes a filter, the search or the sort, so the page can show an older order until then.",
];

/**
 * WebMCP tools for /wallet-dashboard. The URL is the page's source of
 * truth, so open-wallet-dashboard just navigates (filters, sort and the open
 * Hotspot are query parameters) and the page does the rest; the get-* tools
 * return data directly from the same worker endpoints the UI uses
 * (KV-cached server-side), the IoT tools from api-iot.heliumtools.org through
 * the page's own cached clients, and get-wallet-hotspots the page's own
 * unified list.
 *
 * Live getters, so tools registered once stay correct across navigation:
 *   getWallet()      the wallet currently shown, or null
 *   getIotState()    that wallet's IoT scan `{ wallet, hotspots, iotStatus,
 *                    done }` (`iotStatus` the page's `aggregateIotStatus`), or null
 *   getMobileState() its Mobile activity `{ wallet, hotspots, activity, mobile }`
 *                    (`activity` the `useMobileActivity` contract, `mobile` the
 *                    page's `aggregateMobile`), `{ wallet, fleetError }` when
 *                    that wallet's fleet failed to load, or null
 *   getListState()   its unified list `{ wallet, list, settled }` (`list` the
 *                    page's `aggregateHotspotList`), or null until its fleet loads
 */
export function makeWalletDashboardTools(navigate, getWallet, getIotState, getMobileState, getListState) {
  // The explicit address argument, or the wallet the page is showing.
  const requireWallet = (address) => {
    const wallet = address || getWallet();
    if (!wallet) throw new Error("no wallet given and none loaded in the dashboard; pass `address`");
    return wallet;
  };

  // The page's list for `wallet` when it is on screen with its fleet loaded.
  const listFor = (wallet) => {
    if (getWallet() !== wallet) return null;
    const st = getListState?.();
    return st?.wallet === wallet ? st : null;
  };

  // The page's Mobile state for `wallet` once it's ready (pageSettled), or
  // when the wait runs out whatever the page has (`settled: false`). null if
  // the wallet isn't on screen or stops being, or at once if the page's fleet
  // failed to load: the tool then checks on its own (retrying the fleet).
  async function pageMobileState(wallet) {
    const deadline = Date.now() + MOBILE_PAGE_WAIT_MS;
    for (;;) {
      if (getWallet() !== wallet) return null;
      const page = getMobileState?.();
      const ours = page?.wallet === wallet ? page : null;
      if (ours?.fleetError) return null;
      const settled = ours ? pageSettled(ours.activity, ours.mobile) : false;
      if (settled || Date.now() >= deadline) return ours && { ...ours, settled };
      await sleep(MOBILE_PAGE_POLL_MS);
    }
  }

  // The page's list for `wallet` once every check is in (and no Retry is
  // re-checking rows), or when the wait runs out whatever it has. Returns at
  // once when only a paused (hidden-tab) Mobile check is left. Throws when
  // the wallet isn't on screen, its fleet failed, or its list never loaded.
  async function pageListState(wallet) {
    if (getWallet() !== wallet) throw new Error(NOT_ON_SCREEN);
    const deadline = Date.now() + LIST_PAGE_WAIT_MS;
    for (;;) {
      if (getWallet() !== wallet) {
        throw new Error("the dashboard moved to another wallet while this ran; open this one again with open-wallet-dashboard");
      }
      const mobile = getMobileState?.();
      if (mobile?.wallet === wallet && mobile.fleetError) {
        throw new Error(
          `the dashboard couldn't load this wallet's Hotspot list (${mobile.fleetError}); the page offers Retry, and get-wallet-fleet reads the list directly`,
        );
      }
      const ours = listFor(wallet);
      const activity = mobile?.wallet === wallet ? mobile.activity : null;
      const paused = Boolean(activity?.paused && !activity.checked);
      if (ours) {
        const s = ours.settled;
        const busy = ours.list.rows.some((r) => r.checking);
        if (s.all && !busy) return { ...ours, activity, paused };
        if (paused && s.rewards && s.iot && s.onboard && !s.mobile) return { ...ours, activity, paused };
      }
      if (Date.now() >= deadline) {
        if (!ours) throw new Error("the dashboard is still loading this wallet's Hotspot list; call again shortly");
        return { ...ours, activity, paused };
      }
      await sleep(LIST_PAGE_POLL_MS);
    }
  }

  const STATUS_GUIDE = statusGuide();
  const STATUS_SCHEMA = {
    type: "string",
    enum: STATUS_FILTERS,
    description: `Status filter, the page's status chips; a state matches every Hotspot it applies to. ${STATUS_GUIDE}`,
  };

  return [
    {
      name: "open-wallet-dashboard",
      title: "Open a wallet in the dashboard",
      description:
        "Show a wallet in the dashboard for the user, optionally with its Hotspot list filtered and sorted and one Hotspot open in its detail view. The page loads Summary (wallet value, unclaimed HNT, HNT earned on the latest UTC day, lifetime HNT, how many Hotspots need a look), Earnings (HNT per UTC day from Mobile data transfer), one Hotspot list of IoT and Mobile Hotspots with status tiers, filters and a per-Hotspot detail, Health (IoT connectivity and traffic, Mobile WiFi health and bans), a map by site, Wallet (token balances, veHNT positions, recent activity) and About (fleet facts). Filters, sort and the open Hotspot are part of the page URL, so the user sees exactly the view opened; an opened Hotspot's detail comes into view with keyboard focus, as when the user opens one. A status without a sort also sorts by Status (needs a look first), as every status link on the page does. Like any view, the wallet is added to this browser's Recent wallets on the dashboard's lookup screen. Read the same list with get-wallet-hotspots (it takes the same filter and sort values) and the rest with the other get-* tools.",
      inputSchema: {
        type: "object",
        properties: {
          address: { ...SOLANA_ADDRESS_SCHEMA, description: "Solana wallet address (base58) to display." },
          hotspot: {
            ...ENTITY_KEY_SCHEMA,
            description:
              "Asset ID of one Hotspot in this wallet to open in the detail view (assetId from get-wallet-hotspots or get-wallet-fleet; only for a Hotspot without an asset ID, its entityKey). A Hotspot that isn't in this wallet is dropped by the page once its list loads.",
          },
          status: STATUS_SCHEMA,
          network: NETWORK_SCHEMA,
          device: DEVICE_SCHEMA,
          sort: SORT_SCHEMA,
          q: Q_SCHEMA,
          month: MONTH_SCHEMA,
        },
        required: ["address"],
        additionalProperties: false,
      },
      validate({ address, hotspot }) {
        // Checkable only for the wallet on screen with its list loaded.
        const st = hotspot ? listFor(address) : null;
        if (st && !st.list.byParam.has(hotspot) && !st.list.byKey.has(hotspot)) {
          return `Hotspot ${hotspot} isn't in this wallet's Hotspot list (${st.list.counts.total} Hotspots); get-wallet-hotspots lists their asset IDs`;
        }
        return null;
      },
      execute({ address, hotspot, status, network, device, sort, q, month }) {
        const st = listFor(address);
        const list = st?.list ?? null;
        // An entity key of a Hotspot with an asset ID opens it by its asset ID.
        const row = hotspot && list ? (list.byParam.get(hotspot) ?? list.byKey.get(hotspot)) : null;
        const param = row ? row.param : hotspot;
        const view = {
          q: q?.trim() || null,
          net: network,
          status,
          device,
          // A status filter without a sort sorts by status (as the page's status links do).
          sort: sort ?? (status && status !== "all" ? "status" : undefined),
          month,
        };
        // The page ignores a network filter unless the wallet has Hotspots on
        // both networks, and a device type the wallet doesn't have. Known once
        // its list is loaded; then they stay out of the URL too.
        const ignored = [];
        const shownView = { ...view };
        if (list && network && network !== "all" && !(list.counts.iot > 0 && list.counts.mobile > 0)) {
          ignored.push("The page ignores the network filter: this wallet doesn't have Hotspots on both networks.");
          shownView.net = null;
        }
        if (list && device && device !== "all" && !list.counts.devices[device]) {
          ignored.push(`The page ignores the device filter: this wallet has no ${device} Hotspots.`);
          shownView.device = null;
        }

        const onScreen = getWallet() === address;
        const path = `/wallet-dashboard/${address}`;
        const listUrl = `${path}${dashboardSearch(shownView)}`;
        const here = `${window.location.pathname}${window.location.search}`;
        if (param && onScreen) {
          // The wallet is on screen: the list view first, then the detail
          // over it (Back closes the detail, as for a row opened on the page).
          if (here !== listUrl) navigate(listUrl);
          navigate(`${path}${dashboardSearch({ ...shownView, hotspot: param })}`, { state: { wdDetail: true } });
        } else if (param) {
          // Another wallet: once its fleet loads, the page puts the list view
          // below a deep-linked detail itself.
          navigate(`${path}${dashboardSearch({ ...shownView, hotspot: param })}`);
        } else if (here !== listUrl) {
          navigate(listUrl);
        }

        const parsedSort = view.sort ? parseSort(view.sort) : null;
        const narrowed = filterRows(list ?? { rows: [], ctx: {} }, shownView);
        const parts = [`Opened wallet ${address} in the dashboard.`];
        if (narrowed.label) {
          if (list) parts.push(`The Hotspot list shows ${narrowed.count} of ${list.counts.total} Hotspots: ${narrowed.label}.`);
          else {
            // Not loaded yet: what the page keeps depends on the wallet's Hotspots.
            const ifs = [];
            if (network && network !== "all") ifs.push("the network filter only if the wallet has Hotspots on both networks");
            if (device && device !== "all") ifs.push(`the device filter only if the wallet has ${deviceLabelOf(device)} Hotspots`);
            parts.push(
              `The Hotspot list opens with ${narrowed.label}${ifs.length ? `; once it loads, the page keeps ${ifs.join(" and ")}` : ""}.`,
            );
          }
        }
        parts.push(
          parsedSort
            ? `Sorted ${sortOption(parsedSort).label(list?.ctx ?? {})}.`
            : onScreen
              ? `Sorted ${sortOption(DEFAULT_SORT).label({})}, the page's default.`
              : `Sorted ${sortOption(DEFAULT_SORT).label({})}, the page's default, unless this browser remembers another sort for this wallet.`,
        );
        if (param) {
          parts.push(
            row
              ? `${row.name || "Hotspot"} (${param}) is open in the detail view.`
              : `Hotspot ${param} opens in the detail view if it is in this wallet; the page drops it once the list loads if it isn't.`,
          );
        }
        parts.push(...ignored);
        parts.push("Figures fill in over a few seconds; get-wallet-hotspots reads the list once they're in.");
        return parts.join(" ");
      },
    },
    {
      name: "get-wallet-hotspots",
      title: "Get the wallet's Hotspot list",
      description: `Read the dashboard's own Hotspot list for the wallet on screen: one row per Hotspot, IoT and Mobile together (a Hotspot on both networks is one row), with the states and status tiers the page shows (Serious, Check, Quiet, Info, Unknown, OK; "need a look" = any Serious or Check state), unclaimed and lifetime HNT, HNT earned per UTC day from Mobile data transfer (latest day and 7 days), 30-day IoT messages and the on-chain onboard date. Also returns counts per state and tier, HNT totals, the windows each state covers, where the Hotspots are (the page's sites: Hotspots within 1 km), and which checks are still running, being re-checked or failed (checks; the page's Retry re-checks only what failed). Filters and sort are the page's, with the same values as open-wallet-dashboard (a status without a sort sorts by Status), so rows come back in the page's list order. Only for the wallet on screen: open it with open-wallet-dashboard first (this tool never loads a wallet). Waits up to ${LIST_PAGE_WAIT_MS / 1000} s for the page's checks to finish, then returns what it has, with settled flags. Lists ${HOTSPOT_LIST_DEFAULT} Hotspots by default (limit up to ${FLEET_RESULT_CAP}); counts and totals cover the whole fleet. A row runs about 1 KB (a Mobile WiFi Hotspot's entityKey alone is 366 characters), so ${FLEET_RESULT_CAP} rows are about 210 KB: narrow with the filters when only some Hotspots matter.`,
      inputSchema: {
        type: "object",
        properties: {
          address: ADDRESS_SCHEMA,
          status: STATUS_SCHEMA,
          network: NETWORK_SCHEMA,
          device: DEVICE_SCHEMA,
          q: Q_SCHEMA,
          month: MONTH_SCHEMA,
          sort: SORT_SCHEMA,
          limit: {
            type: "integer",
            minimum: 1,
            maximum: FLEET_RESULT_CAP,
            default: HOTSPOT_LIST_DEFAULT,
            description: "Max Hotspots listed, in list order.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      validate({ address }) {
        if (!address && !getWallet()) return "no wallet given and none loaded in the dashboard; open one with open-wallet-dashboard";
        return null;
      },
      async execute({ address, status, network, device, q, month, sort, limit }) {
        const wallet = requireWallet(address);
        const { list, settled, activity, paused, onboardFailed, onboardRetrying } = await pageListState(wallet);
        const mobilePage = getMobileState?.();
        const mobileAgg = mobilePage?.wallet === wallet ? mobilePage.mobile : null;
        const freshness = activity && mobileAgg ? freshnessOut(activity, mobileAgg) : null;

        const view = { q, net: network, device, status, month };
        const sortValue = sort ?? (status && status !== "all" ? "status" : null);
        const applied = (sortValue && parseSort(sortValue)) || DEFAULT_SORT;
        const filtered = filterRows(list, view);
        const ordered = orderRows(filtered.rows, applied);
        const shownKeys = ordered.keys.slice(0, limit);

        const c = list.counts;
        const notes = [...LIST_NOTES];
        if (!settled.all) {
          notes.push(
            `Not every check was in when this returned (settled): ${[
              !settled.rewards && "rewards",
              !settled.iot && "IoT status",
              !settled.mobile && "Mobile activity",
              !settled.onboard && "onboard dates",
            ]
              .filter(Boolean)
              .join(", ")}. Those figures are null and those rows read checking; call again shortly.`,
          );
        }
        if (paused) notes.push("The dashboard tab is hidden, so its Mobile check is paused until it's shown again.");
        const checks = checksOut(list, freshness, paused, { failed: onboardFailed, retrying: onboardRetrying });
        if (checks.rewards.state === "retrying" || checks.iot?.state === "retrying") {
          notes.push("The page is re-checking what failed (checks state retrying); those Hotspots read checking until it's done.");
        }
        if (checks.rewards.failed) {
          notes.push(`Rewards couldn't be checked for ${checks.rewards.failed} Hotspots (rewardsState failed); the page's Retry re-checks only those.`);
        }
        if (checks.iot?.failed) {
          notes.push(`IoT status couldn't be checked for ${checks.iot.failed} Hotspots (iotFailed); the page's Retry re-checks only those. They aren't counted as inactive.`);
        }
        if (checks.onboardDates.failed) {
          notes.push(`Onboard dates couldn't be read for ${checks.onboardDates.failed} Hotspots (a failed lookup, not a missing date); their onboardedAt is null, and the page's Retry in About re-reads only those.`);
        }
        if (c.unlisted > 0) notes.push(`${c.unlisted} Hotspots in this wallet couldn't be listed.`);
        if (network && network !== "all" && !(c.iot > 0 && c.mobile > 0)) {
          notes.push("The page offers the network filter only for wallets with Hotspots on both networks; open-wallet-dashboard would show every Hotspot.");
        }
        if (device && device !== "all" && !c.devices[device]) {
          notes.push(`This wallet has no ${device} Hotspots; the page ignores that device filter.`);
        }
        if (ordered.keys.length > shownKeys.length) {
          notes.push(`hotspots lists the first ${shownKeys.length} of ${ordered.keys.length} in list order; raise limit (up to ${FLEET_RESULT_CAP}) or narrow the filters for the rest.`);
        }
        if (freshness) notes.push(FRESHNESS_NOTE);

        const groups = ordered.groups.filter((g) => g.label).map((g) => ({ label: g.label, hotspots: g.rows.length }));
        return {
          wallet,
          settled: {
            rewards: settled.rewards,
            iot: settled.iot,
            mobile: settled.mobile,
            verdicts: settled.verdicts,
            onboardDates: settled.onboard,
            all: settled.all,
          },
          checks,
          counts: {
            total: c.total,
            needsALook: c.needs,
            byTier: c.byTier,
            byState: c.byState,
            networks: { iot: c.iot, mobile: c.mobile, both: c.dual, none: c.noNetwork },
            mobile: { wifi: c.wifi, dataOnly: c.dataOnly },
            devices: c.devices,
            ...(c.unlisted ? { unlisted: c.unlisted } : {}),
          },
          totals: totalsOut(list.totals),
          windows: listWindowsOut(list, mobileAgg),
          places: placesOut(list.rows),
          shown: {
            hotspots: filtered.count,
            of: c.total,
            filter: filtered.label,
            sort: sortOption(applied).label(list.ctx),
            ...(filtered.narrowed ? { totals: totalsOut(sumRows(filtered.rows)) } : {}),
          },
          ...(groups.length ? { groups } : {}),
          hotspots: shownKeys.map((k) => hotspotRowOut(list.byKey.get(k))),
          ...(ordered.keys.length > shownKeys.length
            ? { truncated: `showing ${shownKeys.length} of ${ordered.keys.length} Hotspots` }
            : {}),
          notes,
        };
      },
    },
    {
      name: "get-wallet-summary",
      title: "Get wallet summary",
      description:
        "Token balances (HNT/MOBILE/IOT/SOL/DC) with USD prices and their USD total (the dashboard's Wallet value: token balances only, not veHNT or unclaimed rewards), and fleet stats (counts by primary network and device type, asserted locations, regions as recorded, onboarding DC). Cached server-side about 60 s. Onboard dates are not included: use get-wallet-onboarding. For each Hotspot's status, unclaimed and earned HNT as the dashboard shows them, use get-wallet-hotspots.",
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ address }) {
        return fetchSummary(requireWallet(address));
      },
    },
    {
      name: "get-wallet-fleet",
      title: "Get wallet Hotspot fleet",
      description:
        `Full per-Hotspot list for a wallet plus fleet stats (counts by network/device type, asserted locations, regions, onboarding DC). Each row: name, entityKey, assetId, network(s), deviceType, location (H3 cell) with city/state/country, elevation (m), gain (tenths of a dBi), and dcOnboardingFeePaid. On-chain metadata only. For statuses, unclaimed and earned HNT as the dashboard's list shows them, use get-wallet-hotspots (wallet on screen); onboard dates: get-wallet-onboarding; IoT connectivity and traffic: get-wallet-iot-status; Mobile activity: get-wallet-mobile-activity; pending rewards per token: get-wallet-rewards. Large fleets are truncated to ${FLEET_RESULT_CAP} Hotspots in the result (the UI shows all).`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address }) {
        return capListField(await fetchFleet(requireWallet(address)), "hotspots", FLEET_RESULT_CAP);
      },
    },
    {
      name: "get-wallet-rewards",
      title: "Get wallet unclaimed rewards",
      description:
        `Pending (unclaimed) Hotspot rewards across a wallet's fleet as exact decimal token amounts (e.g. "1.23456789" HNT; IOT and MOBILE are legacy tokens), totaled per token and listed per Hotspot where nonzero. Served from a cache of about 15 minutes (rewards distribute about daily), so it can lag a claim. Covers up to ${REWARDS_HOTSPOT_CAP} Hotspots. For the whole fleet as the dashboard's list shows it (unclaimed and lifetime HNT per Hotspot, never-rewarded Hotspots), use get-wallet-hotspots. Claim via the /hotspot-claimer page's tools.`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address }) {
        const wallet = requireWallet(address);
        const fleet = await fetchFleet(wallet);
        const eligible = eligibleRewardHotspots(fleet?.hotspots);
        const counted = eligible.slice(0, REWARDS_HOTSPOT_CAP);
        const batches = [];
        for (let i = 0; i < counted.length; i += REWARDS_BATCH_SIZE) {
          batches.push(counted.slice(i, i + REWARDS_BATCH_SIZE));
        }
        const totals = {}; // token -> BigInt base units (exact summing)
        const decimalsByToken = {};
        const byHotspot = [];
        let errors = 0;
        let failedBatches = 0;
        // allSettled, matching useFleetRewards: one slow or rate-limited
        // batch shouldn't discard the others' totals.
        const settled = await Promise.allSettled(batches.map((batch) => fetchRewards(wallet, batch)));
        for (const outcome of settled) {
          if (outcome.status === "rejected") { failedBatches++; continue; }
          const results = outcome.value;
          for (const [entityKey, entry] of Object.entries(results || {})) {
            if (entry?.error) { errors++; continue; }
            const pending = {};
            for (const [token, tokenResult] of Object.entries(entry?.rewards || {})) {
              const amount = BigInt(tokenResult?.pending || "0");
              if (amount <= 0n) continue;
              const decimals = tokenResult.decimals ?? REWARD_DECIMALS[token];
              decimalsByToken[token] = decimals;
              pending[token] = formatBaseUnits(amount, decimals);
              totals[token] = (totals[token] ?? 0n) + amount;
            }
            if (Object.keys(pending).length > 0) byHotspot.push({ entityKey, pending });
          }
        }
        if (failedBatches === batches.length && batches.length > 0) {
          throw new Error("every rewards batch failed; try again shortly");
        }
        const totalPending = Object.fromEntries(
          Object.entries(totals).map(([token, amount]) => [token, formatBaseUnits(amount, decimalsByToken[token])]),
        );
        return {
          wallet,
          fleetSize: eligible.length,
          hotspotsCounted: counted.length,
          ...(eligible.length > counted.length
            ? { truncated: `rewards summed for ${counted.length} of ${eligible.length} Hotspots` }
            : {}),
          ...(errors ? { lookupErrors: errors } : {}),
          ...(failedBatches
            ? { failedBatches: `${failedBatches} of ${batches.length} reward batches failed; totals are partial` }
            : {}),
          totalPending,
          hotspotsWithPending: byHotspot,
        };
      },
    },
    {
      name: "get-wallet-onboarding",
      title: "Get wallet Hotspot onboard dates",
      description:
        `When a wallet's Hotspots were onboarded, read from chain (block time of the first successful transaction on each Hotspot's IoT/Mobile info account): first and latest date; byMonth, one entry per UTC month from the first to the latest (months without onboards read 0), each { month, count, iot, mobile } with a Hotspot on both networks counted once, under the network of its earlier date (the dashboard's About timeline); and per-Hotspot ISO dates (a Hotspot on both networks shows the earlier one; null = couldn't be determined, or its lookup failed: failedLookups or failedBatches say how many). Hotspots from before Helium's April 2023 move to Solana show their migration date, not their original deployment. When the wallet is on screen and the dashboard has read every date, uses those (whole fleet, the same months as the page); otherwise reads up to ${ONBOARDED_HOTSPOT_CAP} Hotspots itself. Dates are cached server-side once resolved, so a first lookup of a large fleet is the slow one. Per-Hotspot dates are listed for up to ${ONBOARDED_HOTSPOT_CAP} Hotspots.`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address }) {
        const wallet = requireWallet(address);
        // The page's dates when every one is in (its About timeline), else a
        // capped read of our own.
        const st = listFor(wallet);
        if (st?.settled.onboard) {
          const rows = st.list.rows;
          const onboardedByKey = Object.fromEntries(
            rows.map((r) => [r.key, r.onboarded.at === undefined ? undefined : { iot: r.onboarded.iot ?? null, mobile: r.onboarded.mobile ?? null }]),
          );
          const hotspots = rows.map((r) => r.hotspot);
          const { oldest, newest, timeline } = onboardingStats(onboardedByKey, hotspots);
          const failed = st.onboardFailed ?? 0;
          const unknown = rows.filter((r) => !r.onboarded.at).length - failed;
          return capListField(
            {
              wallet,
              source: "dashboard",
              fleetSize: rows.length,
              hotspotsCounted: rows.length,
              ...(failed
                ? { failedLookups: `${failed} Hotspots' dates couldn't be read (a failed lookup, not a missing date); they read null, and the page's Retry in About re-reads only those` }
                : {}),
              ...(unknown > 0 ? { undetermined: unknown } : {}),
              firstOnboarded: oldest,
              latestOnboarded: newest,
              byMonth: timeline,
              hotspots: rows.map((r) => ({ name: r.name, entityKey: r.key, onboardedAt: r.onboarded.at ?? null })),
            },
            "hotspots",
            ONBOARDED_HOTSPOT_CAP,
          );
        }
        const fleet = await fetchFleet(wallet);
        const all = fleet?.hotspots || [];
        const counted = all.slice(0, ONBOARDED_HOTSPOT_CAP);
        // A failed or rate-limited batch reads null for its Hotspots rather than
        // discarding the others' dates (the agent gets a partial result, not a wait).
        const { onboardedByKey, failedBatches, batchCount } = await scanOnboardDates(counted);
        if (failedBatches === batchCount && batchCount > 0) {
          throw new Error("every onboard-date batch failed; try again shortly");
        }
        const { oldest, newest, timeline } = onboardingStats(onboardedByKey, counted);
        const unknown = counted.filter((h) => !onboardedAtOf(onboardedByKey[h.entityKey])).length;
        return {
          wallet,
          source: "lookup",
          fleetSize: all.length,
          hotspotsCounted: counted.length,
          ...(all.length > counted.length
            ? { truncated: `dates read for ${counted.length} of ${all.length} Hotspots` }
            : {}),
          ...(failedBatches
            ? { failedBatches: `${failedBatches} of ${batchCount} batches failed; those Hotspots read null` }
            : {}),
          ...(unknown ? { undetermined: unknown } : {}),
          firstOnboarded: oldest,
          latestOnboarded: newest,
          byMonth: timeline,
          hotspots: counted.map((h) => ({
            name: h.name,
            entityKey: h.entityKey,
            onboardedAt: onboardedAtOf(onboardedByKey[h.entityKey]),
          })),
        };
      },
    },
    {
      name: "get-wallet-iot-status",
      title: "Get wallet IoT connectivity and traffic",
      description:
        `Per-Hotspot IoT connectivity and 30-day delivered LoRaWAN messages for a wallet's IoT Hotspots. Connectivity is a per-UTC-day verdict (active = connected to the Helium Packet Router on the latest reported day), not online now. Each row's state combines the two, with the dashboard's status tier and label: ${stateText("inactiveTraffic")} (Serious: not connected, but had messages in the window; check these first), ${stateText("activeQuiet")} and ${stateText("inactiveQuiet")} (Check), ${stateText("activeTraffic")} (OK); while traffic isn't known, ${stateText("inactive")} (Check) or ${stateText("active")} (OK); ${stateText("settingUp")} (Info: onboarded after the latest reported day); ${stateText("iotUnknown")} (no status for this Hotspot) and ${stateText("iotFailed")} (the lookup failed), both Unknown. Serious and Check rows need a look (counts.needsALook). Rows are ordered most actionable first. Uses the dashboard's finished scan when that wallet is on screen (whole fleet, same counts as the page); otherwise looks up at most ${IOT_SCAN_HOTSPOT_CAP} IoT Hotspots. For one Hotspot's daily messages per OUI (operator), use get-iot-hotspot-traffic.`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address }) {
        const wallet = requireWallet(address);
        // The page's finished scan for this wallet (whole fleet, zero lookups),
        // else a capped scan of our own through the same per-row loop.
        const page = getIotState?.();
        const usePage = page?.done && page.wallet === wallet && Array.isArray(page.hotspots);
        const eligible = (usePage ? page.hotspots : (await fetchFleet(wallet))?.hotspots || []).filter(hasIotStatus);
        const iotHotspots = eligible.length;
        const hotspots = usePage ? eligible : eligible.slice(0, IOT_SCAN_HOTSPOT_CAP);
        // The page-wide index (memoized), fetched alongside the scan.
        const indexPromise = hotspots.length ? fetchUtilizationIndex().catch(() => null) : null;
        let agg = page?.iotStatus;
        if (!usePage) {
          const { statusByKey, dataThrough } = await scanGatewayStatuses(hotspots.map((h) => h.entityKey));
          if (hotspots.length > 0 && hotspots.every((h) => statusByKey[h.entityKey] === null)) {
            throw new Error("every IoT status lookup failed; try again shortly");
          }
          // /fleet rows carry no onboard date, and a not-active verdict needs
          // one (setting up vs inactive): iotStatusOf holds exactly those rows
          // as pending. Read dates for them alone; a failed read lands as null,
          // which falls through, so no row stays pending.
          const undated = hotspots.filter((h) => iotStatusOf(h, statusByKey[h.entityKey], dataThrough) === "pending");
          const { onboardedByKey } = await scanOnboardDates(undated);
          agg = aggregateIotStatus(hotspots, statusByKey, dataThrough, onboardedByKey);
        }
        const index = await indexPromise;

        const { traffic, trafficRange, livenessRange } = agg;
        // The network index describes one build; apply it only to that build's day.
        const build = indexForBuild(index, trafficRange?.max);
        const indexWindow = build
          ? { days: build.days, daysComplete: build.daysComplete, missingDays: build.missingDays }
          : null;
        const rows = iotRows(hotspots, agg);
        const truncated = iotHotspots > hotspots.length;

        const notes = [IOT_MESSAGES_NOTE, `${IOT_CONNECTIVITY_NOTE} connectivityDay names that day.`];
        if (iotHotspots === 0) notes.push("This wallet has no IoT Hotspots.");
        if (livenessRange?.min !== livenessRange?.max || trafficRange?.min !== trafficRange?.max) {
          notes.push(
            "Records span more than one data day (a range's min differs from its max); some come from older cached copies.",
          );
        }
        if (indexWindow && indexWindow.daysComplete < indexWindow.days) {
          notes.push(
            `Only ${indexWindow.daysComplete} of ${indexWindow.days} days in the 30-day window are complete, so message counts are lower bounds.`,
          );
        }
        if (traffic.unpublished > 0) {
          notes.push("IoT traffic data isn't published right now, so messages30d is null. Connectivity is unaffected.");
        }
        if (agg.failed > 0) {
          notes.push(
            `The IoT status lookup failed for ${agg.failed} Hotspots (state iotFailed, counted in counts.unknown and counts.failed). They aren't counted as inactive; the dashboard's Retry re-checks only those.`,
          );
        }
        if (truncated) {
          notes.push(
            `Looked up ${hotspots.length} of ${iotHotspots} IoT Hotspots; counts cover those only. Open the wallet with open-wallet-dashboard and call again once its IoT scan finishes to cover the whole fleet.`,
          );
        }
        if (rows.length > FLEET_RESULT_CAP) {
          notes.push(`hotspots lists the ${FLEET_RESULT_CAP} most actionable rows; counts and health cover all ${rows.length}.`);
        }

        return capListField(
          {
            wallet,
            iotHotspots,
            hotspotsCounted: hotspots.length,
            ...(truncated ? { truncated: `IoT status looked up for ${hotspots.length} of ${iotHotspots} IoT Hotspots` } : {}),
            connectivityDay: livenessRange,
            trafficThrough: trafficRange,
            window: indexWindow,
            counts: {
              active: agg.active,
              inactive: agg.inactive,
              settingUp: agg.settingUp,
              unknown: agg.unknown,
              failed: agg.failed,
              notFound: agg.notFound,
              needsALook: rows.filter((r) => needsALook(r.tier)).length,
            },
            traffic: {
              withTraffic: traffic.withTraffic,
              known: traffic.known,
              messages30dSummedAcrossHotspots: traffic.messages30d,
              unavailable: traffic.unavailable,
              unpublished: traffic.unpublished,
            },
            health: { ...traffic.health },
            hotspots: rows,
            notes,
          },
          "hotspots",
          FLEET_RESULT_CAP,
        );
      },
    },
    {
      name: "get-iot-hotspot-traffic",
      title: "Get one IoT Hotspot's traffic by operator",
      description:
        "One IoT Hotspot's delivered LoRaWAN messages per day and per OUI (the routing ID of a LoRaWAN Network Server operator) over the 30-day window, with operator names from Helium's well-known OUI list. One Hotspot per call: triage a wallet with get-wallet-iot-status or get-wallet-hotspots first. `daily[].byOui` maps OUI id to messages that UTC day; `quietNetworkWide: true` means that OUI delivered nowhere on the network in the last 7 days (an operator-side drop, not this Hotspot's); `recentShare` is the last 7 days' daily average divided by the 30-day daily average (null when it can't be stated honestly).",
      inputSchema: {
        type: "object",
        properties: {
          entityKey: {
            ...ENTITY_KEY_SCHEMA,
            description:
              "The IoT Hotspot's entity key (its Helium public key, base58): the entityKey from get-wallet-iot-status, get-wallet-hotspots or get-wallet-fleet.",
          },
        },
        required: ["entityKey"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ entityKey }) {
        // A known zero in the page's scan needs no detail request.
        const known = getIotState?.()?.iotStatus?.rows.get(entityKey)?.traffic;
        if (isTrafficKnown(known) && known.packets30d === 0) {
          // The page-wide index (memoized; no per-Hotspot request) says whether
          // this zero spans 30 reported days or is a lower bound.
          const build = indexForBuild(await fetchUtilizationIndex().catch(() => null), known.dataThrough);
          const partial = build ? build.daysComplete < build.days : null;
          return {
            entityKey,
            dataThrough: known.dataThrough,
            window: build ? { days: build.days, daysComplete: build.daysComplete } : null,
            isPartial: partial,
            packets30d: 0,
            packets7d: 0,
            packets1d: 0,
            lastDay: null,
            recentShare: null,
            ouis: [],
            daily: [],
            notes: [
              partial
                ? `No delivered messages in the ${build.daysComplete} reported days of the 30-day window through ${known.dataThrough} (UTC), from the dashboard's IoT scan; ${build.days - build.daysComplete} days went unreported, so this zero is a lower bound. There is no daily breakdown.`
                : `No delivered messages in the 30 data days through ${known.dataThrough} (UTC), from the dashboard's IoT scan, so there is no daily breakdown.`,
              ...(build ? [] : ["Window completeness couldn't be confirmed (window and isPartial are null)."]),
              IOT_MESSAGES_NOTE,
            ],
          };
        }

        const [result, names, index] = await Promise.all([
          fetchGatewayUtilizationDetail(entityKey),
          fetchWellKnownOuiNames().catch(() => null),
          fetchUtilizationIndex().catch(() => null),
        ]);
        if (result.notFound) {
          throw new Error("not in the IoT service's Hotspot inventory; check the entity key (IoT Hotspots only)");
        }
        if (result.unpublished) {
          return {
            entityKey,
            unpublished: true,
            note: "IoT traffic data isn't published right now; try again later.",
          };
        }

        const { detail } = result;
        const labels = labelOuis(detail.ouis.map((o) => o.oui), names ?? new Map());
        const derived = deriveTrafficDetail(detail, labels, index);
        const ready = derived.kind === "ready";

        // deriveTrafficDetail's zero-filled window, with per-OUI daily counts.
        const daily = ready
          ? derived.days.map((d) => ({
              day: d.day,
              ...(derived.missingKnown ? { missing: d.missing } : {}),
              // An unreported day is "no data", never 0.
              total: d.missing ? null : d.total,
              byOui: d.byOui,
            }))
          : [];

        const notes = [IOT_MESSAGES_NOTE, "Days are UTC data days; dataThrough is the window's last day."];
        if (!ready) notes.push("No delivered messages in the window, so there is no daily breakdown.");
        if (derived.isPartial) {
          notes.push(
            `Only ${detail.window.daysComplete} of ${detail.window.days} days in the window are complete, so counts are lower bounds.`,
          );
        }
        if (ready && !derived.missingKnown) {
          notes.push("Which days went unreported isn't known for this build, so a 0 day may be an unreported day rather than no traffic.");
        } else if (daily.some((d) => d.missing)) {
          notes.push("Days with missing: true had no data reported (total null), not zero traffic.");
        }
        notes.push(
          names === null
            ? "Helium's well-known OUI list couldn't be loaded, so every name is null."
            : `name comes from Helium's well-known OUI list; null means the operator hasn't listed its OUI there (${WELL_KNOWN_REPO_URL}).`,
        );

        return {
          entityKey,
          dataThrough: detail.dataThrough,
          window: detail.window,
          isPartial: derived.isPartial,
          packets30d: detail.packets30d,
          packets7d: detail.packets7d,
          packets1d: detail.packets1d,
          lastDay: ready ? derived.lastDay : null,
          recentShare: ready ? derived.recentShare : null,
          ouis: ready
            ? derived.ouis.map((o) => ({
                oui: o.oui,
                name: o.fullName ?? null,
                packets30d: o.packets30d,
                packets7d: o.packets7d,
                daysActive30d: o.daysActive30d,
                lastDay: o.lastDay,
                quietNetworkWide: o.quietNetworkWide,
              }))
            : [],
          daily,
          notes,
        };
      },
    },
    {
      name: "get-wallet-mobile-activity",
      title: "Get wallet Mobile activity",
      description:
        `Recent Mobile network activity for a wallet's Mobile Hotspots: data-transfer HNT per UTC day for the last 7 days published (with that day's HNT price and the rewarded bytes it paid for), fleet-wide and per Hotspot (hntDays, hnt7d, daysWithHnt), users served on the latest usage day, ban status, and for WiFi indoor/outdoor Hotspots the heartbeats and rejected heartbeats in a 60-minute window (location trust, distance from the asserted location, reported positions) and the latest speedtest average in a 24-hour window. A window ends now while its data is fresh, otherwise at its last successful check (windows gives each end). Per-Hotspot issues, most actionable first: banned (latest ban record is a ban; the most serious), then WiFi health signals that don't change data-transfer HNT: noHeartbeat (none in the heartbeat window), lowTrust (latest location trust below 1), lowSpeedtest (latest speedtest multiplier below 1), rejectedHeartbeats (any in the window). Each row's tier is the dashboard's status tier of its most serious issue (banned Serious, the WiFi signals Check). The cross-source "No rewarded data (7 days)" state is in get-wallet-hotspots. counts cover every Mobile Hotspot (null while their data isn't in); hotspots lists the most actionable ${MOBILE_LIST_DEFAULT} by default (raise limit up to ${FLEET_RESULT_CAP}, or filter by issue); a row runs about 1.3 KB (a WiFi Hotspot's entityKey alone is 366 characters), so ${FLEET_RESULT_CAP} rows are about 260 KB. When the wallet is on screen, reads the dashboard's own data with no extra downloads (waiting up to ${MOBILE_PAGE_WAIT_MS / 1000} s for its first check) and adds its Mobile data status (freshness), unless that tab is hidden and last checked over ${FRESH_MS / 60_000} minutes ago. Otherwise runs one check itself (up to ${MOBILE_CHECK_TIMEOUT_MS / 1000} s, then returns what it has), reading Helium's public Mobile network data files whole: roughly 25 MB for a fleet of data-only Hotspots and 55 MB with WiFi Hotspots when this browser hasn't read them recently, and little once it has, since the files serve every wallet and share the dashboard's cache. Mobile Hotspots with ecc_compact keys (CBRS radios) aren't covered. For IoT Hotspots use get-wallet-iot-status.`,
      inputSchema: {
        type: "object",
        properties: {
          address: ADDRESS_SCHEMA,
          issue: {
            type: "string",
            enum: MOBILE_ISSUE_ORDER,
            description: "List only Mobile Hotspots with this issue. counts still cover every Mobile Hotspot.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: FLEET_RESULT_CAP,
            default: MOBILE_LIST_DEFAULT,
            description: "Max Hotspots listed, most actionable first.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      validate({ address }) {
        if (!address && !getWallet()) return "no wallet given and none loaded in the dashboard; pass `address`";
        return null;
      },
      async execute({ address, issue, limit }) {
        const wallet = requireWallet(address);
        // The page's own state when this wallet is on screen (no second
        // download of the same files), else a one-off check of our own. A
        // hidden tab doesn't check, so once its data is past fresh a check of
        // our own stands in (through the shared caches, mostly only what's
        // new since downloads).
        let page = await pageMobileState(wallet);
        let hiddenAt = null;
        if (
          page?.settled &&
          page.activity.paused &&
          page.activity.phase !== "error" &&
          Date.now() - (page.activity.checkedAt ?? 0) > FRESH_MS
        ) {
          hiddenAt = page.activity.checkedAt;
          page = null;
        }
        let hotspots;
        let activity;
        let agg;
        let timedOut = false;
        if (page) {
          ({ hotspots, activity, mobile: agg } = page);
        } else {
          try {
            ({ hotspots, activity, timedOut } = await checkWalletMobile(wallet));
          } catch (err) {
            if (!err?.fleet) throw err;
            const shown = getMobileState?.();
            const pageError = shown?.wallet === wallet ? shown.fleetError : null;
            throw new Error(
              pageError
                ? `the dashboard couldn't load this wallet's Hotspot list (${pageError}), and neither could this tool (${err.message}); the page offers Retry, and get-wallet-fleet reads the list directly`
                : `couldn't load this wallet's Hotspot list (${err.message}); try again shortly, or read the list with get-wallet-fleet`,
            );
          }
          agg = aggregateMobile(hotspots, activity, Date.now());
        }
        return mobileActivityResult({ wallet, hotspots, activity, agg, page, timedOut, hiddenAt, issue, limit });
      },
    },
    {
      name: "get-wallet-transactions",
      title: "Get wallet transactions",
      description:
        "Categorized recent transactions for a wallet (rewards claims, transfers, Hotspot ops). Pass `before` (a transaction signature from a previous page) to paginate.",
      inputSchema: {
        type: "object",
        properties: {
          address: ADDRESS_SCHEMA,
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "Max transactions to return." },
          before: { type: "string", minLength: 32, maxLength: 120, description: "Paginate: only transactions before this signature." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ address, limit, before }) {
        return fetchTransactions(requireWallet(address), { limit, before });
      },
    },
  ];
}
