// ── Mobile activity (useMobileActivity) ─────────────────────────────────────
// Derivations over the hook's contract. Windows are the engine's, named
// honestly: heartbeats and rejected heartbeats over 60 min (never "online
// now"), speedtest averages over 24 h, rewards per UTC day, usage for one UTC
// day. A sliding window ends at now only while its table is fresh; otherwise
// it is named by when it ended ("in the 60 min to 3:42 PM", see windowText).
// Hotspots earn HNT: rewards lead with HNT. Data-transfer HNT is paid per
// rewarded byte, so location trust, the speedtest multiplier and heartbeats
// don't change it: they are WiFi health signals, never earnings problems.
import { FRESH_MS, SLIDING_TABLES, isWindowCurrent, windowLength } from "./mobile/tableMeta.js";

/**
 * A fleet row that earns on the Mobile network, addressable by entity key.
 * Gate on `networks` (a dual-network row's `deviceType` is its IoT one), and
 * leave out ecc_compact keys (`11…`, e.g. CBRS radios): only 366-char RSA keys
 * (WiFi indoor/outdoor) and 51-char ed25519 keys (WiFi data-only) appear in
 * the Mobile reward, usage and heartbeat tables.
 */
export function isMobileHotspot(hotspot) {
  const key = hotspot?.entityKey;
  return Boolean(key) && (hotspot.networks || []).includes("mobile") && !key.startsWith("11");
}

/**
 * Whether a Mobile Hotspot heartbeats and runs speedtests: WiFi indoor and
 * outdoor Hotspots, the ones with RSA keys (366 chars; anything over 100).
 * Data-only Hotspots (51-char ed25519 keys) send neither.
 */
export function isHeartbeatEligible(hotspot) {
  return isMobileHotspot(hotspot) && hotspot.entityKey.length > 100;
}

// ── Sliding windows ─────────────────────────────────────────────────────────

