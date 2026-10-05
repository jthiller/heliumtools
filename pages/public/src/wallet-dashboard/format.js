import { usdFormatter, numberFormatter, truncateString } from "../lib/utils.js";
import { DATA_DAY_RE } from "../lib/iotStatusApi.js";

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

const dateFmtUtc = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

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
// the liveness feed's most recent reported day — not "online right now". Its
// `dataThrough` is the END of that 24h window: name the day with
// `livenessDay()` + `fmtDataDay()`, never by formatting the timestamp.

export const IOT_STATUS_LABEL = {
  active: "Active",
  inactive: "Inactive",
  settingUp: "Setting up",
  unknown: "Unknown",
};

// The canonical set of resolved verdicts `iotStatusOf` can settle on (the
// IOT_STATUS_LABEL keys). Internal — consumers get the vocabulary via LABEL.
const IOT_STATUSES = Object.keys(IOT_STATUS_LABEL);

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

/**
 * Derive one Hotspot's IoT connectivity state from its api-iot lookup entry.
 *   "active" | "inactive" — the service's per-day liveness verdict
 *   "settingUp"           — created after the feed's newest data, so it hasn't
 *                           been reported on yet (per the API reference: treat
 *                           as setting up, not inactive)
 *   "unknown"             — lookup failed, or the address isn't in the
 *                           service's inventory
 *   "pending"             — not fetched yet (scan still running)
 *   null                  — no IoT status applies (see hasIotStatus)
 * Resolved verdicts are exactly the IOT_STATUS_LABEL keys. Invalid dates
 * compare false and simply fall through to inactive/unknown.
 */
export function iotStatusOf(hotspot, entry, dataThrough) {
  if (!hasIotStatus(hotspot)) return null;
  if (entry === undefined) return "pending";
  if (entry === null) return "unknown";
  if (!entry.notFound && entry.status === 0) return "active";
  // Anchor "created after the feed" to the dataThrough this entry was computed
  // against; the fleet-wide anchor is only a fallback (404 entries carry none).
  // Mixing them would mispair verdict and anchor when a scan spans a feed-day
  // rollover (per-address edge caches expire independently).
  const anchor = entry.dataThrough ?? dataThrough;
  if (anchor && hotspot.createdAt && new Date(hotspot.createdAt).getTime() > new Date(anchor).getTime()) {
    return "settingUp";
  }
  return entry.notFound ? "unknown" : "inactive";
}

// ── IoT traffic (delivered messages) ─────────────────────────────────────────
// The same api-iot gateway record carries a `utilization` block: delivered
// LoRaWAN messages over the 30 data days ending its own `dataThrough` (a
// YYYY-MM-DD data day). Messages are what data-transfer rewards are based on,
// but a count is NOT a reward amount, NOT DC, and NOT unique device messages
// (multi-buy: one device message delivered by several Hotspots counts at each).

const DAY_MS = 86_400_000;

/** The messages caveat, worded once for every surface (card, table, detail,
 * agent tools). */
export const IOT_MESSAGES_NOTE =
  "Delivered LoRaWAN messages. Data-transfer rewards are based on them, but a count isn't a reward amount, DC, or unique device messages: with multi-buy, a device message delivered by several Hotspots counts at each.";

/** What Active/Inactive means, worded once. */
export const IOT_CONNECTIVITY_NOTE =
  "Active means connected to the Helium Packet Router on the latest reported (UTC) day, not online right now.";

/**
 * The UTC data day ("YYYY-MM-DD") a liveness `dataThrough` reports on. The
 * anchor marks the END of the 24h liveness window (helium-iot-service
 * src/sync/liveness.ts), so "2026-10-04T00:00:00.109Z" describes Oct 3 UTC —
 * the same day the utilization block's `dataThrough` names.
 */
export function livenessDay(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t - DAY_MS).toISOString().slice(0, 10);
}

