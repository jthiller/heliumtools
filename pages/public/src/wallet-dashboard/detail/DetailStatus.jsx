import { memo } from "react";
import { fmtDataDay, fmtHnt, plural } from "../format.js";
import { fmtReason } from "../mobileFormat.js";
import { TIERS, iotStateData, makeState } from "../statusRegistry.js";
import { TimeAgo } from "../ui/TimeAgo.jsx";
import { DSection, StateLine } from "./parts.jsx";

const NOT_HEARTBEATS = "HNT from data transfer doesn't depend on heartbeats.";
const IOT_KEYS = new Set(["inactiveTraffic", "activeQuiet", "inactiveQuiet", "inactive", "activeTraffic", "active"]);
// Couldn't check: a crossed ring, not the "?" of an unknown Hotspot.
const X_MARK = new Set(["iotFailed", "mobileFailed"]);

function topReason(reasons) {
  let top = null;
  for (const [reason, n] of Object.entries(reasons || {})) if (!top || n > top[1]) top = [reason, n];
  return top?.[0] ?? null;
}

const MOBILE_TABLES = ["heartbeats", "invalidHeartbeats", "speedtests", "bans", "rewards"];
const NOT_WIFI = new Set(["heartbeats", "invalidHeartbeats", "speedtests"]);

/** The facts each verdict is worded from (the same data the list's states use). */
function dataFor(key, row, ctx, mobile) {
  const m = row.mobile;
  if (IOT_KEYS.has(key)) return iotStateData(row.iot);
  switch (key) {
    case "banned":
      return { reason: m?.ban?.reason, at: m?.ban?.at };
    case "lowTrust":
      return { trust: m?.trust };
    case "lowSpeedtest":
      return { multiplier: m?.speedtestMultiplier };
    case "rejectedHeartbeats":
      return { topReason: topReason(m?.rejectedReasons) };
    case "heartbeatOk":
      return { at: m?.lastHeartbeatAt, frozen: Boolean(ctx.frozen?.heartbeats) };
    case "rewardedDays":
      return { days: row.week.daysWithHnt, of: row.week.daysLoaded };
    case "settingUp":
      return { onboardedAt: row.onboarded.iot ?? null };
    case "neverRewarded": {
      const at = row.onboarded.at;
      return { onboardedDay: at && ctx.rewardsFirstDay && at.slice(0, 10) >= ctx.rewardsFirstDay ? at.slice(0, 10) : null };
    }
    case "noStatus":
      return { reason: row.nets.cbrs ? "cbrs" : row.nets.none ? "network" : "none" };
    case "mobileFailed":
      return { tables: MOBILE_TABLES.filter((t) => mobile?.failed?.[t] && (row.wifi || !NOT_WIFI.has(t))) };
    default:
      return undefined;
  }
}

/** What's still being checked for this Hotspot, by source and window. */
function pendingText(row, ctx, mobile) {
  const w = ctx.windows || {};
  const parts = [];
  if (row.iot?.status === "pending") parts.push(`IoT status for ${ctx.iotDayLabel ?? "the latest reported day"}`);
  if (row.mobile) {
    const waiting = (t) => !mobile?.loaded?.[t] && !mobile?.failed?.[t];
    if (row.wifi && (waiting("heartbeats") || waiting("invalidHeartbeats"))) parts.push(`Heartbeats, ${w.heartbeats?.span ?? "last 60 min"}`);
    if (row.wifi && waiting("speedtests")) parts.push(`Speedtests, ${w.speedtests?.span ?? "last 24 h"}`);
    if (row.week.state === "loading") parts.push(`Rewards, ${ctx.rewardsWindow ?? "7 days"}`);
    if (waiting("bans")) parts.push("Bans");
  }
  if (row.unclaimed.state === "loading") parts.push("Unclaimed and lifetime rewards");
  return parts.join(" · ");
}

/**
 * Every state that applies to this Hotspot (all its verdicts, OK ones too),
 * most severe first, each with its full window; a "Checking…" line names the
 * sources still being checked.
 */
