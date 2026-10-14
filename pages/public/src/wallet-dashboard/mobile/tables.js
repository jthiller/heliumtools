// What the Mobile activity engine reads, table by table: the table, its key
// and time columns, the window the dashboard shows, the columns to read, how
// one row is normalized, and how a window's rows assemble into the
// `useMobileActivity` contract.
//
// Normalized rows are small plain objects (numbers, ms timestamps, strings):
// they're cached in IndexedDB, posted to the page, and diffed between checks
// (`rowId` is a row's identity for the multiset diff that decides what's new;
// a compaction rewrites the same rows into a new file, so identical ids).
//
// Keys are each Hotspot's Entity API `entity_key_str`, byte-for-byte the
// tables' key strings (366-char RSA keys for WiFi indoor/outdoor Hotspots,
// 51-char ed25519 keys for data-only ones; ecc_compact keys, `11…`, such as
// CBRS radios, never appear in these tables).

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** How often a visible page checks every table (mobileClient.js). */
export const CHECK_INTERVAL_MS = 2 * MINUTE_MS;
/**
 * A sliding window ends at "now" only while its table is fresh: its last
 * check succeeded within two check intervals plus a minute. Otherwise (a
 * failed or overdue check, a hidden or sleeping page) it stays frozen at the
 * last successful check, and the section's `until` says so.
 */
export const FRESH_MS = 2 * CHECK_INTERVAL_MS + MINUTE_MS;

/** Whether a sliding section's window (`until`) still ends at about now. */
export function isWindowCurrent(until, now = Date.now()) {
  return until != null && now - until <= FRESH_MS;
}

/** Heartbeat and rejected-heartbeat window, minutes. */
export const HEARTBEAT_WINDOW_MIN = 60;
/** Speedtest average window, hours. */
export const SPEEDTEST_WINDOW_HOURS = 24;
// A sliding table's file stops being planned once its newest row leaves the
// window; this much slack (about one upstream commit) keeps it cached past that.
const SLIDING_SLACK_MS = 20 * MINUTE_MS;
/** Reported positions closer than this are one point on the map, meters. */
const POINT_GROUP_M = 15;
/** HNT and HNT/USD prices are stored ×1e8 (bones). */
const BONES_PER_HNT = 1e8;