const dayFmtShort = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** "Oct 3" (or "Oct 3, 2026" with `year`) for a YYYY-MM-DD data day, in UTC
 * so a viewer west of UTC never sees the previous day. */
export function fmtDataDay(day, { year = false } = {}) {
  if (!day || !DATA_DAY_RE.test(day)) return "—";
  const d = new Date(`${day}T00:00:00Z`);
  return year ? dateFmtUtc.format(d) : dayFmtShort.format(d);
}

/** "Oct 3" for a {min,max} day range, or "Oct 2–3" style when the rows
 * disagree (e.g. a returning visitor's browser holds some older records). */
export function fmtDayRange(range, opts) {
  if (!range?.min) return "—";
  if (range.min === range.max) return fmtDataDay(range.min, opts);
  return `${fmtDataDay(range.min)}–${fmtDataDay(range.max, opts)}`;
}

const compactFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** Exact below 1,000, then compact with one decimal (1.9K, 10.5K, 45.4M). */
export function fmtCompact(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n < 1000 ? fmtCount(n) : compactFmt.format(n);
}

/** The partial-window caveat: totals over fewer than `days` reported days. */
export function fmtLowerBound(daysComplete, days) {
  return `Based on ${daysComplete} of ${days} reported days; totals are a lower bound.`;
}

/**
 * The utilization index, if it describes the build behind `dataThrough` (a
 * data day); else null. Another build's missing days would mark the wrong
 * days, and its 7-day per-OUI stats could contradict a row's own counts.
 */
export function indexForBuild(index, dataThrough) {
  return index?.published && dataThrough && index.dataThrough === dataThrough ? index : null;
}

/**
 * One Hotspot's 30-day traffic from its api-iot lookup entry:
 *   null           — not an IoT Hotspot (see hasIotStatus)
 *   "pending"      — lookup not resolved yet
 *   "unavailable"  — lookup failed / 404 / a transient or malformed block
 *   "unpublished"  — the service's utilization layer isn't published
 *   object         — the stored `{packets30d, ouis, dataThrough}` block,
 *                    returned BY REFERENCE (iotStatusApi freezes it once per
 *                    record) so memoized rows can compare it by identity.
 * A `packets30d` of 0 is a real zero — the Hotspot delivered nothing.
 */
export function iotTrafficOf(hotspot, entry) {
  if (!hasIotStatus(hotspot)) return null;
  if (entry === undefined) return "pending";
  if (entry === null || entry.notFound) return "unavailable";
  if (entry.utilizationState === "ok" && entry.utilization) return entry.utilization;
  return entry.utilizationState === "unpublished" ? "unpublished" : "unavailable";
}

/** Why there's no traffic figure, per non-block `iotTrafficOf` result. */
export const IOT_TRAFFIC_STATE_NOTE = {
  pending: "Checking traffic…",
  unavailable: "Traffic data unavailable.",
  unpublished: "Traffic data isn't published right now.",
};

/** Whether `iotTrafficOf` resolved to a usable block. */
export const isTrafficKnown = (traffic) => traffic != null && typeof traffic === "object";

// Health = connectivity × 30-day traffic. Only resolved active/inactive rows
// with a known traffic block get one. Listed in urgency order; `color` is the
// dot/chip color, `textClass` the text tone.
export const IOT_HEALTH = {
  inactiveTraffic: {
    label: "Inactive · had traffic",
    csv: "inactive_had_traffic",
    color: IOT_STATUS_COLOR.inactive,
    textClass: "text-rose-600 dark:text-rose-400",
    hint: "Not connected on the latest reported day, but delivered messages within the 30-day window. The Hotspots most worth checking first.",
  },
  activeQuiet: {
    label: "Active · no traffic",
    csv: "active_no_traffic",
    color: IOT_STATUS_COLOR.settingUp, // amber
    textClass: "text-amber-600 dark:text-amber-400",
    hint: "Connected, but delivered no messages in 30 days. Check antenna and placement, or there may be no devices nearby.",
  },
  inactiveQuiet: {
    label: "Inactive · no traffic",
    csv: "inactive_no_traffic",
    color: "#94a3b8", // slate-400
    textClass: "text-content-tertiary",
    hint: "Not connected on the latest reported day, and no messages in 30 days.",
  },
  activeTraffic: {
    label: "Active · with traffic",
    csv: "active_with_traffic",
    color: NETWORK_COLOR.iot,
    // Neutral, not green: a 30-day total can't confirm traffic is still flowing.
    textClass: "text-content",
    hint: "Connected, and delivered messages within the 30-day window. A 30-day total can't confirm traffic is still flowing; open the Hotspot for its daily chart.",
  },
};
export const IOT_HEALTH_ORDER = Object.keys(IOT_HEALTH);

