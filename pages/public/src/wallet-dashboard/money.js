// ── Money ────────────────────────────────────────────────────────────────────
// One derivation of the wallet's money figures, read by Summary and Earnings
// (the design repeats them; one source keeps them equal). HNT first, USD
// second with its price basis named; no false zeros: a figure is "loading"
// until its first answer, "scanning" (so far, with a denominator) while the
// rewards fan-out runs, and "failed" when nothing came back. Pure.
import { fmtToken, govPendingHnt } from "./format.js";

const BALANCE_SPLIT_ORDER = ["hnt", "sol", "dc", "mobile", "iot"];
const ZERO_ORDER = ["hnt", "mobile", "iot", "sol", "dc"];
const LEGACY = new Set(["mobile", "iot"]);
const LABEL = { hnt: "HNT", sol: "SOL", dc: "DC", mobile: "MOBILE", iot: "IOT" };

/** "A", "A and B", "A, B and C". */
function joinAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function walletValueOf(summary, governance) {
  const data = summary?.data;
  const state = data ? "ready" : summary?.error ? "failed" : "loading";
  const tokens = data?.tokens || {};
  const split = BALANCE_SPLIT_ORDER.filter((t) => Number(tokens[t]?.uiAmount) > 0).map((t) => ({
    token: t,
    label: LABEL[t],
    amount: Number(tokens[t].uiAmount),
    usd: tokens[t].valueUsd ?? null,
    priceUsd: tokens[t].priceUsd ?? null,
    legacy: LEGACY.has(t),
    ataEstablished: tokens[t].ataEstablished ?? null,
  }));
  const zeroTokens = ZERO_ORDER.filter((t) => !(Number(tokens[t]?.uiAmount) > 0)).map((t) => LABEL[t]);
  const verb = zeroTokens.length === 1 ? "is" : "are";
  const zeroLine = zeroTokens.length ? ` ${joinAnd(zeroTokens)} ${verb} 0.` : "";
  const caption = !data
    ? null
    : split.length === 0
      ? `No token balances.${zeroLine}`
      : `Token balances at current prices${Number(tokens.dc?.uiAmount) > 0 ? ", DC at the fixed $1 per 100,000 DC" : ""}.${zeroLine}`;

  let veLockedHnt = 0;
  let veExpiredHnt = 0;
  for (const p of governance?.positions || []) {
    const amount = Number(p.amountLockedHnt) || 0;
    if (p.lockup?.isExpired) veExpiredHnt += amount;
    else veLockedHnt += amount;
  }
  const veCaptions = [
    veLockedHnt > 0 ? `+ ${fmtToken(veLockedHnt, { max: 2 })} HNT locked in veHNT, not counted above.` : null,
    veExpiredHnt > 0 ? `+ ${fmtToken(veExpiredHnt, { max: 2 })} HNT in expired veHNT positions, not counted above.` : null,
  ].filter(Boolean);

  return {
    state,
    usd: data?.totalUsd ?? null,
    split,
    zeroTokens,
    caption,
    veLockedHnt,
    veExpiredHnt,
    veCaptions,
    pricesFetchedAt: data?.pricesFetchedAt ?? null,
  };
}

// The Hotspot-rewards scan as one state: "loading" (no batch in yet),
// "scanning" (some in), "ready", "failed" (every batch failed), or "none"
// (no Hotspot to check). A Retry of the failed batches never reads as a new
// scan: what loaded stays "ready" while it runs.
function rewardsScanState({ fleetLoaded, fleetFailed, rewards, rewardsState }) {
  if (fleetFailed) return "failed";
  if (!fleetLoaded) return "loading";
  const { done, progress, retrying } = rewardsState || {};
  const total = progress?.total ?? 0;
  if (done && total === 0) return "none";
  if (!done && retrying) return (rewards?.counted ?? 0) > 0 ? "ready" : "loading";
  if (!done) return (progress?.done ?? 0) > 0 ? "scanning" : "loading";
  return (rewards?.counted ?? 0) === 0 && total > 0 ? "failed" : "ready";
}

/** USD for per-token UI amounts at today's prices; null when a needed price is missing. */
function usdAtToday(amounts, prices) {
  let usd = 0;
  for (const [t, v] of Object.entries(amounts)) {
    if (!v) continue;
    const price = prices?.[t];
    if (price == null) return null;
    usd += v * price;
  }
  return usd;
}