/** A sliding table's window length as the labels say it: "60 min", "24 h". */
function lengthText(name) {
  const { minutes, hours } = windowLength(name);
  return minutes ? `${minutes} min` : `${hours} h`;
}

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayClockFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const sameLocalDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * How a sliding section's window is named, from its `until`. While the window
 * ends at about now (isWindowCurrent): `long` "in the last 60 min", `span`
 * "last 60 min", `short` "60 min". Frozen (its latest check failed or is
 * overdue, the page was hidden, or it's the saved paint): by its end, local
 * time with the date when not today, `long` "in the 60 min to 3:42 PM",
 * `span` and `short` "60 min to 3:42 PM". A section not loaded reads current.
 */
export function windowText(name, until, now) {
  const len = lengthText(name);
  if (until == null || isWindowCurrent(until, now)) {
    return { current: true, until: until ?? null, long: `in the last ${len}`, span: `last ${len}`, short: len };
  }
  const end = (sameLocalDay(until, now) ? clockFmt : dayClockFmt).format(new Date(until));
  const short = `${len} to ${end}`;
  return { current: false, until, long: `in the ${short}`, span: short, short };
}

/**
 * When a window label next changes with no new data (a current window goes
 * stale, or a frozen one's end needs its date after midnight), in ms; null if
 * never. useMobileActivity moves its `asOf` then, since no post announces it.
 */
export function nextWindowFlip(activity, now) {
  let next = null;
  for (const name of SLIDING_TABLES) {
    const until = activity?.tables?.[name]?.until;
    if (until == null) continue;
    let at;
    if (isWindowCurrent(until, now)) at = until + FRESH_MS + 1;
    else if (sameLocalDay(until, now)) at = new Date(now).setHours(24, 0, 0, 0);
    else continue;
    if (next == null || at < next) next = at;
  }
  return next;
}

// ── Issues ──────────────────────────────────────────────────────────────────

// The amber issues' styling: WiFi health signals, not earnings problems.
const CAUTION = {
  color: "#d97706", // amber-600
  textClass: "text-amber-600 dark:text-amber-400",
  tone: "caution",
};

/**
 * Per-Hotspot issues, most actionable first. `color` is the dot color,
 * `textClass` the text tone, `tone` the NameCallout tone ("warn" for the one
 * serious issue, "caution" for the WiFi signals, which don't change HNT from
 * data transfer). `wifi`: applies only to WiFi indoor/outdoor Hotspots.
 * `table`: the table behind it. `window`: the sliding section it's named by;
 * `text(w)` words it for that window (see windowText): `label` for the card's
 * rows and callouts, `chip` for the table's filter chips and status cells,
 * `hint` for their tooltips. Surfaces read the wording from
 * `aggregateMobile(...).issueText`, which names the windows as they stand.
 */
export const MOBILE_ISSUES = {
  banned: {
    color: "#e11d48", // rose-600
    textClass: "text-rose-600 dark:text-rose-400",
    tone: "warn",
    wifi: false,
    table: "bans",
    window: null,
    text: () => ({
      label: "Banned",
      chip: "Banned",
      hint: "The Hotspot's latest ban record is a ban. Its message gives the reason.",
    }),
  },
  noHeartbeat: {
    ...CAUTION,
    wifi: true,
    table: "heartbeats",
    window: "heartbeats",
    text: (w) => ({
      label: `No heartbeat ${w.long}`,
      chip: `No heartbeat (${w.short})`,
      hint: `No heartbeat received from this WiFi Hotspot ${w.long}. HNT from data transfer doesn't depend on heartbeats.`,
    }),
  },
  lowTrust: {
    ...CAUTION,
    wifi: true,
    table: "heartbeats",
    window: "heartbeats",
    text: (w) => ({
      label: "Location trust below 1 (latest heartbeat)",
      chip: "Location trust below 1",
      hint: `The latest heartbeat ${w.long} has a location trust multiplier below 1. HNT from data transfer is paid per rewarded byte and doesn't use it.`,
    }),
  },
  lowSpeedtest: {
    ...CAUTION,
    wifi: true,
    table: "speedtests",
    window: "speedtests",
    text: (w) => ({
      label: `Speedtest multiplier below 1 (${w.span})`,
      // "×1" so it can't read as a speed below 1 Mbps.
      chip: `Speedtest below ×1 (${w.short})`,
      hint: `The latest speedtest average reported ${w.long} has a multiplier below 1. HNT from data transfer is paid per rewarded byte and doesn't use it.`,
    }),
  },
  rejectedHeartbeats: {
    ...CAUTION,
    wifi: true,
    table: "invalidHeartbeats",
    window: "invalidHeartbeats",
    // Worded as a Hotspot's state, so its count reads as Hotspots.
    text: (w) => ({
      label: `Rejected heartbeat ${w.long}`,
      chip: `Rejected heartbeat (${w.short})`,
      hint: `At least one heartbeat rejected ${w.long}, for example from an unsupported location. HNT from data transfer doesn't depend on heartbeats.`,
    }),
  },
};
export const MOBILE_ISSUE_ORDER = Object.keys(MOBILE_ISSUES);

// One object per distinct wording, so memoized rows see the same object until
// the wording itself changes.
const textCache = new Map();
function issueTextFor(key, w) {
  const id = `${key}|${w?.long ?? ""}`;
  let t = textCache.get(id);
  if (!t) {
    if (textCache.size > 200) textCache.clear();
    t = MOBILE_ISSUES[key].text(w);
    textCache.set(id, t);
  }
  return t;
}

/**
 * A Mobile row's place in "most actionable first": its first issue's index in
 * MOBILE_ISSUE_ORDER, then rows with no issue (or not loaded yet); 99 for a
 * Hotspot that isn't on Mobile. The table's Status sort and the agent tool share it.
 */
export function mobileActionRank(row) {
  if (!row) return 99;
  return row.issue ? MOBILE_ISSUE_ORDER.indexOf(row.issue) : MOBILE_ISSUE_ORDER.length;
}

const LOCATION_SOURCE_LABEL = { asserted: "Asserted", gps: "GPS", skyhook: "Skyhook" };

/** Where a heartbeat's position came from (`location_source`): "GPS"; an
 * unknown source as given. */
export const fmtLocationSource = (source) => LOCATION_SOURCE_LABEL[source] || source;

/** "Unsupported location" for a snake_case reason ("unsupported_location",
 * "ban_reason_data_farming" → "Data farming"). */
export function fmtReason(reason) {
  if (!reason) return "";
  const words = String(reason).replace(/^ban_reason_/, "").replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Bits per second → "13.7 Mbps" / "150 Mbps". */
export function fmtMbps(bps) {
  if (bps == null || !Number.isFinite(bps)) return "—";
  const mbps = bps / 1e6;
  return `${mbps.toLocaleString(undefined, { maximumFractionDigits: mbps < 10 ? 1 : 0 })} Mbps`;
}

/** Meters → "31 m" / "1.2 km". */
export function fmtMeters(m) {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
}

/** A 0-1 multiplier (location trust, speedtest) → "1.00", "0.25". */
export function fmtMultiplier(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(2);
}

/**
 * Whether a table's check failed with its data not in, per section: a quiet
 * "Couldn't load" rather than a perpetual loading mark. Shown data (a last
 * good check, a saved paint) is never "failed". `activity.phase === "error"`
 * also covers a worker that failed outright (no tables at all).
 */
function failedTables(activity, loaded) {
  const out = {};
  for (const name of Object.keys(loaded)) {
    out[name] =
      !loaded[name] && (activity?.phase === "error" || activity?.tables?.[name]?.state === "error");
  }
  return out;
}

/**
 * One derivation of the whole Mobile picture per activity update (like
 * `aggregateIotStatus`): every surface (card, table filter, map panel, agent
 * tool) reads this object rather than re-deriving per row. `now` names the
 * sliding windows (see windowText): the hook's `asOf` for the page.
 *
 * `rows`: Map entityKey → row, for every Mobile Hotspot. Fields are null while
 *   their table hasn't loaded (unknown, never "no"), or don't apply:
 *   wifi                 heartbeat-eligible (WiFi indoor/outdoor)
 *   heartbeating         WiFi: any heartbeat in the 60-min window
 *   heartbeats           WiFi: count in the window
 *   lastHeartbeatAt, trust, distance (m), locationSource, assertedCell,
 *   points               from the latest heartbeat / reported positions
 *   speedtest            latest 24-h average {down, up, latency, multiplier,
 *                        samples, at}; speedtestMultiplier
 *   banned, ban          latest ban record ({at, reason, message})
 *   rejectedHeartbeats, rejectedReasons   WiFi: rejected in the window
 *   hntLatestDay, bytesLatestDay          rewards (HNT, rewarded bytes) on the
 *                                         newest UTC day (0 = none)
 *   usageReported        the usage day has a row for this Hotspot (null:
 *                        usage not loaded)
 *   users                users served on the usage day; null without a row
 *                        (not reported is unknown, never 0)
 *   issues, issue        MOBILE_ISSUE_ORDER keys that apply / the first
 * `groups`: {issue: [{hotspot, row}]} in fleet order.
 * `counts`: per issue, plus heartbeating, heartbeatChecked (WiFi rows with the
 *   window loaded), rewarded (Hotspots with HNT on the newest day), withIssues.
 * `rewards`: { days, latest, latestUsd (latest HNT at that day's price),
 *   weekHnt (over loaded days), daysLoaded } | null. "Rewarded data" is
 *   `latest.bytes`: the bytes behind the HNT, from the same table and day.
 * `usage`: { day, hotspots (with a row), users, coverage } | null. Users are
 *   summed across Hotspots: a user served by two counts twice. `coverage`:
 *   { reported, rewarded }, the Hotspots rewarded on the usage day and how
 *   many of them it has a row for; null when that day's rewards per Hotspot
 *   aren't known.
 * `windows`: { heartbeats, invalidHeartbeats, speedtests } → windowText.
 * `issueText`: { [issue]: { label, chip, hint } } worded for those windows.
 * `loaded`: per table, whether its data is in (so a missing row is a real
 *   "none", not "not loaded yet"); `failed`: per table, its check failed
 *   with no data in.
 * `known`: per issue, whether its count is real: every table behind it is
 *   in, or it's a WiFi issue and the fleet has no WiFi Hotspots (a real 0).
 */
export function aggregateMobile(hotspots, activity, now) {
  const rows = new Map();
  const groups = Object.fromEntries(MOBILE_ISSUE_ORDER.map((k) => [k, []]));
  const counts = {
    ...Object.fromEntries(MOBILE_ISSUE_ORDER.map((k) => [k, 0])),
    heartbeating: 0,
    heartbeatChecked: 0,
    rewarded: 0,
    withIssues: 0,
  };
  let mobileTotal = 0;
  let wifiTotal = 0;

  const hb = activity?.heartbeats?.byKey;
  const inv = activity?.invalidHeartbeats?.byKey;
  const st = activity?.speedtests?.byKey;
  const bans = activity?.bans?.byKey;
  const days = activity?.rewards?.days ?? [];
  const latest = days[0] ?? null;
  // A large fleet's saved paint keeps only the daily totals (byKey emptied):
  // per-Hotspot HNT is unknown then, not zero.
  const allByKey = activity?.rewards?.byKey;
  const keyed = (day) => day?.state === "ok" && (!(day.hotspots > 0) || Object.keys(allByKey || {}).length > 0);
  const rewardsByKey = keyed(latest) ? allByKey || {} : null;
  const usageByKey = activity?.usage?.byKey;

  let usage = null;
  let usageDayKeyed = false;
  if (activity?.usage) {
    const usageDay = days.find((d) => d.day === activity.usage.day);
    usageDayKeyed = Boolean(usageByKey) && keyed(usageDay);
    usage = {
      day: activity.usage.day,
      hotspots: 0,
      users: 0,
      coverage: usageDayKeyed ? { reported: 0, rewarded: 0 } : null,
    };
  }

  for (const h of hotspots || []) {
    if (!isMobileHotspot(h)) continue;
    mobileTotal++;
    const key = h.entityKey;
    const wifi = isHeartbeatEligible(h);
    if (wifi) wifiTotal++;
    const beat = hb?.[key];
    const speed = st?.[key] ?? null;
    const ban = bans?.[key];
    const rejected = inv?.[key];
    const earned = rewardsByKey ? rewardsByKey[key]?.[latest.day] : undefined;
    const used = usageByKey?.[key];
    const row = {
      wifi,
      heartbeating: wifi && hb ? Boolean(beat?.count) : null,
      heartbeats: wifi && hb ? (beat?.count ?? 0) : null,
      lastHeartbeatAt: beat?.lastAt ?? null,
      trust: beat?.trust ?? null,
      distance: beat?.distance ?? null,
      locationSource: beat?.source ?? null,
      assertedCell: beat?.assertedCell ?? null,
      points: beat?.points ?? [],
      speedtest: wifi ? speed : null,
      speedtestMultiplier: wifi ? (speed?.multiplier ?? null) : null,
      banned: bans ? ban?.banned === true : null,
      ban: ban?.banned ? ban : null,
      rejectedHeartbeats: wifi && inv ? (rejected?.count ?? 0) : null,
      rejectedReasons: rejected?.reasons ?? null,
      hntLatestDay: rewardsByKey ? (earned?.hnt ?? 0) : null,
      bytesLatestDay: rewardsByKey ? (earned?.bytes ?? 0) : null,
      usageReported: usageByKey ? Boolean(used) : null,
      users: used ? used.users : null,
      issues: [],
      issue: null,
    };
    if (row.banned) row.issues.push("banned");
    if (row.heartbeating === false) row.issues.push("noHeartbeat");
    if (row.heartbeating && row.trust != null && row.trust < 1) row.issues.push("lowTrust");
    if (row.speedtestMultiplier != null && row.speedtestMultiplier < 1) row.issues.push("lowSpeedtest");
    if (row.rejectedHeartbeats > 0) row.issues.push("rejectedHeartbeats");
    row.issue = row.issues[0] ?? null;
    for (const issue of row.issues) {
      counts[issue]++;
      groups[issue].push({ hotspot: h, row });
    }
    if (row.issue) counts.withIssues++;
    if (row.heartbeating !== null) counts.heartbeatChecked++;
    if (row.heartbeating) counts.heartbeating++;
    if (row.hntLatestDay > 0) counts.rewarded++;
    if (usage && used) {
      usage.hotspots++;
      usage.users += used.users;
    }
    if (usage?.coverage && allByKey?.[key]?.[usage.day]) {
      usage.coverage.rewarded++;
      if (used) usage.coverage.reported++;
    }
    rows.set(key, row);
  }

  let rewards = null;
  if (activity?.rewards) {
    const loaded = days.filter((d) => d.state === "ok");
    rewards = {
      days,
      latest,
      latestUsd: latest?.state === "ok" && latest.priceUsd != null ? latest.hnt * latest.priceUsd : null,
      weekHnt: loaded.reduce((s, d) => s + d.hnt, 0),
      daysLoaded: loaded.length,
    };
  }

  const windows = Object.fromEntries(
    SLIDING_TABLES.map((s) => [s, windowText(s, activity?.tables?.[s]?.until ?? null, now)]),
  );
  const issueText = Object.fromEntries(
    MOBILE_ISSUE_ORDER.map((k) => [k, issueTextFor(k, windows[MOBILE_ISSUES[k].window] ?? null)]),
  );

  const loaded = {
    rewards: Boolean(rewardsByKey),
    usage: Boolean(usageByKey),
    bans: Boolean(bans),
    heartbeats: Boolean(hb),
    invalidHeartbeats: Boolean(inv),
    speedtests: Boolean(st),
  };
  const known = Object.fromEntries(
    MOBILE_ISSUE_ORDER.map((k) => {
      const { wifi, table } = MOBILE_ISSUES[k];
      return [k, (wifi && wifiTotal === 0) || loaded[table]];
    }),
  );
  return {
    mobileTotal,
    wifiTotal,
    rows,
    groups,
    counts,
    rewards,
    usage,
    windows,
    issueText,
    loaded,
    failed: failedTables(activity, loaded),
    known,
  };
}