export function detailStates(row, ctx, mobile) {
  const w = ctx.windows || {};
  const hbLong = w.heartbeats?.long ?? "in the last 60 min";
  const items = [];
  for (const key of row.verdicts) {
    if (key === "checking") continue;
    const data = dataFor(key, row, ctx, mobile);
    // The list's own state when the row shows it (its exact data), else
    // worded here from the same facts.
    const s = row.states.find((x) => x.key === key) ?? makeState(key, ctx, data);
    let label = s.label;
    let sub = s.window2 ? `${s.window} · ${s.window2}` : s.window;
    if (IOT_KEYS.has(key)) {
      const day = data?.day ? `${fmtDataDay(data.day)} (UTC)` : (ctx.iotDayLabel ?? "the latest reported day");
      const connected = row.iot?.status === "active" ? "Active" : "Inactive";
      const traffic =
        data?.messages != null
          ? `${plural(data.messages, "message")} in the 30 days to ${fmtDataDay(data.through ?? ctx.trafficThrough)} (UTC)`
          : s.window2;
      sub = `${connected} on ${day} · ${traffic}`;
    } else if (key === "noRewardedData") {
      label = `No rewarded data in the ${ctx.rewardsWindow ?? "7 days"}`;
      sub = `0 B rewarded on each of the 7 days. Lifetime ${fmtHnt(row.lifetime.hnt, "stat")} HNT.`;
    } else if (key === "noHeartbeat") {
      label = `No heartbeat ${hbLong}`;
      sub = NOT_HEARTBEATS;
    } else if (key === "heartbeatOk") {
      label = data.frozen || !data.at ? "Heartbeat received" : (
        <>
          Heartbeat <TimeAgo at={data.at} fallback="received" />
        </>
      );
      sub = row.mobile?.heartbeats != null ? `${plural(row.mobile.heartbeats, "heartbeat")} ${hbLong}` : s.window;
    } else if (key === "rejectedHeartbeats") {
      label = `Rejected heartbeat ${w.invalidHeartbeats?.long ?? "in the last 60 min"}`;
      sub = data.topReason ? `Top reason: ${fmtReason(data.topReason)}. ${NOT_HEARTBEATS}` : NOT_HEARTBEATS;
    }
    items.push({ key, tier: s.tier, mark: X_MARK.has(key) ? "x" : undefined, label, sub });
  }
  // The list words a WiFi Hotspot by its heartbeat; the detail also says how
  // many of the 7 days it earned (data-only Hotspots carry it as their state).
  const week = row.week;
  if (
    row.wifi &&
    !row.verdicts.has("rewardedDays") &&
    !row.verdicts.has("noRewardedData") &&
    (week.state === "ok" || week.state === "partial") &&
    week.daysWithHnt > 0
  ) {
    const s = makeState("rewardedDays", ctx, { days: week.daysWithHnt, of: week.daysLoaded });
    items.push({ key: "rewardedDays", tier: s.tier, label: s.label, sub: s.window });
  }
  // A dual-network Hotspot outside the Mobile tables (an ecc key): its
  // Mobile side has no status to show, said once (not a state of its own).
  if (row.netLine) items.push({ key: "netLine", tier: "unknown", label: row.netLine, sub: null });
  // Most severe first (a stable sort keeps the registry's order within a tier).
  items.sort((a, b) => (TIERS[a.tier]?.rank ?? 99) - (TIERS[b.tier]?.rank ?? 99));
  if (row.checking) {
    items.push({ key: "checking", tier: "checking", label: "Checking…", sub: pendingText(row, ctx, mobile) || null });
  }
  return items;
}

/** "No issues in the last 60 min, 24 h or 7 days." for a Mobile Hotspot
 * whose every source answered with nothing to flag; frozen windows are named
 * by their end. Null otherwise (IoT Hotspots say it in their status line). */
function clearLine(row, items, ctx) {
  if (!row.mobile || row.checking) return null;
  if (items.some((s) => s.tier !== "ok")) return null;
  const week = ctx.rewardsWindow ?? "7 days";
  if (row.dataOnly) return `No issues in the ${week}.`;
  const hb = ctx.windows?.heartbeats;
  const sp = ctx.windows?.speedtests;
  const hbLive = hb?.current !== false;
  const spLive = sp?.current !== false;
  if (hbLive && spLive) return "No issues in the last 60 min, 24 h or 7 days.";
  return `No issues in the ${hbLive ? "last 60 min" : hb.short}, the ${spLive ? "last 24 h" : sp.short} or the ${week}.`;
}

/** The detail's Status section: every state with its full window. */
export default memo(function DetailStatus({ row, ctx, mobile }) {
  const items = detailStates(row, ctx, mobile);
  const clear = clearLine(row, items, ctx);
  return (
    <DSection id="status" title="Status">
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {items.map((s) => (
          <StateLine key={s.key} as="li" tier={s.tier} mark={s.mark} label={s.label} sub={s.sub} />
        ))}
      </ul>
      {clear && <p className="m-0 text-wd-sm text-wd-ink-2">{clear}</p>}
    </DSection>
  );
});

