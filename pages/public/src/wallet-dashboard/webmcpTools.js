import { fetchSummary, fetchFleet, fetchRewards, scanOnboardDates, fetchTransactions } from "../lib/walletDashboardApi.js";
import {
  scanGatewayStatuses,
  fetchUtilizationIndex,
  fetchGatewayUtilizationDetail,
} from "../lib/iotStatusApi.js";
import { fetchWellKnownOuiNames, labelOuis, WELL_KNOWN_REPO_URL } from "../lib/wellKnownOuis.js";
import { ENTITY_KEY_SCHEMA, SOLANA_ADDRESS_SCHEMA } from "../webmcp/helpers.js";
import {
  REWARD_DECIMALS,
  IOT_MESSAGES_NOTE,
  IOT_CONNECTIVITY_NOTE,
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
import { checkMobileOnce } from "./mobile/mobileClient.js";
import { mobileFleetOf } from "./mobile/useMobileActivity.js";
import { FRESH_MS, windowLength } from "./mobile/tableMeta.js";
import { abortableDelay } from "../lib/abort.js";
import { dedupeAsync } from "../lib/requestDedupe.js";

const ADDRESS_SCHEMA = {
  ...SOLANA_ADDRESS_SCHEMA,
  description:
    "Solana wallet address (base58). Optional when the dashboard already shows a wallet — defaults to that one.",
};

/** Cap fleet lists in tool results; the UI still shows everything. */
const FLEET_RESULT_CAP = 200;
/** Two reward batches keeps the tool bounded on maker-sized fleets. */
const REWARDS_HOTSPOT_CAP = 100;
/** Four onboard batches — matches the fleet tool's row cap. */
const ONBOARDED_HOTSPOT_CAP = FLEET_RESULT_CAP;
/** IoT status lookups per page when the tool scans a wallet itself (one GET each). */
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

const OFFSET_SCHEMA = { type: "integer", minimum: 0, default: 0, description: "Start at this offset; use pagination.nextOffset for the next page." };
const limitSchema = (maximum, defaultLimit = maximum) => ({ type: "integer", minimum: 1, maximum, default: defaultLimit, description: "Maximum Hotspots on this page." });
const byEntityKey = (a, b) => (a.entityKey < b.entityKey ? -1 : a.entityKey > b.entityKey ? 1 : 0);
const orderedFleet = (rows) => [...(rows || [])].sort(byEntityKey);
function pagination(total, offset, limit, returned) {
  return { offset, limit, total, returned, nextOffset: offset + returned < total ? offset + returned : null };
}

/** Format a base-unit BigInt as a decimal token string, trimming zeros. */
function formatBaseUnits(amount, decimals) {
  if (!decimals) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Per-Hotspot IoT rows from the dashboard's aggregate (`aggregateIotStatus`),
 * most actionable first — the same `iotActionRank` order as the table's Status
 * sort — then most messages, then name.
 */
function iotRows(hotspots, agg) {
  return hotspots
    .map((hotspot) => ({ hotspot, row: agg.rows.get(hotspot.entityKey) }))
    .filter((e) => e.row)
    .sort(
      (a, b) =>
        iotActionRank(a.row.status, a.row.health) - iotActionRank(b.row.status, b.row.health) || byMessagesDesc(a, b) || byEntityKey(a.hotspot, b.hotspot),
    )
    .map(({ hotspot, row }) => ({
      entityKey: hotspot.entityKey,
      name: hotspot.name || null,
      status: row.status,
      health: row.health,
      messages30d: row.messages,
      ouiIds: isTrafficKnown(row.traffic) ? [...row.traffic.ouis] : null,
    }));
}

const isoOf = (ms) => (ms ? new Date(ms).toISOString() : null);
const roundTo = (x, digits) => (x == null ? null : Number(x.toFixed(digits)));

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

// A running check is shared; a finished one is reused for 30 s. Releasing
// one caller never cancels another; the last cancellation stops the worker.
const checkWalletMobile = dedupeAsync(runWalletMobile, 30_000, {
  signalIndex: 1,
  keep: ({ timedOut }) => !timedOut,
});

async function runWalletMobile(wallet, { signal } = {}) {
  const hotspots = (await fetchFleet(wallet, { signal }))?.hotspots || [];
  const fleet = mobileFleetOf(hotspots);
  if (fleet.mobileTotal === 0) return { hotspots, activity: null, timedOut: false };
  signal?.throwIfAborted();
  const { state, timedOut } = await checkMobileOnce(
    { wallet, keys: fleet.keys, wifi: fleet.wifiTotal > 0 },
    { timeoutMs: MOBILE_CHECK_TIMEOUT_MS, signal },
  );
  return { hotspots, activity: state, timedOut };
}

/** One Mobile Hotspot's row for the agent, from `aggregateMobile`'s row. */
function mobileRow(hotspot, row) {
  const out = {
    entityKey: hotspot.entityKey,
    name: hotspot.name || null,
    wifi: row.wifi,
    issues: row.issues,
    hntLatestDay: roundTo(row.hntLatestDay, 8),
    rewardedBytesLatestDay: row.bytesLatestDay,
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
 * The agent's view of a wallet's Mobile activity: fleet-wide figures, issue
 * counts over every Mobile Hotspot, and per-Hotspot rows most actionable
 * first (mobileActionRank, the table's Status order, then latest-day HNT,
 * then name), filtered by `issue` and capped at `limit`. A count whose data
 * isn't in is null, never 0. `hiddenAt`: the last check of a hidden dashboard
 * tab this fresh check stands in for.
 */
function mobileActivityResult({ wallet, hotspots, activity, agg, page, timedOut, hiddenAt, issue, offset, limit }) {
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
      aggregateScope: "fleet",
      pagination: pagination(0, offset, limit, 0),
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
        (a.hotspot.name || "").localeCompare(b.hotspot.name || "") || byEntityKey(a.hotspot, b.hotspot),
    )
    .map(({ hotspot, row }) => mobileRow(hotspot, row));

  const r = agg.rewards;
  const latest = r?.latest?.state === "ok" ? r.latest : null;
  const rewards = r && {
    latestDay: latest?.day ?? null,
    latestDayHnt: latest ? roundTo(latest.hnt, 8) : null,
    latestDayUsd: roundTo(r.latestUsd, 2),
    latestDayRewardedBytes: latest ? latest.bytes : null,
    hotspotsRewardedLatestDay: latest?.hotspots ?? null,
    hntOverLoadedDays: roundTo(r.weekHnt, 8),
    daysLoaded: r.daysLoaded,
    days: r.days.map((d) => {
      const ok = d.state === "ok";
      return {
        day: d.day,
        state: d.state,
        hnt: ok ? roundTo(d.hnt, 8) : null,
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
    "HNT is data-transfer rewards per UTC day (rewards.days, newest first; latestDay is the newest day published), paid per rewarded byte: rewardedBytes are the bytes that day's HNT paid for. usage covers one UTC day (usage.day), which can differ from latestDay.",
    "Heartbeats, location trust and the speedtest multiplier don't change data-transfer HNT: they are WiFi health signals, sent only by WiFi indoor/outdoor Hotspots (wifi: true). banned is the most serious issue.",
    "usage.usersServedSummedAcrossHotspots adds up each Hotspot's usersServed, so a user served by two Hotspots counts twice; each Hotspot's usersServed is its own count for usage.day, and with usage loaded a null one means that day's report has no row for it (not reported, not zero).",
    "A null field or count means its data hasn't loaded or couldn't be checked (see tables), never zero. With its data in, a null speedtest24h means no average in its window, and a null lastHeartbeatAt no heartbeat in its window.",
  );
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
    if (activity.phase === "error") notes.push("The dashboard's latest check failed (see tables); data here is what it had before.");
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

  return {
    wallet,
    aggregateScope: "fleet",
    pagination: pagination(rows.length, offset, limit, rows.slice(offset, offset + limit).length),
    source: page ? "dashboard" : "check",
    mobileHotspots: agg.mobileTotal,
    wifiHotspots: agg.wifiTotal,
    checkedAt: isoOf(activity?.checkedAt),
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
    hotspots: rows.slice(offset, offset + limit),
    notes,
  };
}

/**
 * WebMCP tools for /wallet-dashboard. The URL is the page's source of
 * truth, so open-wallet-dashboard just navigates and the page does the
 * rest; the get-* tools return data directly from the same worker
 * endpoints the UI uses (KV-cached server-side), and the IoT tools from
 * api-iot.heliumtools.org through the page's own cached clients.
 *
 * `getWallet` returns the wallet currently shown (or null), `getIotState`
 * that wallet's IoT scan (`{ wallet, hotspots, iotStatus, done }`
 * — `iotStatus` being the page's `aggregateIotStatus` — or null), and
 * `getMobileState` its Mobile activity (`{ wallet, hotspots, activity, mobile }`
 * — `activity` the `useMobileActivity` contract, `mobile` the page's
 * `aggregateMobile` — or `{ wallet, fleetError }` when that wallet's fleet
 * failed to load, or null). All are live getters, so tools registered once
 * stay correct across navigation.
 */
export function makeWalletDashboardTools(navigate, getWallet, getIotState, getMobileState) {
  // The explicit address argument, or the wallet the page is showing.
  const requireWallet = (address) => {
    const wallet = address || getWallet();
    if (!wallet) throw new Error("no wallet given and none loaded in the dashboard — pass `address`");
    return wallet;
  };

  // The page's Mobile state for `wallet` once it's ready (pageSettled), or
  // when the wait runs out whatever the page has (`settled: false`). null if
  // the wallet isn't on screen or stops being, or at once if the page's fleet
  // failed to load: the tool then checks on its own (retrying the fleet).
  async function pageMobileState(wallet, signal) {
    const deadline = Date.now() + MOBILE_PAGE_WAIT_MS;
    for (;;) {
      signal?.throwIfAborted();
      if (getWallet() !== wallet) return null;
      const page = getMobileState?.();
      const ours = page?.wallet === wallet ? page : null;
      if (ours?.fleetError) return null;
      const settled = ours ? pageSettled(ours.activity, ours.mobile) : false;
      if (settled || Date.now() >= deadline) return ours && { ...ours, settled };
      await abortableDelay(MOBILE_PAGE_POLL_MS, signal);
    }
  }

  return [
    {
      name: "open-wallet-dashboard",
      title: "Open a wallet in the dashboard",
      description:
        "Show a wallet in the dashboard UI: balances, fleet map, rewards, IoT connectivity and traffic (per-Hotspot health, and each Hotspot's daily delivered messages per operator), Mobile activity (daily data-transfer HNT, users served, heartbeats, speedtests, bans; kept live while the page is visible), governance, and activity all load for the user to see. Like any view, the wallet is added to this browser's Recent wallets on the dashboard's lookup screen. Use the get-* tools to read the underlying data.",
      inputSchema: {
        type: "object",
        properties: { address: { ...SOLANA_ADDRESS_SCHEMA, description: "Solana wallet address (base58) to display." } },
        required: ["address"],
        additionalProperties: false,
      },
      execute({ address }, { signal } = {}) {
        signal?.throwIfAborted();
        navigate(`/wallet-dashboard/${address}`);
        return `Dashboard now loading wallet ${address}. Data may take a few seconds to appear on screen.`;
      },
    },
    {
      name: "get-wallet-summary",
      title: "Get wallet summary",
      description:
        "Token balances (HNT/MOBILE/IOT/SOL/DC) with USD prices, portfolio total, and fleet stats (counts by network/device type, asserted locations, regions, onboarding DC) for a wallet. Cached server-side ~60s. Onboard dates are not included — use get-wallet-onboarding.",
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ address }, { signal } = {}) {
        return fetchSummary(requireWallet(address), { signal });
      },
    },
    {
      name: "get-wallet-fleet",
      title: "Get wallet Hotspot fleet",
      description:
        `Paged per-Hotspot list for a wallet plus fleet stats (counts by network/device type, asserted locations, regions, onboarding DC). Each row: name, entityKey, assetId, network(s), deviceType, location (H3 cell) with city/state/country, elevation (m), gain (tenths of a dBi), and dcOnboardingFeePaid. On-chain metadata only — for onboard dates use get-wallet-onboarding; for IoT connectivity and traffic, get-wallet-iot-status; for Mobile activity, get-wallet-mobile-activity; for rewards, get-wallet-rewards. Sorted by entityKey; use offset/limit and pagination.nextOffset to retrieve the full fleet. Stats cover the entire fleet.`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA, offset: OFFSET_SCHEMA, limit: limitSchema(FLEET_RESULT_CAP) },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address, offset = 0, limit = FLEET_RESULT_CAP }, { signal } = {}) {
        const fleet = await fetchFleet(requireWallet(address), { signal });
        signal?.throwIfAborted();
        const all = orderedFleet(fleet?.hotspots);
        const hotspots = all.slice(offset, offset + limit);
        return { ...fleet, hotspots, aggregateScope: "fleet", pagination: pagination(all.length, offset, limit, hotspots.length) };
      },
    },
    {
      name: "get-wallet-rewards",
      title: "Get wallet unclaimed rewards",
      description:
        `Pending (unclaimed) Hotspot rewards for one page of a wallet's fleet as decimal token amounts (e.g. "12.345678" IOT), totaled per token and listed per Hotspot where nonzero. Served from a ~15min cache — rewards distribute roughly daily. Sorted by entityKey. Totals cover only this page (aggregateScope: page); use offset/limit and pagination.nextOffset for the rest. Up to ${REWARDS_HOTSPOT_CAP} Hotspots per page; claim via the /hotspot-claimer page's tools.`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA, offset: OFFSET_SCHEMA, limit: limitSchema(REWARDS_HOTSPOT_CAP) },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address, offset = 0, limit = REWARDS_HOTSPOT_CAP }, { signal } = {}) {
        const wallet = requireWallet(address);
        const fleet = await fetchFleet(wallet, { signal });
        const eligible = eligibleRewardHotspots(fleet?.hotspots);
        const counted = eligible.slice(offset, offset + limit);
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
        const settled = await Promise.allSettled(batches.map((batch) => fetchRewards(wallet, batch, { signal })));
        signal?.throwIfAborted();
        for (const [batchIndex, outcome] of settled.entries()) {
          if (outcome.status === "rejected") { failedBatches++; continue; }
          const results = outcome.value;
          const batch = batches[batchIndex];
          for (const { entityKey } of batch) {
            const entry = results?.[entityKey];
            if (!entry || entry.error) { errors++; continue; }
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
          throw new Error("every rewards batch failed — try again shortly");
        }
        const totalPending = Object.fromEntries(
          Object.entries(totals).map(([token, amount]) => [token, formatBaseUnits(amount, decimalsByToken[token])]),
        );
        return {
          wallet,
          fleetSize: eligible.length,
          aggregateScope: "page",
          pagination: pagination(eligible.length, offset, limit, counted.length),
          partial: errors > 0 || failedBatches > 0,
          hotspotsCounted: counted.length,
          ...(errors ? { lookupErrors: errors } : {}),
          ...(failedBatches
            ? { failedBatches: `${failedBatches} of ${batches.length} reward batches failed — totals are partial` }
            : {}),
          totalPending,
          hotspotsWithPending: byHotspot.sort(byEntityKey),
        };
      },
    },
    {
      name: "get-wallet-onboarding",
      title: "Get wallet Hotspot onboard dates",
      description:
        `When a wallet's Hotspots were onboarded, read from chain (block time of the first successful transaction on each Hotspot's IoT/Mobile info account): first and latest date, a per-month count (UTC), and per-Hotspot ISO dates (a Hotspot on both networks shows the earlier one; null = couldn't be determined). Hotspots from before Helium's April 2023 move to Solana show their migration date, not their original deployment. Sorted by entityKey. Dates, first/latest and monthly counts cover only this page (aggregateScope: page); use offset/limit and pagination.nextOffset for the rest. Up to ${ONBOARDED_HOTSPOT_CAP} Hotspots per page; dates are cached server-side once resolved, so a first lookup of a large fleet is the slow one.`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA, offset: OFFSET_SCHEMA, limit: limitSchema(ONBOARDED_HOTSPOT_CAP) },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address, offset = 0, limit = ONBOARDED_HOTSPOT_CAP }, { signal } = {}) {
        const wallet = requireWallet(address);
        const fleet = await fetchFleet(wallet, { signal });
        const all = orderedFleet(fleet?.hotspots);
        const counted = all.slice(offset, offset + limit);
        // A failed or rate-limited batch reads null for its Hotspots rather than
        // discarding the others' dates (the agent gets a partial result, not a wait).
        const { onboardedByKey, failedBatches, batchCount } = await scanOnboardDates(counted, { signal });
        signal?.throwIfAborted();
        if (failedBatches === batchCount && batchCount > 0) {
          throw new Error("every onboard-date batch failed — try again shortly");
        }
        const { oldest, newest, timeline } = onboardingStats(onboardedByKey);
        const unknown = counted.filter((h) => !onboardedAtOf(onboardedByKey[h.entityKey])).length;
        return {
          wallet,
          fleetSize: all.length,
          aggregateScope: "page",
          pagination: pagination(all.length, offset, limit, counted.length),
          hotspotsCounted: counted.length,
          ...(failedBatches
            ? { failedBatches: `${failedBatches} of ${batchCount} batches failed — those Hotspots read null` }
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
        `Per-Hotspot IoT connectivity and 30-day delivered LoRaWAN messages for a wallet's IoT Hotspots. Connectivity is a per-UTC-day verdict (active = connected to the Helium Packet Router on the latest reported day), not online-now. Health combines the two: inactiveTraffic (not connected, but had messages in the window — check these first), activeQuiet (connected, no messages in 30 days), inactiveQuiet, activeTraffic. Page membership is sorted by entityKey, with rows most actionable first within that page. Use offset/limit and pagination.nextOffset for all Hotspots. Uses the dashboard's finished scan when that wallet is on screen (whole fleet, same counts as the UI); otherwise looks up at most ${IOT_SCAN_HOTSPOT_CAP} IoT Hotspots per page. aggregateScope identifies whether counts/health/traffic cover the fleet (dashboard) or only this page (own scan). For one Hotspot's daily messages per OUI (operator), use get-iot-hotspot-traffic.`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA, offset: OFFSET_SCHEMA, limit: limitSchema(IOT_SCAN_HOTSPOT_CAP) },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address, offset = 0, limit = IOT_SCAN_HOTSPOT_CAP }, { signal } = {}) {
        signal?.throwIfAborted();
        const wallet = requireWallet(address);
        // The page's finished scan for this wallet (whole fleet, zero lookups),
        // else a capped scan of our own through the same per-row loop.
        const page = getIotState?.();
        const usePage = page?.done && page.wallet === wallet && Array.isArray(page.hotspots);
        const eligible = orderedFleet((usePage ? page.hotspots : (await fetchFleet(wallet, { signal }))?.hotspots || []).filter(hasIotStatus));
        const iotHotspots = eligible.length;
        const hotspots = eligible.slice(offset, offset + limit);
        // The page-wide index (memoized), fetched alongside the scan.
        const indexPromise = hotspots.length ? fetchUtilizationIndex({ signal }).catch(() => null) : null;
        let agg = page?.iotStatus;
        if (!usePage) {
          const { statusByKey, dataThrough } = await scanGatewayStatuses(hotspots.map((h) => h.entityKey), { signal });
          if (hotspots.length > 0 && hotspots.every((h) => statusByKey[h.entityKey] === null)) {
            throw new Error("every IoT status lookup failed — try again shortly");
          }
          // /fleet rows carry no onboard date, and a not-active verdict needs
          // one (setting up vs inactive): iotStatusOf holds exactly those rows
          // as pending. Read dates for them alone; a failed read lands as null,
          // which falls through, so no row stays pending.
          const undated = hotspots.filter((h) => iotStatusOf(h, statusByKey[h.entityKey], dataThrough) === "pending");
          const { onboardedByKey } = await scanOnboardDates(undated, { signal });
          agg = aggregateIotStatus(hotspots, statusByKey, dataThrough, onboardedByKey);
        }
        const index = await indexPromise;
        signal?.throwIfAborted();

        const { traffic, trafficRange, livenessRange } = agg;
        // The network index describes one build; apply it only to that build's day.
        const build = indexForBuild(index, trafficRange?.max);
        const indexWindow = build
          ? { days: build.days, daysComplete: build.daysComplete, missingDays: build.missingDays }
          : null;
        const rows = iotRows(hotspots, agg);

        const notes = [IOT_MESSAGES_NOTE, `${IOT_CONNECTIVITY_NOTE} connectivityDay names that day.`];
        if (iotHotspots === 0) notes.push("This wallet has no IoT Hotspots.");
        if (livenessRange?.min !== livenessRange?.max || trafficRange?.min !== trafficRange?.max) {
          notes.push(
            "Records span more than one data day (a range's min differs from its max) — some come from older cached copies.",
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
        notes.push(usePage ? "Counts, health and traffic cover the whole dashboard fleet; hotspots lists only this page." : "Counts, health and traffic cover only this page; continue with pagination.nextOffset.");

        return {
          wallet,
          iotHotspots,
          hotspotsCounted: usePage ? eligible.length : hotspots.length,
          aggregateScope: usePage ? "fleet" : "page",
          pagination: pagination(eligible.length, offset, limit, hotspots.length),
          connectivityDay: livenessRange,
          trafficThrough: trafficRange,
          window: indexWindow,
          counts: { active: agg.active, inactive: agg.inactive, settingUp: agg.settingUp, unknown: agg.unknown },
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
        };
      },
    },
    {
      name: "get-iot-hotspot-traffic",
      title: "Get one IoT Hotspot's traffic by operator",
      description:
        "One IoT Hotspot's delivered LoRaWAN messages per day and per OUI (the routing ID of a LoRaWAN Network Server operator) over the 30-day window, with operator names from Helium's well-known OUI list. One Hotspot per call — triage a wallet with get-wallet-iot-status first. `daily[].byOui` maps OUI id → messages that UTC day; `quietNetworkWide: true` means that OUI delivered nowhere on the network in the last 7 days (an operator-side drop, not this Hotspot's); `recentShare` is the last 7 days' daily average ÷ the 30-day daily average (null when it can't be stated honestly).",
      inputSchema: {
        type: "object",
        properties: {
          entityKey: {
            ...ENTITY_KEY_SCHEMA,
            description:
              "The IoT Hotspot's entity key (its Helium public key, base58) — the entityKey from get-wallet-iot-status or get-wallet-fleet.",
          },
        },
        required: ["entityKey"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ entityKey }, { signal } = {}) {
        signal?.throwIfAborted();
        // A known zero in the page's scan needs no detail request.
        const known = getIotState?.()?.iotStatus?.rows.get(entityKey)?.traffic;
        if (isTrafficKnown(known) && known.packets30d === 0) {
          // The page-wide index (memoized; no per-Hotspot request) says whether
          // this zero spans 30 reported days or is a lower bound.
          const index = await fetchUtilizationIndex({ signal }).catch(() => null);
          signal?.throwIfAborted();
          const build = indexForBuild(index, known.dataThrough);
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
                : `No delivered messages in the 30 data days through ${known.dataThrough} (UTC), from the dashboard's IoT scan — there is no daily breakdown.`,
              ...(build ? [] : ["Window completeness couldn't be confirmed (window and isPartial are null)."]),
              IOT_MESSAGES_NOTE,
            ],
          };
        }

        const [result, names, index] = await Promise.all([
          fetchGatewayUtilizationDetail(entityKey, { signal }),
          fetchWellKnownOuiNames({ signal }).catch(() => null),
          fetchUtilizationIndex({ signal }).catch(() => null),
        ]);
        signal?.throwIfAborted();
        if (result.notFound) {
          throw new Error("not in the IoT service's Hotspot inventory — check the entity key (IoT Hotspots only)");
        }
        if (result.unpublished) {
          return {
            entityKey,
            unpublished: true,
            note: "IoT traffic data isn't published right now — try again later.",
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
        if (!ready) notes.push("No delivered messages in the window — there is no daily breakdown.");
        if (derived.isPartial) {
          notes.push(
            `Only ${detail.window.daysComplete} of ${detail.window.days} days in the window are complete, so counts are lower bounds.`,
          );
        }
        if (ready && !derived.missingKnown) {
          notes.push("Which days went unreported isn't known for this build, so a 0 day may be an unreported day rather than no traffic.");
        } else if (daily.some((d) => d.missing)) {
          notes.push("Days with missing: true had no data reported (total null) — not zero traffic.");
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
        `Mobile Hotspot activity: seven published UTC days of data-transfer HNT, rewarded bytes, latest usage, bans, and WiFi health signals (heartbeats, trust, speedtests). Counts/rewards/usage cover the entire fleet; hotspots is paged, most actionable first, filterable by issue. Use offset/limit and pagination.nextOffset (default ${MOBILE_LIST_DEFAULT}, max ${FLEET_RESULT_CAP}); windows and per-table timestamps identify stale or partial data, and null means unknown. WiFi health signals do not change data-transfer HNT. Reuses dashboard data; an off-screen check can download about 25 MB (data-only) or 55 MB (with WiFi), cached across wallets, and takes up to ${MOBILE_CHECK_TIMEOUT_MS / 1000}s. CBRS radios are not covered.`,
      inputSchema: {
        type: "object",
        properties: {
          address: ADDRESS_SCHEMA,
          offset: OFFSET_SCHEMA,
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
      async execute({ address, issue, offset = 0, limit = MOBILE_LIST_DEFAULT }, { signal } = {}) {
        const wallet = requireWallet(address);
        // The page's own state when this wallet is on screen (no second
        // download of the same files), else a one-off check of our own. A
        // hidden tab doesn't check, so once its data is past fresh a check of
        // our own stands in (through the shared caches, mostly only what's
        // new since downloads).
        let page = await pageMobileState(wallet, signal);
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
          ({ hotspots, activity, timedOut } = await checkWalletMobile(wallet, { signal }));
          agg = aggregateMobile(hotspots, activity, Date.now());
        }
        signal?.throwIfAborted();
        return mobileActivityResult({ wallet, hotspots, activity, agg, page, timedOut, hiddenAt, issue, offset, limit });
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
      execute({ address, limit, before }, { signal } = {}) {
        return fetchTransactions(requireWallet(address), { limit, before, signal });
      },
    },
  ];
}