/**
 * @param {object} p
 * @param {{data, loading, error}} p.summary   useWalletSummary state
 * @param {object} p.rewards                   aggregateRewards result
 * @param {{done, progress: {done, total}, retrying?}} p.rewardsState  useFleetRewards state
 * @param {object} p.list                      aggregateHotspotList result
 * @param {object|null} p.governance           /ve-hnt/positions response
 * @param {boolean} p.govLoading
 * @param {string|null} p.govError
 * @param {object} p.mobile                    aggregateMobile result
 * @param {object} p.iotStatus                 aggregateIotStatus result
 * @param {boolean} p.iotDone                 IoT figures final (or a Retry of failed lookups runs)
 * @param {object} [p.freshness]               mobileFreshness result
 * @param {boolean} [p.fleetLoaded]            the fleet on screen is this wallet's
 * @param {boolean} [p.fleetFailed]            the fleet failed to load
 * @returns {{
 *   walletValue: { state: "loading"|"ready"|"failed", usd, split: [{ token, label, amount, usd, priceUsd,
 *                  legacy, ataEstablished }], zeroTokens: string[], caption, veLockedHnt, veExpiredHnt,
 *                  veCaptions: string[], pricesFetchedAt },
 *   unclaimed:   { state: "loading"|"scanning"|"ready"|"failed", hotspotsState (the same, plus "none"),
 *                  fleetFailed, hnt (Hotspots + veHNT), hotspotsHnt, veHnt, legacy: { iot, mobile },
 *                  usdToday (null when a price is missing), claimableHnt, cantClaimHnt, withPending,
 *                  checked, total, noOracle, sofar, veState: "loading"|"ready"|"failed" },
 *   earned:      { kind: "mobile"|"iot"|"none", latest: { day, hnt, usd, bytes, rewarded, of, state },
 *                  days (fleet 7, oldest first: { day, hnt, bytes, priceUsd, usd, rewarded, state }),
 *                  weekHnt, weekUsd, weekBytes, daysLoaded, gaps, rewardedRange: { first, last },
 *                  freshness, iot: { active, inactive, reported, total, messages30d, withTraffic, known,
 *                  day, through, failed, state: "loading"|"ready" } },
 *   lifetime:    { state, hnt, lowerBound, usdToday, claimed, unclaimed, legacy: { iot, mobile },
 *                  ever, never, total, sofar },
 *   prices
 * }}
 */