/**
 * Combine an `iotStatusOf` verdict with an `iotTrafficOf` result. Returns an
 * IOT_HEALTH key, or null when either half isn't resolved (pending, unknown,
 * setting up, unpublished/unavailable traffic, non-IoT).
 */
export function iotHealthOf(status, traffic) {
  if (status !== "active" && status !== "inactive") return null;
  if (!isTrafficKnown(traffic)) return null;
  const had = traffic.packets30d > 0;
  if (status === "active") return had ? "activeTraffic" : "activeQuiet";
  return had ? "inactiveTraffic" : "inactiveQuiet";
}

// "Most actionable first", the one definition (table Status sort, agent tool
// rows): the health states in IOT_HEALTH order, a bare connectivity verdict
// (traffic not known) beside its no-traffic twin, then unresolved lookups.
const ACTION_RANK = {
  inactiveTraffic: 0,
  activeQuiet: 1,
  inactiveQuiet: 2,
  inactive: 2,
  settingUp: 3,
  unknown: 4,
  activeTraffic: 5,
  active: 5,
  pending: 6,
};

/** Sort rank for a row's (status, health); non-IoT rows rank last. */
export function iotActionRank(status, health) {
  return ACTION_RANK[health] ?? ACTION_RANK[status] ?? 99;
}

/**
 * One fleet row's IoT verdicts, derived once per scan flush (by
 * `aggregateIotStatus`, whose `rows` every surface reads) so the table, map,
 * card and agent tools can't disagree. Null for a non-IoT row.
 *   status   — iotStatusOf verdict      traffic — iotTrafficOf result
 *   health   — iotHealthOf key | null   messages — 30-day count when known (0 is real)
 *   anchor   — the liveness dataThrough behind an active/inactive verdict
 *              (name its day with livenessDay), else null
 *   hex      — the service's asserted res-12 cell, or null
 */
export function iotRowOf(hotspot, entry, dataThrough) {
  const status = iotStatusOf(hotspot, entry, dataThrough);
  if (status === null) return null;
  const traffic = iotTrafficOf(hotspot, entry);
  return {
    status,
    traffic,
    health: iotHealthOf(status, traffic),
    messages: isTrafficKnown(traffic) ? traffic.packets30d : null,
    anchor: status === "active" || status === "inactive" ? (entry?.dataThrough ?? null) : null,
    hex: entry?.hex ?? null,
  };
}

const nameCollator = new Intl.Collator();

/** Comparator for `{hotspot, row}` entries: most messages first, then name. */
export function byMessagesDesc(a, b) {
  return (b.row.messages ?? -1) - (a.row.messages ?? -1) || nameCollator.compare(a.hotspot.name || "", b.hotspot.name || "");
}

