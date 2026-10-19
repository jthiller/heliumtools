// ── Health: the IoT module's view model ─────────────────────────────────────
// Pure: turns `aggregateIotStatus` (with the scan's done flag and the network
// utilization index) into what the IoT module shows (WdHealth `buildIot`):
// the header chip, scan progress, the connectivity headline, the Messages
// delivered well, the tier bar, the positive line, the rows by state and the
// footnotes. It reads the aggregate's counts and groups only, never a row of
// its own, so the module and the list can't disagree. The row and bar
// builders below are shared with mobileModule.js.
import {
  byMessagesDesc,
  fmtCount,
  fmtDataDay,
  fmtDayRange,
  fmtLowerBound,
  indexForBuild,
  shortAddress,
  IOT_CONNECTIVITY_NOTE,
  IOT_MESSAGES_NOTE,
  IOT_TRAFFIC_STATE_NOTE,
} from "../format.js";
import { HEALTH_KEY_TO_FILTER, STATES, TIERS } from "../statusRegistry.js";

/** A row names its Hotspots (as buttons that open each one) up to this many;
 * above it links to the list instead ("Show 601 in list"). */
export const NAMES_MAX = 10;
/** From this many Hotspots a module adds each count's share ("(64%)"). */
export const BIG_FLEET = 200;

/** The tier bar's legend words. */
const TIER_LABEL = { serious: "Serious", check: "Check", info: "Setting up", unknown: "Unknown", ok: "OK", checking: "Checking" };

export const pctOf = (n, of) => `${of ? Math.round((n / of) * 100) : 0}%`;
export const many = (n, one, other) => `${fmtCount(n)} ${n === 1 ? one : other}`;

/** A group member (`{ hotspot, row }`) as a name button: its name (the short
 * entity key when it has none, never the raw key), the `hotspot` URL value
 * the list uses (asset ID, else the entity key) and an optional value. */
function nameOf(member, val) {
  const key = member.hotspot.entityKey;
  return { key, param: member.hotspot.assetId || key, name: member.hotspot.name || shortAddress(key), val: val || null };
}

/**
 * One row by state. `members` are the aggregate's `{ hotspot, row }` entries
 * (fleet order; sort before passing when the names have an order of their
 * own); `valueOf(member)` the figure beside a name; `denom` the module's
 * denominator for the share shown from BIG_FLEET up. The row's link filters
 * the list by the same predicate (HEALTH_KEY_TO_FILTER).
 */
export function healthRow({ key, tier, mark = null, word, label, hint, win, members, valueOf, denom, big }) {
  const n = members.length;
  const named = n <= NAMES_MAX;
  const btn = named ? "View in list" : `Show ${fmtCount(n)} in list`;
  return {
    key,
    filter: HEALTH_KEY_TO_FILTER[key],
    tier,
    mark,
    word: word ?? TIERS[tier].word,
    label,
    hint,
    win,
    n,
    pct: big ? pctOf(n, denom) : null,
    btn,
    btnAria: `${btn}: ${many(n, "Hotspot", "Hotspots")}, ${label}, ${win}`,
    names: named ? members.map((m) => nameOf(m, valueOf?.(m))) : [],
    namesAria: `${label}, by name`,
  };
}

/** The tier bar and its legend from `[{ tier, n }]`, leaving out tiers with none. */
export function tierBar(tiers, { denom, big, aria }) {
  const shown = tiers.filter((t) => t.n > 0);
  return {
    aria,
    segs: shown.map(({ tier, n }) => ({ tier, n })),
    legend: shown.map(({ tier, n }) => ({ tier, label: TIER_LABEL[tier], n, pct: big ? pctOf(n, denom) : null })),
  };
}

// Rows in the design's order: the two Serious/Check traffic verdicts, the
// connectivity-only ones, then setting up, unknown, couldn't check, the OKs.
const IOT_ROWS = ["inactiveTraffic", "activeQuiet", "inactiveQuiet", "inactive", "settingUp", "unknown", "failed", "activeTraffic", "active"];
// The registry state behind each IoT group (labels, tiers, hints).
const STATE_OF = { unknown: "iotUnknown", failed: "iotFailed" };
// Groups whose names are listed by 30-day messages, most first.
const BY_MESSAGES = new Set(["inactiveTraffic", "activeTraffic"]);
const FAILED_HINT = "IoT status couldn't be checked for these Hotspots right now. None of them is counted as Inactive.";
const FAILED_WIN = "IoT status and messages, latest reported UTC day";
const MULTI_BUY =
  "Message counts are summed across your Hotspots. With multi-buy, a device message delivered by several Hotspots counts at each.";

