import { usdFormatter, numberFormatter, truncateString } from "../lib/utils.js";

export { truncateString };

/** Format a USD amount, with a dash for null and a floor for tiny values. */
export function fmtUsd(n, { dash = "—" } = {}) {
  if (n == null || Number.isNaN(n)) return dash;
  if (n === 0) return "$0.00";
  if (n > 0 && n < 0.01) return "<$0.01";
  return usdFormatter.format(n);
}

/** Format a token UI amount (already divided by decimals). */
export function fmtToken(uiAmount, { max = 4 } = {}) {
  if (uiAmount == null || Number.isNaN(uiAmount)) return "—";
  if (uiAmount === 0) return "0";
  if (uiAmount > 0 && uiAmount < 0.0001) return "<0.0001";
  return uiAmount.toLocaleString(undefined, { maximumFractionDigits: max });
}

/** Format an integer count with thousands separators. */
export function fmtCount(n) {
  return numberFormatter.format(n ?? 0);
}

/** "1 city" / "4 cities" — count + correctly-pluralized noun. */
export function plural(n, singular, pluralForm) {
  const count = n ?? 0;
  const word = count === 1 ? singular : pluralForm || `${singular}s`;
  return `${fmtCount(count)} ${word}`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** Format an ISO string, Date, or ms timestamp as a short date. (Unix seconds
 * must be ×1000 first — see fmtAgoSeconds.) */
export function fmtDate(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt.format(d);
}

/** Relative time from unix seconds (transactions) → "3h ago", "2d ago". */
export function fmtAgoSeconds(sec) {
  if (!sec) return "—";
  const diff = Math.floor(Date.now() / 1000 - sec);
  if (diff < 60) return `${Math.max(diff, 0)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(sec * 1000);
}

// Solana explorer (Solscan) links.
const SOLSCAN = "https://solscan.io";
export const txUrl = (sig) => `${SOLSCAN}/tx/${sig}`;
export const accountUrl = (addr) => `${SOLSCAN}/account/${addr}`;

// Per-token display metadata. Colors are inline hex (used for chips/dots/charts).
export const TOKEN_META = {
  hnt: { label: "HNT", color: "#0ea5b7" },
  mobile: { label: "MOBILE", color: "#7c3aed" },
  iot: { label: "IOT", color: "#059669" },
  sol: { label: "SOL", color: "#a855f7" },
  dc: { label: "DC", color: "#d97706" },
};

export const NETWORK_LABEL = { iot: "IoT", mobile: "Mobile" };
export const NETWORK_COLOR = { iot: "#059669", mobile: "#7c3aed" };

// Every label leads with its network (IoT… / Mobile…) so device type alone
// conveys the network — the table doesn't need a separate Network column.
export const DEVICE_LABEL = {
  iotDataOnly: "IoT Data-Only",
  iotFull: "IoT Full",
  iot: "IoT",
  mobile: "Mobile",
  cbrs: "Mobile CBRS",
  wifiIndoor: "Mobile WiFi Indoor",
  wifiOutdoor: "Mobile WiFi Outdoor",
  wifiDataOnly: "Mobile WiFi Data-Only",
};

/** Human label for a device-type key (falls back to the raw key). */
export function deviceLabel(key) {
  return DEVICE_LABEL[key] || key || "Unknown";
}

// ── IoT connectivity (api-iot.heliumtools.org) ───────────────────────────────
// Per-day granularity: "active" = connected to the Helium Packet Router during
// the liveness feed's most recent reported day, anchored to `dataThrough` (the
// feed's newest event timestamp) — not "online right now".

export const IOT_STATUS_LABEL = {
  active: "Active",
  inactive: "Inactive",
  settingUp: "Setting up",
  unknown: "Unknown",
};

// The canonical set of resolved verdicts `iotStatusOf` can settle on. Consumers
// keying per-surface maps (sort ranks, text classes, CSV names) key off these.
export const IOT_STATUSES = Object.keys(IOT_STATUS_LABEL);

// Dot/marker colors (shared by the table and the map, like NETWORK_COLOR).
export const IOT_STATUS_COLOR = {
  active: NETWORK_COLOR.iot,
  inactive: "#e11d48", // rose-600
  settingUp: "#d97706", // amber-600
  unknown: "#94a3b8", // slate-400
};

/**
 * Whether a fleet row participates in IoT connectivity at all — on the IoT
 * network AND addressable by entityKey. The fetch hook's eligibility filter and
 * `iotStatusOf`'s null-gate share this predicate so "pending" means exactly
 * "eligible for a lookup that hasn't resolved yet".
 */
export function hasIotStatus(hotspot) {
  return Boolean(hotspot?.entityKey) && (hotspot?.networks || []).includes("iot");
}

// `dataThrough` is one shared ISO string re-checked for every Hotspot — parse
// it once per value, not per call.
let dataThroughMemo = { iso: null, ms: NaN };
function dataThroughToMs(iso) {
  if (dataThroughMemo.iso !== iso) dataThroughMemo = { iso, ms: new Date(iso).getTime() };
  return dataThroughMemo.ms;
}

/**
 * Derive one Hotspot's IoT connectivity state from its api-iot lookup entry.
 *   "active" | "inactive" — the service's per-day liveness verdict
 *   "settingUp"           — created after `dataThrough`, so the feed hasn't
 *                           reported on it yet (per the API reference: treat as
 *                           setting up, not inactive)
 *   "unknown"             — lookup failed, or the address isn't in the
 *                           service's inventory
 *   "pending"             — not fetched yet (scan still running)
 *   null                  — no IoT status applies (see hasIotStatus)
 * Resolved verdicts are exactly the IOT_STATUSES keys. Invalid dates compare
 * false and simply fall through to inactive/unknown.
 */
export function iotStatusOf(hotspot, entry, dataThrough) {
  if (!hasIotStatus(hotspot)) return null;
  if (entry === undefined) return "pending";
  if (entry === null) return "unknown";
  if (!entry.notFound && entry.status === 0) return "active";
  if (
    dataThrough &&
    hotspot.createdAt &&
    new Date(hotspot.createdAt).getTime() > dataThroughToMs(dataThrough)
  ) {
    return "settingUp";
  }
  return entry.notFound ? "unknown" : "inactive";
}

/**
 * Aggregate per-Hotspot IoT connectivity into fleet counts for the tiles/hero.
 * `counted` excludes still-pending lookups so percentages stay honest during
 * the progressive scan.
 */
export function aggregateIotStatus(hotspots, statusByKey, dataThrough) {
  const agg = { iotTotal: 0, counted: 0 };
  for (const s of IOT_STATUSES) agg[s] = 0;
  for (const h of hotspots || []) {
    const s = iotStatusOf(h, statusByKey?.[h.entityKey], dataThrough);
    if (s === null) continue;
    agg.iotTotal++;
    if (s === "pending") continue;
    agg.counted++;
    agg[s]++;
  }
  return agg;
}

/** Reward-token decimals (IOT/MOBILE = 6, HNT = 8). */
export const REWARD_DECIMALS = { iot: 6, mobile: 6, hnt: 8 };

/** Data Credits peg: 100,000 DC = $1. */
export const DC_PER_USD = 100_000;

const REWARD_TOKENS = ["iot", "mobile", "hnt"];

function safeBig(s) {
  try {
    return BigInt(s ?? "0");
  } catch {
    return 0n;
  }
}

/** A Hotspot is "earning" if it has any lifetime rewards; else idle. */
export function isEarning(rewards) {
  if (!rewards) return null; // unknown (not yet loaded)
  return REWARD_TOKENS.some((t) => safeBig(rewards[t]?.lifetime) > 0n);
}

/** One Hotspot's lifetime rewards for a single token, as a UI number. */
export function lifetimeUi(rewards, token) {
  const raw = rewards?.[token]?.lifetime;
  return raw ? Number(raw) / 10 ** REWARD_DECIMALS[token] : 0;
}

/** Lifetime rewards in USD for one Hotspot (needs reward prices: {iot,mobile,hnt}). */
export function hotspotLifetimeUsd(rewards, prices) {
  if (!rewards) return null;
  let usd = 0;
  for (const t of REWARD_TOKENS) {
    const life = safeBig(rewards[t]?.lifetime);
    if (life === 0n) continue;
    const ui = Number(life) / 10 ** REWARD_DECIMALS[t];
    const price = prices?.[t];
    if (price != null) usd += ui * price;
  }
  return usd;
}

/**
 * Aggregate a rewardsByKey map into fleet totals. Returns UI-amount sums per
 * token for pending / lifetime / claimable, plus earning/idle counts. Tolerates
 * partial maps during progressive loading.
 */
export function aggregateRewards(rewardsByKey) {
  const pending = { iot: 0n, mobile: 0n, hnt: 0n };
  const lifetime = { iot: 0n, mobile: 0n, hnt: 0n };
  const claimable = { iot: 0n, mobile: 0n, hnt: 0n };
  let earning = 0;
  let idle = 0;
  let counted = 0;

  for (const r of Object.values(rewardsByKey)) {
    if (!r) continue;
    counted++;
    let life = 0n;
    for (const t of REWARD_TOKENS) {
      const tok = r[t];
      if (!tok) continue;
      const p = safeBig(tok.pending);
      const l = safeBig(tok.lifetime);
      pending[t] += p;
      lifetime[t] += l;
      if (tok.claimable) claimable[t] += p;
      life += l;
    }
    if (life > 0n) earning++;
    else idle++;
  }

  const toUi = (sums) =>
    Object.fromEntries(REWARD_TOKENS.map((t) => [t, Number(sums[t]) / 10 ** REWARD_DECIMALS[t]]));

  return {
    pendingUi: toUi(pending),
    lifetimeUi: toUi(lifetime),
    claimableUi: toUi(claimable),
    earning,
    idle,
    counted,
  };
}

/** Sum a per-token UI map to USD using reward prices {iot,mobile,hnt}. */
export function rewardUsd(uiByToken, prices) {
  let usd = 0;
  for (const t of REWARD_TOKENS) {
    const price = prices?.[t];
    if (price != null && uiByToken?.[t]) usd += uiByToken[t] * price;
  }
  return usd;
}

/**
 * Pending veHNT delegation rewards in HNT (UI units). Returns 0 when the wallet
 * holds no positions. Single source for the governance-totals access + position
 * guard so callers don't each re-derive it.
 */
export function govPendingHnt(governance) {
  const totals = governance?.totals;
  if (!totals || Number(totals.positionCount) <= 0) return 0;
  return Number(totals.pendingRewardsHnt || 0);
}

/**
 * USD value of pending veHNT delegation rewards (always paid in HNT post
 * HIP-138). Returns 0 when there are no positions or the HNT price isn't
 * loaded, so it folds cleanly into the headline unclaimed-rewards total.
 */
export function govPendingUsd(governance, prices) {
  const hnt = govPendingHnt(governance);
  const price = prices?.hnt;
  return price != null && hnt > 0 ? hnt * price : 0;
}

/**
 * Total unclaimed rewards in USD: Hotspot (fleet) pending + veHNT delegation
 * pending. The one definition of the dashboard's headline "Unclaimed" figure,
 * so the hero stat and the rewards card always agree on what it includes.
 */
export function unclaimedTotalUsd(rewards, governance, prices) {
  return rewardUsd(rewards?.pendingUi, prices) + govPendingUsd(governance, prices);
}