/**
 * Aggregate per-Hotspot IoT connectivity + traffic for the whole dashboard —
 * one pass per scan flush. `counted` excludes still-pending lookups so
 * percentages stay honest during the progressive scan.
 *
 * `rows`: Map entityKey → iotRowOf row, for every IoT Hotspot (pending too).
 * `groups`: {IOT_HEALTH key: [{hotspot, row}]} in fleet order (sort what you show).
 * `traffic`: { known, withTraffic, messages30d, unavailable, unpublished,
 *   statusNoData, health: {IOT_HEALTH key: count} }. `statusNoData` counts
 *   active/inactive rows whose traffic isn't known, so
 *   health.activeTraffic + health.activeQuiet + (active rows without data) =
 *   the Active count. If a scan mixes "ok" and "unpublished" rows (a stale
 *   browser-cached record or a publish landing mid-scan), the unpublished ones
 *   become unavailable — in the counts AND their rows — since the layer is
 *   evidently published.
 * `livenessRange` / `trafficRange`: {min,max} data days across reported rows.
 */
export function aggregateIotStatus(hotspots, statusByKey, dataThrough) {
  const agg = { iotTotal: 0, counted: 0 };
  for (const s of IOT_STATUSES) agg[s] = 0;
  const rows = new Map();
  const groups = Object.fromEntries(IOT_HEALTH_ORDER.map((k) => [k, []]));
  const traffic = {
    known: 0,
    withTraffic: 0,
    messages30d: 0,
    unavailable: 0,
    unpublished: 0,
    statusNoData: 0,
    health: Object.fromEntries(IOT_HEALTH_ORDER.map((k) => [k, 0])),
  };
  // Liveness anchors are ISO strings (they order lexicographically): track the
  // raw extremes and name their days once, not per row.
  let livMin = null, livMax = null, trMin = null, trMax = null;
  for (const h of hotspots || []) {
    const row = iotRowOf(h, statusByKey?.[h.entityKey], dataThrough);
    if (row === null) continue;
    rows.set(h.entityKey, row);
    agg.iotTotal++;
    if (row.status === "pending") continue;
    agg.counted++;
    agg[row.status]++;
    if (row.anchor) {
      if (!livMin || row.anchor < livMin) livMin = row.anchor;
      if (!livMax || row.anchor > livMax) livMax = row.anchor;
    }
    const t = row.traffic;
    if (isTrafficKnown(t)) {
      traffic.known++;
      if (t.packets30d > 0) {
        traffic.withTraffic++;
        traffic.messages30d += t.packets30d;
      }
      if (!trMin || t.dataThrough < trMin) trMin = t.dataThrough;
      if (!trMax || t.dataThrough > trMax) trMax = t.dataThrough;
      if (row.health) {
        traffic.health[row.health]++;
        groups[row.health].push({ hotspot: h, row });
      }
    } else {
      if (t === "unpublished") traffic.unpublished++;
      else if (t === "unavailable") traffic.unavailable++;
      if (row.status === "active" || row.status === "inactive") traffic.statusNoData++;
    }
  }
  if (traffic.known > 0 && traffic.unpublished > 0) {
    traffic.unavailable += traffic.unpublished;
    traffic.unpublished = 0;
    for (const [key, row] of rows) {
      if (row.traffic === "unpublished") rows.set(key, { ...row, traffic: "unavailable" });
    }
  }
  agg.rows = rows;
  agg.groups = groups;
  agg.traffic = traffic;
  agg.livenessRange = livMin ? { min: livenessDay(livMin), max: livenessDay(livMax) } : null;
  agg.trafficRange = trMin ? { min: trMin, max: trMax } : null;
  return agg;
}

// ── One Hotspot's daily traffic by operator (OUI) ────────────────────────────

/** Categorical series slots for the per-OUI stacked chart; the tail folds
 * into "Other". Five, so no series hue collides with the dashboard's
 * reserved IoT green / Mobile violet / Inactive rose. */
export const OUI_SERIES_MAX = 5;

/** Display name for a labeled OUI (see lib/wellKnownOuis `labelOuis`). */
function ouiDisplayName(o) {
  if (!o?.shortName) return `OUI ${o?.oui}`;
  return o.duplicate ? `${o.shortName} #${o.oui}` : o.shortName;
}