/** The all-zero sentence, honest about a denominator smaller than the fleet. */
function noneDelivered(known, total, trafficWindow) {
  const all = known === total;
  if (known === 1) {
    return `${all ? "Your IoT Hotspot" : "The IoT Hotspot with traffic data"} delivered no messages in the ${trafficWindow}.`;
  }
  const who = all ? `your ${fmtCount(known)} IoT Hotspots` : `the ${fmtCount(known)} IoT Hotspots with traffic data`;
  return `None of ${who} delivered messages in the ${trafficWindow}.`;
}

/** The header chip's day: once when both feeds name the same single day,
 * else each feed's own ("Connectivity Oct 14 · Messages to Oct 13 (UTC)"). */
function dayChipText(lr, tr) {
  const single = (r) => r && r.min === r.max;
  if (single(lr) && single(tr) && lr.max === tr.max) return `Data for ${fmtDataDay(lr.max)} (UTC)`;
  const parts = [
    lr && `Connectivity ${fmtDayRange(lr)}`,
    tr && (single(tr) ? `Messages to ${fmtDataDay(tr.max)}` : `Messages ending ${fmtDayRange(tr)}`),
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} (UTC)` : null;
}

/**
 * @param {object} p
 * @param {object} p.iotStatus        aggregateIotStatus result (iotTotal > 0)
 * @param {boolean} p.done            the IoT figures are final (the shell's iotStatusDone)
 * @param {boolean} p.retrying        a Retry of failed lookups runs (the figures were final
 *                                    once for this wallet): its progress shows over the data
 * @param {number} p.walletTotal      the wallet's Hotspots (an OK row covering all of them is left out)
 * @param {object|null} p.utilizationIndex  the network utilization index (lower-bound note)
 * @returns the module's view model (see HealthModule.jsx)
 */
export function iotModule({ iotStatus: s, done, retrying = false, walletTotal, utilizationIndex }) {
  const total = s.iotTotal;
  const { traffic, groups } = s;
  const big = total >= BIG_FLEET;
  // The first scan holds a skeleton at its final shape; a Retry keeps the data on screen.
  const loading = s.counted === 0 || (!done && !retrying);
  const allFailed = done && s.failed === total;
  const live = !loading && !allFailed;

  // One day for the whole fleet as a rule; when lookups answered from two
  // builds, each Hotspot's figures end on its own day, and the words say so
  // (never "30 days to Oct 13 to Oct 14").
  const lr = s.livenessRange;
  const tr = s.trafficRange;
  const day = lr ? fmtDayRange(lr) : null;
  const dayLabel = day ? `${day} (UTC)` : "latest reported UTC day";
  const onDay = !lr
    ? "on the latest reported UTC day"
    : lr.min === lr.max
      ? `on ${day} (UTC)`
      : `on their latest reported days (${day}, UTC)`;
  const trafficWindow = !tr
    ? "30 days"
    : tr.min === tr.max
      ? `30 days to ${fmtDataDay(tr.max)} (UTC)`
      : `30-day windows ending ${fmtDayRange(tr)} (UTC)`;
  const trafficWord = traffic.unpublished > 0 ? "traffic data isn't published" : "traffic data unavailable";
  const both = `${dayLabel} · ${trafficWindow}`;
  const WIN = {
    inactiveTraffic: both,
    activeQuiet: both,
    inactiveQuiet: both,
    activeTraffic: both,
    inactive: `${dayLabel} · ${trafficWord}`,
    active: `${dayLabel} · ${trafficWord}`,
    settingUp: lr ? `Onboarded after ${fmtDataDay(lr.max)} (UTC), the latest reported day` : "Onboarded after the latest reported day",
    unknown: STATES.iotUnknown.window(),
    failed: FAILED_WIN,
  };

  const n = (k) => groups[k].length;
  const tiers = allFailed
    ? [{ tier: "unknown", n: total }]
    : [
        { tier: "serious", n: n("inactiveTraffic") },
        { tier: "check", n: n("activeQuiet") + n("inactiveQuiet") + n("inactive") },
        { tier: "info", n: n("settingUp") },
        { tier: "unknown", n: n("unknown") + n("failed") },
        { tier: "ok", n: n("activeTraffic") + n("active") },
        // A Retry's lookups still out, so the bar and legend add up to the total.
        { tier: "checking", n: done ? 0 : total - s.counted },
      ];

  const messagesOf = (m) => (m.row.messages != null ? many(m.row.messages, "message", "messages") : null);
  const rowOf = (key) => {
    const state = STATES[STATE_OF[key] ?? key];
    let members = groups[key];
    if (BY_MESSAGES.has(key) && members.length <= NAMES_MAX) members = [...members].sort(byMessagesDesc);
    return healthRow({
      key,
      tier: state.tier,
      mark: key === "failed" ? "x" : null,
      label: state.label(),
      hint: key === "failed" ? FAILED_HINT : state.hint(),
      win: WIN[key],
      members,
      valueOf: BY_MESSAGES.has(key) ? messagesOf : null,
      denom: total,
      big,
    });
  };
  const rows = allFailed
    ? [rowOf("failed")]
    : !live
      ? []
      : IOT_ROWS.filter((k) => n(k) > 0)
          // An OK row that covers the whole wallet says nothing the positive line doesn't.
          .filter((k) => !(STATES[STATE_OF[k] ?? k].tier === "ok" && n(k) === walletTotal))
          .map(rowOf);

  // Connectivity headline: active of the Hotspots with a verdict (setting up,
  // unknown and couldn't-check are left out and named in the footnote).
  const den = s.active + s.inactive;
  const headline =
    live && den > 0
      ? {
          a: s.active,
          b: den,
          rate: big ? `(${pctOf(s.active, den)})` : null,
          label: den === 1 ? "IoT Hotspot active" : "IoT Hotspots active",
          win: onDay,
          tip: { label: "Active", text: IOT_CONNECTIVITY_NOTE },
          asOf: null,
          // A Retry's running counts are partial until it settles.
          sofar: !done,
        }
      : null;

  let subs = null;
  if (live) {
    const lines = [];
    if (traffic.known === 0) {
      lines.push({
        text: !done
          ? IOT_TRAFFIC_STATE_NOTE.pending
          : traffic.unpublished > 0
            ? "Traffic data isn't published right now."
            : "Traffic data is unavailable right now.",
      });
    } else if (done && traffic.withTraffic === 0) {
      lines.push({ text: noneDelivered(traffic.known, total, trafficWindow) });
    } else {
      const withData = traffic.known < total ? " with traffic data" : "";
      lines.push({
        strong: `${fmtCount(traffic.withTraffic)} of ${fmtCount(traffic.known)}`,
        text: ` ${traffic.known === 1 ? "IoT Hotspot" : "IoT Hotspots"}${withData} delivered messages in the ${trafficWindow}.`,
      });
      lines.push({
        strong: fmtCount(traffic.messages30d),
        text: ` ${traffic.messages30d === 1 ? "message" : "messages"}, summed across your Hotspots`,
        tip: { label: "About this total", text: `${IOT_MESSAGES_NOTE} Summed over the 30 days across your Hotspots.` },
      });
    }
    // The 30-day window is partial when the published build is missing days
    // (only when the rows come from that same build).
    const build = indexForBuild(utilizationIndex, s.trafficRange?.max);
    if (traffic.known > 0 && build && build.daysComplete < build.days) lines.push({ text: fmtLowerBound(build.daysComplete, build.days) });
    subs = { title: "Messages delivered", lines };
  }

  const notes =
    done && s.failed > 0 ? [{ text: `Couldn't check IoT status for ${many(s.failed, "Hotspot", "Hotspots")}.`, retry: true, details: null }] : [];

  const positive =
    done && live && traffic.known > 0 && tiers.every((t) => t.tier === "ok" || t.n === 0)
      ? `No issues ${onDay} or in the ${trafficWindow}.`
      : null;

  const foot = [IOT_CONNECTIVITY_NOTE];
  if (live && traffic.withTraffic > 0) foot.push(MULTI_BUY);
  if (live) {
    const left = [
      s.settingUp > 0 && `${fmtCount(s.settingUp)} setting up`,
      s.notFound > 0 && `${fmtCount(s.notFound)} unknown`,
      s.failed > 0 && `${fmtCount(s.failed)} couldn't be checked`,
    ].filter(Boolean);
    if (left.length) foot.push(`Not counted in the figures above: ${left.join(", ")}.`);
  }
  if (done && live && traffic.known > 0 && traffic.known < total) {
    foot.push(`Not counted in the messages figures: ${fmtCount(total - traffic.known)} without traffic data.`);
  }

  return {
    net: "iot",
    title: "Connectivity and traffic",
    window: "Connectivity by UTC day, messages over 30 days",
    chip: !done ? { kind: "checking" } : allFailed ? { kind: "failed" } : { kind: "day", text: dayChipText(s.livenessRange, s.trafficRange) },
    progress: !done
      ? {
          now: s.counted,
          max: total,
          label: "IoT Hotspots checked",
          text: `Checking ${fmtCount(s.counted)} of ${many(total, "IoT Hotspot", "IoT Hotspots")}…`,
        }
      : null,
    loading,
    loadingSr: "Checking IoT health",
    skel: { sub: true, rows: 2 },
    headline,
    notes,
    subs,
    bar: loading ? null : tierBar(tiers, { denom: total, big, aria: "IoT Hotspots by status" }),
    positive,
    rows,
    rowsAria: "IoT status groups",
    extra: null,
    foot,
  };
}
