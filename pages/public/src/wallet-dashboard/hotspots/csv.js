// The Hotspot list's CSV export (JUDGE 12): the rows of the current filter in
// the order shown. The original columns come first, in their original order
// and with their original value vocabularies (spreadsheets script against
// them); every new column is appended. Values are machine values (raw keys,
// ISO dates, unformatted numbers). A value that isn't known yet is blank in
// number columns, never 0; only the state columns say "pending". Pure.
import { IOT_HEALTH, isTrafficKnown } from "../format.js";
import { STATES, TIERS, stateRank } from "../statusRegistry.js";

const IOT_STATUS_CSV = { active: "active", inactive: "inactive", settingUp: "setting_up", unknown: "unknown", pending: "pending" };

const BASE_COLUMNS = [
  "name",
  "entity_key",
  "asset_id",
  "network",
  "device_type",
  "city",
  "state",
  "country",
  "h3_location",
  "onboarded_at",
  "iot_status",
  "iot_health",
  "iot_messages_30d",
  "iot_oui_ids",
  "iot_traffic_through",
  "lifetime_iot",
  "lifetime_hnt",
];

/** Neutralize spreadsheet formula injection (a Hotspot named "=cmd()") and quote. */
export function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const bool = (v) => (v == null ? null : v ? "true" : "false");
const round = (v, d) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

// The row's states as machine keys, most severe first; "pending" while a
// source is still being checked.
function statesCsv(row) {
  const keys = [...row.verdicts].filter((k) => k !== "checking" && STATES[k]).sort((a, b) => stateRank(a) - stateRank(b));
  const out = keys.map((k) => STATES[k].csv);
  if (row.checking) out.push("pending");
  return out.join(";");
}

/**
 * The file name: hotspots-<first 6 of the wallet>-<day>.csv, where the day is
 * the Mobile rewards' latest UTC day, else the IoT data day, else today (UTC).
 */
export function csvFileName(wallet, list, iotStatus) {
  const day = list?.ctx?.rewardsDay ?? iotStatus?.livenessRange?.max ?? new Date().toISOString().slice(0, 10);
  return `hotspots-${String(wallet || "").slice(0, 6)}-${day}.csv`;
}

/**
 * The CSV text for `rows` (HotspotRows, in the order shown).
 * @param {object} p
 * @param {object[]} p.rows
 * @param {object} p.list     aggregateHotspotList result (windows, the 7 reward days)
 * @param {object} p.mobile   aggregateMobile result (usage day, window ends)
 */
export function hotspotsCsv({ rows, list, mobile }) {
  const days = (mobile?.rewards?.days ?? []).map((d) => d.day).filter(Boolean).reverse(); // oldest first
  const usageDay = mobile?.usage?.day ?? null;
  const hbWindow = mobile?.windows?.heartbeats;
  const header = [
    ...BASE_COLUMNS,
    "networks",
    "status_tier",
    "status_states",
    "unclaimed_hnt",
    "claimable",
    "claim_reason",
    "claim_destination",
    "claimed_hnt",
    "lifetime_hnt_lower_bound",
    "lifetime_mobile",
    ...days.map((d) => `hnt_${d}`),
    "hnt_7d",
    "hnt_7d_days",
    "rewarded_bytes_latest_day",
    `users_${usageDay ?? "latest_day"}`,
    "mobile_banned",
    "ban_reason",
    "ban_at",
    "last_heartbeat_at",
    "heartbeats_60m",
    "heartbeat_window_end",
    "location_trust",
    "distance_m",
    "speedtest_multiplier",
    "down_mbps",
    "up_mbps",
    "latency_ms",
    "rejected_heartbeats_60m",
    "onboarded_at_iot",
    "onboarded_at_mobile",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const h = r.hotspot;
    const iot = r.iot;
    const block = iot && isTrafficKnown(iot.traffic) ? iot.traffic : null;
    const life = r.lifetime.state === "ok" ? r.lifetime : null;
    const rewardsIn = r.unclaimed.state === "ok" || r.unclaimed.state === "unconfirmed";
    const m = r.mobile;
    const sp = m?.speedtest;
    const byDay = new Map((r.week.days || []).map((d) => [d.day, d]));
    const tier = r.top.tier === "checking" ? "pending" : TIERS[r.tier]?.word.toLowerCase();
    const cells = [
      h.name,
      r.key,
      r.assetId,
      h.network,
      h.deviceType,
      h.city,
      h.state,
      h.country,
      h.location,
      r.onboarded.at || null,
      iot ? (IOT_STATUS_CSV[iot.status] ?? "") : null,
      iot?.health ? IOT_HEALTH[iot.health].csv : null,
      r.messages.state === "ok" ? r.messages.count : null,
      block?.ouis?.join(";"),
      block?.dataThrough,
      life ? life.legacy?.iot : null,
      life ? life.hnt : null,
      // Appended columns.
      (h.networks || []).join(";"),
      tier,
      statesCsv(r),
      r.unclaimed.state === "ok" ? r.unclaimed.hnt : null,
      rewardsIn ? bool(r.unclaimed.claimable) : null,
      r.unclaimed.reason,
      r.unclaimed.destination,
      life ? life.claimed : null,
      life ? bool(life.lowerBound) : null,
      life ? life.legacy?.mobile : null,
      ...days.map((d) => {
        const e = byDay.get(d);
        return e?.state === "ok" ? e.hnt : null;
      }),
      round(r.week.hnt, 8), // a sum of 7 days: drop float noise past HNT's 8 decimals
      r.week.state === "ok" || r.week.state === "partial" ? r.week.daysLoaded : null,
      r.day.state === "ok" ? r.day.bytes : null,
      r.users,
      bool(m?.banned),
      m?.ban?.reason,
      iso(m?.ban?.at),
      iso(m?.lastHeartbeatAt),
      m?.heartbeats,
      m?.wifi && m.heartbeats != null ? iso(hbWindow?.until) : null,
      m?.trust,
      m?.distance,
      m?.speedtestMultiplier,
      sp ? round(sp.down / 1e6, 2) : null,
      sp ? round(sp.up / 1e6, 2) : null,
      sp?.latency,
      m?.rejectedHeartbeats,
      r.onboarded.iot || null,
      r.onboarded.mobile || null,
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\n");
}