function addDays(day, n) {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Reduce a `fetchGatewayUtilizationDetail` detail to what the per-Hotspot
 * traffic view (and its agent tool) renders.
 *
 * @param detail  normalized detail ({dataThrough, window, packets*, ouis, daily})
 * @param labels  output of `labelOuis(ids, names)` for the detail's OUIs, any order
 * @param index   `fetchUtilizationIndex()` result (or null). Its missingDays and
 *                per-OUI network stats apply only to the same build
 *                (`indexForBuild`).
 *
 * `missingKnown` is false when the window is partial but the index can't say
 * which days are missing: a zero day may then be unreported, so the UI must
 * not present it as a confirmed zero.
 *
 * @returns
 *   { kind: "empty", dataThrough, window, isPartial }   — no messages in the window
 *   { kind: "ready", dataThrough, window, isPartial, missingKnown, total,
 *     packets7d, packets1d, lastDay, quietLast7, recentShare, missing7, hasMissing,
 *     ouis: [{oui, fullName, shortName, duplicate, name, slot|null, packets30d,
 *             packets7d, daysActive30d, firstDay, lastDay, share, quietNetworkWide}],
 *     series: [{key, slot|null, name, ouiIds:number[], packets30d}],  // stack order, bottom first
 *     days: [{day, missing, total, values: {seriesKey: n}, byOui: {oui: n}}] }  // window.start..end
 *
 * A day's `missing` means the index lists it as unreported AND it has no
 * rows — draw it as "no data", never 0. `slot` is the categorical color index
 * (0-based) or null for "Other". Colors follow each OUI's rank WITHIN this
 * Hotspot (largest = slot 0), matching the legend; the legend always names them.
 */
export function deriveTrafficDetail(detail, labels, index) {
  const { dataThrough, window } = detail;
  const isPartial = window.daysComplete < window.days;
  const build = indexForBuild(index, dataThrough);
  const listedMissing = new Set(build?.missingDays || []);

  const sorted = [...detail.ouis].sort((a, b) => b.packets30d - a.packets30d || a.oui - b.oui);
  const total = sorted.reduce((s, o) => s + o.packets30d, 0);
  if (total === 0) return { kind: "empty", dataThrough, window, isPartial };

  const labelByOui = new Map((labels || []).map((l) => [l.oui, l]));
  const colored = Math.min(sorted.length, OUI_SERIES_MAX);

  const ouis = sorted.map((o, i) => {
    const l = labelByOui.get(o.oui) || { oui: o.oui, fullName: null, shortName: null, duplicate: false };
    const net = build?.ouiStats.get(o.oui);
    return {
      ...o,
      fullName: l.fullName,
      shortName: l.shortName,
      duplicate: l.duplicate,
      name: ouiDisplayName(l),
      slot: i < colored ? i : null,
      share: o.packets30d / total,
      // The OUI delivered nowhere on the network in the last 7 days (but did
      // within 30): a drop that's the operator's, not this Hotspot's.
      quietNetworkWide: net ? o.packets7d === 0 && net.gateways7d === 0 && (net.gateways30d || 0) > 0 : null,
    };
  });

  const series = ouis.slice(0, colored).map((o) => ({
    key: `oui-${o.oui}`,
    slot: o.slot,
    name: o.name,
    ouiIds: [o.oui],
    packets30d: o.packets30d,
  }));
  // The tail past the color slots folds into "Other" — together with any OUI
  // that has daily rows but no summary row (not expected, but they're separate
  // arrays), so every column stacks to its total.
  const listed = new Set(sorted.map((o) => o.oui));
  const strays = [...new Set(detail.daily.map((r) => r.oui).filter((id) => !listed.has(id)))];
  const otherIds = [...ouis.slice(colored).map((o) => o.oui), ...strays];
  if (otherIds.length) {
    series.push({
      key: "other",
      slot: null,
      name: `Other (${plural(otherIds.length, "OUI")})`,
      ouiIds: otherIds,
      packets30d: ouis.slice(colored).reduce((s, o) => s + o.packets30d, 0),
    });
  }
  const seriesKeyByOui = new Map();
  for (const s of series) for (const id of s.ouiIds) seriesKeyByOui.set(id, s.key);

  // Zero-fill every day of the window: the service's daily rows are sparse.
  const byDay = new Map();
  for (let day = window.start, i = 0; day <= window.end && i < 400; day = addDays(day, 1), i++) {
    byDay.set(day, { day, missing: false, total: 0, values: {}, byOui: {} });
  }
  for (const r of detail.daily) {
    const d = byDay.get(r.day);
    if (!d || r.packets <= 0) continue;
    const key = seriesKeyByOui.get(r.oui);
    d.values[key] = (d.values[key] || 0) + r.packets;
    d.byOui[r.oui] = (d.byOui[r.oui] || 0) + r.packets;
    d.total += r.packets;
  }
  const days = [...byDay.values()];
  for (const d of days) d.missing = d.total === 0 && listedMissing.has(d.day);

  const lastDay = ouis.reduce((m, o) => (o.lastDay && (!m || o.lastDay > m) ? o.lastDay : m), null);
  const missing7 = days.slice(-7).filter((d) => d.missing).length;

  // Last 7 days' average per day vs the 30-day average per complete day.
  // Only when it can be stated honestly: enough traffic, enough active days,
  // and the last 7 days known complete.
  let recentShare = null;
  const activeDays = days.filter((d) => d.total > 0).length;
  const last7Complete = build ? missing7 === 0 : !isPartial;
  if (total >= 100 && activeDays >= 7 && last7Complete && window.daysComplete > 0) {
    recentShare = (detail.packets7d / 7) / (total / window.daysComplete);
  }

  return {
    kind: "ready",
    dataThrough,
    window,
    isPartial,
    // A complete window has no unreported days, whatever the index says.
    missingKnown: Boolean(build) || !isPartial,
    total,
    packets7d: detail.packets7d,
    packets1d: detail.packets1d,
    lastDay,
    quietLast7: detail.packets7d === 0,
    recentShare,
    missing7,
    hasMissing: days.some((d) => d.missing),
    ouis,
    series,
    days,
  };
}

// ── Modeled coverage (selected Hotspot) ──────────────────────────────────────

/** The footprint's drawn RSSI range (dBm). Model v3 tops out near −85 and its
 * median cell sits near −131 (helium-iot-service docs/RF-MODEL.md), so cells
 * below −130 are dropped as near-noise-floor haze. */
export const COVERAGE_RSSI_MIN = -130;
export const COVERAGE_RSSI_MAX = -90;

/**
 * The gain/elevation the coverage model actually ran with, from the asserted
 * on-chain values (helium-iot-service docs/RF-MODEL.md "Inputs"): gain is
 * `clamp(gain ?? 12, 10, 150)` tenths of a dBi; elevation is
 * `clamp(elev ?? 0, 0, 50)` m with a hard 1.5 m antenna floor. Returns the
 * modeled values and whether each differs from the asserted one.
 */
export function modeledCoverageInputs(gain, elevation) {
  const g = Number.isFinite(gain) ? gain : null;
  const e = Number.isFinite(elevation) ? elevation : null;
  const modeledGain = Math.min(150, Math.max(10, g ?? 12));
  const modeledElevation = Math.max(1.5, Math.min(50, e ?? 0));
  return {
    gain: modeledGain,
    elevation: modeledElevation,
    gainAdjusted: g !== modeledGain,
    elevationAdjusted: e !== modeledElevation,
  };
}

/** On-chain IoT antenna gain is stored in tenths of a dBi (Update Location
 * divides by 10 too). */
export function fmtGainDbi(gain) {
  if (!Number.isFinite(gain)) return "—";
  return `${(gain / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} dBi`;
}

/** Elevation in meters above ground (one decimal at most: the model's 1.5 m floor). */
export function fmtElevationM(elevation) {
  if (!Number.isFinite(elevation)) return "—";
  return `${elevation.toLocaleString(undefined, { maximumFractionDigits: 1 })} m`;
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