export function deriveMoney({
  summary,
  rewards,
  rewardsState,
  list,
  governance,
  govLoading,
  govError,
  mobile,
  iotStatus,
  iotDone,
  freshness = null,
  fleetLoaded = true,
  fleetFailed = false,
}) {
  const prices = summary?.data?.prices ?? null;
  const walletValue = walletValueOf(summary, governance);

  // ── Unclaimed ──
  const hotspotsState = rewardsScanState({ fleetLoaded, fleetFailed, rewards, rewardsState });
  const pending = rewards?.pendingUi ?? { hnt: 0, iot: 0, mobile: 0 };
  const claimable = rewards?.claimableUi ?? { hnt: 0, iot: 0, mobile: 0 };
  const veState = govLoading ? "loading" : govError ? "failed" : "ready";
  const veHnt = veState === "ready" ? govPendingHnt(governance) : null;
  const hotspotsKnown = hotspotsState === "ready" || hotspotsState === "scanning" || hotspotsState === "none";
  const hotspotsHnt = hotspotsKnown ? pending.hnt : null;
  const unclaimedState =
    hotspotsState === "none"
      ? veState === "loading"
        ? "loading"
        : veState === "failed"
          ? "failed"
          : "ready"
      : hotspotsState === "failed"
        ? fleetFailed && veState === "ready"
          ? "ready"
          : "failed"
        : hotspotsState;
  const unclaimedUsd =
    hotspotsKnown || veHnt != null
      ? usdAtToday({ hnt: (hotspotsHnt ?? 0) + (veHnt ?? 0), iot: pending.iot, mobile: pending.mobile }, prices)
      : null;
  let withPending = 0;
  for (const r of list?.rows || []) if (r.unclaimed.state === "ok" && r.unclaimed.hnt > 0) withPending++;
  const unclaimed = {
    state: unclaimedState,
    hotspotsState,
    fleetFailed: Boolean(fleetFailed),
    hnt: hotspotsHnt == null && veHnt == null ? null : (hotspotsHnt ?? 0) + (veHnt ?? 0),
    hotspotsHnt,
    veHnt,
    legacy: { iot: pending.iot, mobile: pending.mobile },
    usdToday: unclaimedUsd,
    claimableHnt: hotspotsKnown ? claimable.hnt : null,
    cantClaimHnt: hotspotsKnown ? Math.max(0, pending.hnt - claimable.hnt) : null,
    withPending,
    checked: rewardsState?.progress?.done ?? 0,
    total: rewardsState?.progress?.total ?? 0,
    noOracle: list?.totals?.unconfirmed ?? 0,
    sofar: hotspotsState === "scanning",
    veState,
  };

  // ── Earned (Mobile data transfer per UTC day, or IoT activity) ──
  const byNetwork = summary?.data?.fleet?.byNetwork;
  const kind = fleetLoaded
    ? (mobile?.mobileTotal ?? 0) > 0
      ? "mobile"
      : (iotStatus?.iotTotal ?? 0) > 0
        ? "iot"
        : "none"
    : (byNetwork?.mobile ?? 0) > 0
      ? "mobile"
      : (byNetwork?.iot ?? 0) > 0
        ? "iot"
        : "none";
  const mr = mobile?.rewards;
  const latestDay = mr?.latest ?? null;
  const days = mr
    ? [...mr.days].reverse().map((d) => ({
        day: d.day,
        hnt: d.state === "ok" ? d.hnt : null,
        bytes: d.state === "ok" ? d.bytes : null,
        priceUsd: d.priceUsd ?? null,
        usd: d.state === "ok" && d.priceUsd != null ? d.hnt * d.priceUsd : null,
        rewarded: d.state === "ok" ? (d.hotspots ?? null) : null,
        state: d.state,
      }))
    : [];
  const ok = days.filter((d) => d.state === "ok");
  const earned = {
    kind,
    latest: latestDay
      ? {
          day: latestDay.day,
          hnt: latestDay.state === "ok" ? latestDay.hnt : null,
          usd: mr.latestUsd,
          bytes: latestDay.state === "ok" ? latestDay.bytes : null,
          rewarded: latestDay.state === "ok" ? (latestDay.hotspots ?? null) : null,
          of: mobile.mobileTotal,
          state: latestDay.state,
        }
      : { day: null, hnt: null, usd: null, bytes: null, rewarded: null, of: mobile?.mobileTotal ?? 0, state: mobile?.failed?.rewards ? "failed" : "loading" },
    days,
    weekHnt: ok.length ? ok.reduce((s, d) => s + d.hnt, 0) : null,
    weekUsd: ok.length && ok.every((d) => d.usd != null) ? ok.reduce((s, d) => s + d.usd, 0) : null,
    weekBytes: ok.length ? ok.reduce((s, d) => s + d.bytes, 0) : null,
    daysLoaded: ok.length,
    gaps: days.filter((d) => d.state === "missing" || d.state === "failed").length,
    rewardedRange: days.length ? { first: days[0].day, last: days[days.length - 1].day } : null,
    freshness,
    iot: {
      active: iotStatus?.active ?? 0,
      inactive: iotStatus?.inactive ?? 0,
      reported: (iotStatus?.active ?? 0) + (iotStatus?.inactive ?? 0),
      total: iotStatus?.iotTotal ?? 0,
      messages30d: iotStatus?.traffic?.messages30d ?? 0,
      withTraffic: iotStatus?.traffic?.withTraffic ?? 0,
      known: iotStatus?.traffic?.known ?? 0,
      day: iotStatus?.livenessRange?.max ?? null,
      through: iotStatus?.trafficRange?.max ?? null,
      failed: iotStatus?.failed ?? 0,
      state: iotDone ? "ready" : "loading",
    },
  };

  // ── Lifetime ──
  const life = rewards?.lifetimeUi ?? { hnt: 0, iot: 0, mobile: 0 };
  const lifeState = hotspotsState === "none" ? "ready" : hotspotsState;
  const lifetime = {
    state: lifeState,
    hnt: hotspotsKnown ? life.hnt : null,
    lowerBound: (list?.totals?.unconfirmed ?? 0) > 0,
    usdToday: hotspotsKnown && prices?.hnt != null ? life.hnt * prices.hnt : null,
    claimed: hotspotsKnown ? Math.max(0, life.hnt - pending.hnt) : null,
    unclaimed: hotspotsKnown ? pending.hnt : null,
    legacy: { iot: life.iot, mobile: life.mobile },
    ever: rewards?.earning ?? 0,
    never: rewards?.idle ?? 0,
    total: rewardsState?.progress?.total ?? 0,
    sofar: hotspotsState === "scanning",
  };

  return { walletValue, unclaimed, earned, lifetime, prices };
}