/** Timestamp-ish parquet value → ms (null when absent). */
export function toMs(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** int64 (BigInt) / numeric parquet value → number (null when absent). */
export function toNum(v) {
  if (v == null) return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ms → "YYYY-MM-DD" (UTC). */
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Great-circle distance in meters. */
function metersBetween(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The newest row per key, by `at`. */
function latestByKey(rows) {
  const out = new Map();
  for (const r of rows) {
    const prev = out.get(r.k);
    if (!prev || r.at > prev.at) out.set(r.k, r);
  }
  return out;
}

/**
 * Windows:
 *   { kind: "sliding", ms }       rows whose time column is within `ms` of the
 *                                 window's end: now while the table is fresh
 *                                 (re-filtered on every assemble, so it
 *                                 slides), else its last good check
 *   { kind: "days", days, lookbackDays }
 *                                 the `days` UTC partition days ending at the
 *                                 newest one present within `lookbackDays`
 *   { kind: "all" }               the whole table
 * `retainMs`: how long a file stays useful past its newest row (window + slack);
 * cached bytes and extracts older than that are evicted first.
 * `wifiOnly`: only WiFi indoor/outdoor Hotspots appear, so a fleet without
 * any skips the table.
 * `format`: the shape of a cached extract (IndexedDB records are keyed by
 * it). Bump it whenever `columns`, `scan`, `normalize` or `rowId` change, so
 * returning browsers re-extract instead of reading old-shaped rows; old
 * records age out by their expiry.
 * Sliding sections carry `until`, their window's end (see FRESH_MS).
 */
export const TABLES = {
  rewards: {
    ref: "rewards.data_transfer",
    keyColumn: "hotspot_key",
    timeColumn: "start_period",
    window: { kind: "days", days: 7, lookbackDays: 14 },
    retainMs: 9 * DAY_MS,
    format: 1,
    columns: ["hotspot_key", "dc_transfer_reward", "rewardable_bytes", "price", "start_period"],
    // Every row carries its epoch's HNT price; keep one so a day this wallet
    // earned nothing still has a price.
    scan(r, meta) {
      if (meta.price == null && r.price != null) meta.price = toNum(r.price);
    },
    normalize: (r) => ({
      k: r.hotspot_key,
      day: dayOf(toMs(r.start_period)),
      bones: toNum(r.dc_transfer_reward) ?? 0,
      bytes: toNum(r.rewardable_bytes) ?? 0,
    }),
    rowId: (r) => `${r.k}|${r.day}|${r.bones}|${r.bytes}`,
    /** ctx: { days (newest first), dayState(day), priceByDay } */
    assemble(rows, ctx) {
      const totals = new Map(ctx.days.map((d) => [d, { bones: 0, bytes: 0, keys: new Set() }]));
      const byKey = {};
      for (const r of rows) {
        const t = totals.get(r.day);
        if (!t) continue;
        t.bones += r.bones;
        t.bytes += r.bytes;
        t.keys.add(r.k);
        const perKey = (byKey[r.k] ??= {});
        const prev = perKey[r.day];
        perKey[r.day] = {
          hnt: (prev?.hnt ?? 0) + r.bones / BONES_PER_HNT,
          bytes: (prev?.bytes ?? 0) + r.bytes,
        };
      }
      return {
        days: ctx.days.map((day) => {
          const t = totals.get(day);
          const price = ctx.priceByDay.get(day);
          return {
            day,
            state: ctx.dayState(day),
            hnt: t.bones / BONES_PER_HNT,
            bytes: t.bytes,
            priceUsd: price == null ? null : price / BONES_PER_HNT,
            hotspots: t.keys.size,
          };
        }),
        byKey,
      };
    },
  },

  usage: {
    ref: "hotspots.usage_stats",
    keyColumn: "hotspot_pubkey",
    timeColumn: "epoch_start_timestamp",
    window: { kind: "days", days: 1, lookbackDays: 7 },
    retainMs: 3 * DAY_MS,
    format: 1,
    columns: [
      "hotspot_pubkey",
      "received_timestamp",
      "epoch_start_timestamp",
      "user_count_total",
      "rewarded_bytes_transferred_total",
      "unrewarded_bytes_transferred_total",
      "sampling_user_count_total",
      "sampling_bytes_transferred_total",
      "carrier_transfer_info",
    ],
    normalize: (r) => ({
      k: r.hotspot_pubkey,
      day: dayOf(toMs(r.epoch_start_timestamp)),
      at: toMs(r.received_timestamp) ?? 0,
      users: toNum(r.user_count_total) ?? 0,
      rb: toNum(r.rewarded_bytes_transferred_total) ?? 0,
      ub: toNum(r.unrewarded_bytes_transferred_total) ?? 0,
      su: toNum(r.sampling_user_count_total) ?? 0,
      sb: toNum(r.sampling_bytes_transferred_total) ?? 0,
      // Carrier ids are anonymized (`carrier_N`); no names exist.
      carriers: (r.carrier_transfer_info || []).map((c) => ({
        id: c.carrier_id,
        users: toNum(c.user_count) ?? 0,
        rewardedBytes: toNum(c.rewarded_bytes_transferred) ?? 0,
        unrewardedBytes: toNum(c.unrewarded_bytes_transferred) ?? 0,
      })),
    }),
    rowId: (r) => `${r.k}|${r.day}|${r.at}|${r.users}|${r.rb}|${r.ub}`,
    /** ctx: { days: [day] } */
    assemble(rows, ctx) {
      const day = ctx.days[0];
      if (!day) return null;
      const byKey = {};
      for (const [k, r] of latestByKey(rows.filter((x) => x.day === day))) {
        byKey[k] = {
          users: r.users,
          rewardedBytes: r.rb,
          unrewardedBytes: r.ub,
          samplingUsers: r.su,
          samplingBytes: r.sb,
          carriers: r.carriers,
        };
      }
      return { day, byKey };
    },
  },

  bans: {
    ref: "hotspots.bans",
    keyColumn: "pubkey",
    // `report_timestamp` is broken upstream (zero, or seconds in a ms field).
    timeColumn: "received_timestamp",
    window: { kind: "all" },
    retainMs: 30 * DAY_MS,
    format: 1,
    columns: ["pubkey", "received_timestamp", "is_ban", "hotspot_serial", "message", "ban_reason"],
    normalize: (r) => ({
      k: r.pubkey,
      at: toMs(r.received_timestamp) ?? 0,
      ban: Boolean(r.is_ban),
      reason: r.ban_reason ?? null,
      message: r.message ?? null,
      serial: r.hotspot_serial ?? null,
    }),
    rowId: (r) => `${r.k}|${r.at}|${r.ban}`,
    // Current status is the newest row per Hotspot; `is_ban: false` is an unban.
    assemble(rows) {
      const byKey = {};
      for (const [k, r] of latestByKey(rows)) {
        byKey[k] = { banned: r.ban, at: r.at, reason: r.reason, message: r.message, serial: r.serial };
      }
      return { byKey };
    },
  },

  heartbeats: {
    ref: "hotspots.heartbeats",
    keyColumn: "hotspot_pubkey",
    timeColumn: "received_timestamp",
    window: { kind: "sliding", ms: HEARTBEAT_WINDOW_MIN * MINUTE_MS },
    retainMs: HEARTBEAT_WINDOW_MIN * MINUTE_MS + SLIDING_SLACK_MS,
    format: 1,
    wifiOnly: true,
    columns: [
      "hotspot_pubkey",
      "received_timestamp",
      "lat",
      "lon",
      "location_validation_timestamp",
      "distance_to_asserted",
      "asserted_location",
      "location_trust_score_multiplier",
      "location_source",
    ],
    normalize: (r) => ({
      k: r.hotspot_pubkey,
      at: toMs(r.received_timestamp) ?? 0,
      lat: r.lat,
      lon: r.lon,
      trust: toNum(r.location_trust_score_multiplier),
      dist: toNum(r.distance_to_asserted),
      src: r.location_source ?? null,
      cell: r.asserted_location ?? null,
      vt: toMs(r.location_validation_timestamp),
    }),
    rowId: (r) => `${r.k}|${r.at}|${r.lat}|${r.lon}`,
    /** ctx: { now } (the window's end) */
    assemble(rows, ctx) {
      const byKey = {};
      const sorted = [...rows].sort((a, b) => a.at - b.at);
      for (const r of sorted) {
        let e = byKey[r.k];
        if (!e) e = byKey[r.k] = { count: 0, lastAt: 0, points: [] };
        e.count++;
        // Oldest first, so these end on the latest heartbeat's values.
        e.lastAt = r.at;
        e.trust = r.trust;
        e.distance = r.dist;
        e.source = r.src;
        e.assertedCell = r.cell;
        e.validatedAt = r.vt;
        if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
        // Group fixes within POINT_GROUP_M of a point's first fix.
        const p = e.points.find((x) => metersBetween(x.lat, x.lon, r.lat, r.lon) <= POINT_GROUP_M);
        if (p) {
          p.n++;
          p.lastAt = r.at;
          p.trust = r.trust;
          p.distance = r.dist;
          p.source = r.src;
        } else {
          e.points.push({ lat: r.lat, lon: r.lon, n: 1, lastAt: r.at, trust: r.trust, distance: r.dist, source: r.src });
        }
      }
      return { windowMin: HEARTBEAT_WINDOW_MIN, until: ctx.now, byKey };
    },
  },

  invalidHeartbeats: {
    ref: "hotspots.invalid_heartbeats",
    keyColumn: "hotspot_pubkey",
    timeColumn: "received_timestamp",
    window: { kind: "sliding", ms: HEARTBEAT_WINDOW_MIN * MINUTE_MS },
    retainMs: HEARTBEAT_WINDOW_MIN * MINUTE_MS + SLIDING_SLACK_MS,
    format: 1,
    wifiOnly: true,
    columns: ["hotspot_pubkey", "received_timestamp", "reason"],
    normalize: (r) => ({ k: r.hotspot_pubkey, at: toMs(r.received_timestamp) ?? 0, reason: r.reason ?? "unknown" }),
    rowId: (r) => `${r.k}|${r.at}|${r.reason}`,
    /** ctx: { now } (the window's end) */
    assemble(rows, ctx) {
      const byKey = {};
      for (const r of rows) {
        const e = (byKey[r.k] ??= { count: 0, lastAt: 0, reasons: {} });
        e.count++;
        if (r.at > e.lastAt) e.lastAt = r.at;
        e.reasons[r.reason] = (e.reasons[r.reason] || 0) + 1;
      }
      return { windowMin: HEARTBEAT_WINDOW_MIN, until: ctx.now, byKey };
    },
  },

  speedtests: {
    ref: "hotspots.speedtest_avgs",
    keyColumn: "hotspot_pubkey",
    timeColumn: "timestamp",
    window: { kind: "sliding", ms: SPEEDTEST_WINDOW_HOURS * HOUR_MS },
    retainMs: SPEEDTEST_WINDOW_HOURS * HOUR_MS + SLIDING_SLACK_MS,
    format: 1,
    wifiOnly: true,
    columns: [
      "hotspot_pubkey",
      "upload_speed_avg_bps",
      "download_speed_avg_bps",
      "latency_avg_ms",
      "reward_multiplier",
      "sample_count",
      "timestamp",
      "speedtests",
    ],
    normalize: (r) => ({
      k: r.hotspot_pubkey,
      at: toMs(r.timestamp) ?? 0,
      down: toNum(r.download_speed_avg_bps),
      up: toNum(r.upload_speed_avg_bps),
      latency: toNum(r.latency_avg_ms),
      mult: toNum(r.reward_multiplier),
      n: toNum(r.sample_count),
      tests: (r.speedtests || [])
        .map((t) => ({
          at: toMs(t.timestamp),
          down: toNum(t.download_speed_bps),
          up: toNum(t.upload_speed_bps),
          latency: toNum(t.latency_ms),
        }))
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0)),
    }),
    rowId: (r) => `${r.k}|${r.at}|${r.mult}|${r.n}`,
    // The newest average per Hotspot in the last 24 h. ctx: { now } (the window's end)
    assemble(rows, ctx) {
      const byKey = {};
      for (const [k, r] of latestByKey(rows)) {
        byKey[k] = {
          down: r.down,
          up: r.up,
          latency: r.latency,
          multiplier: r.mult,
          samples: r.n,
          at: r.at,
          tests: r.tests,
        };
      }
      return { windowHours: SPEEDTEST_WINDOW_HOURS, until: ctx.now, byKey };
    },
  },
};

export const TABLE_NAMES = Object.keys(TABLES);

/**
 * One check's order of work. The newest rewards day paints first; the other
 * six days backfill last, after the live tables.
 */
export const REFRESH_STEPS = [
  { table: "rewards", backfill: false },
  { table: "usage" },
  { table: "bans" },
  { table: "heartbeats" },
  { table: "invalidHeartbeats" },
  { table: "speedtests" },
  { table: "rewards", backfill: true },
];
