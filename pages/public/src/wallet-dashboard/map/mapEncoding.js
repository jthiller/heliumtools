// ── How the map draws a Hotspot and a site ──────────────────────────────────
// One encoding for every map surface (the fleet map's canvas dots, the loupe
// and the phone preview's HTML dots, the legend's swatches): a single
// Hotspot's fill, size and status ring (Network mode) or status shape
// (Health mode), a site marker's ring and counts, and the words a dot or
// marker says (tooltip lines, accessible names). Everything is read from the
// unified list's rows (hotspotList.js) and the status registry, never
// re-derived. Pure: no React, no DOM.
import { COVERAGE_RSSI_MAX, COVERAGE_RSSI_MIN, fmtAgo, fmtBytes, fmtCount, fmtDataDay, fmtDbm, fmtHnt, plural } from "../format.js";
import { needsLine } from "../copy.js";
import { cellToBoundary, cellToParent } from "h3-js";
import { fmtClock, fmtLocationSource, fmtMeters, fmtMultiplier } from "../mobileFormat.js";
import { TIERS, needsALook } from "../statusRegistry.js";

// ── Single Hotspots ─────────────────────────────────────────────────────────

/** 30-day IoT messages at or above this read as busy (the largest dot). */
export const BUSY_MESSAGES = 1000;
/** Dot diameters (px): IoT by 30-day messages, every other dot one size. */
export const DOT_SIZE = { quiet: 10, some: 13, busy: 20, base: 16 };
/** Health-mode shapes are one size. */
export const HEALTH_SIZE = 16;
/** Alpha for a dot outside the list filter, and for a never-rewarded dot (quiet). */
export const DIM_ALPHA = 0.3;
export const QUIET_ALPHA = 0.55;

/** The status key a row's dot shows: its top tier, "checking" while a source is pending. */
function dotTier(row) {
  return row.top?.key === "checking" ? "checking" : row.tier;
}

/**
 * One Hotspot's dot.
 * @param {object} row  a HotspotRow
 * @param {"network"|"health"} mode
 * @returns {{ id: string, mode, fill, size, ring, shape, tier, quiet: boolean }}
 *   Network mode: `fill` "mobile" | "iot" | "dual" | "neutral" | "hollow" (not
 *   reported: an Unknown-tier row), `size` 10 / 13 / 20 by 30-day IoT messages
 *   (16 for Mobile and for IoT without a message count), `ring` "critical" |
 *   "caution" (needs a look) | "checking" | null, `quiet` (never rewarded:
 *   drawn faded, network kept). Health mode: `shape` = the tier ("critical",
 *   "caution", "quiet", "info", "unknown", "ok", "checking"), one size.
 *   `id` names the sprite (markerIcons.js) and the CSS look (dotStyle).
 */
export function dotOf(row, mode) {
  const tier = dotTier(row);
  if (mode === "health") {
    const shape = tier === "serious" ? "critical" : tier === "check" ? "caution" : tier;
    return { id: `h-${shape}`, mode, shape, size: HEALTH_SIZE, tier, fill: null, ring: null, quiet: false };
  }
  const { nets } = row;
  const fill =
    tier === "unknown" ? "hollow" : nets.dual ? "dual" : nets.iot ? "iot" : nets.mobile && !nets.cbrs ? "mobile" : "neutral";
  const msgs = row.messages;
  const size =
    nets.iot && msgs.state === "ok"
      ? msgs.count === 0
        ? DOT_SIZE.quiet
        : msgs.count < BUSY_MESSAGES
          ? DOT_SIZE.some
          : DOT_SIZE.busy
      : DOT_SIZE.base;
  const ring = tier === "serious" ? "critical" : tier === "check" ? "caution" : tier === "checking" ? "checking" : null;
  return { id: `${fill}-${size}-${ring ?? "none"}`, mode, fill, size, ring, shape: null, tier, quiet: tier === "quiet" };
}

const css = (token) => `rgb(var(${token}))`;
const RAISED = css("--color-surface-raised");
const FILL = {
  mobile: css("--wd-mobile"),
  iot: css("--wd-iot"),
  neutral: css("--wd-ink-4"),
  dual: `linear-gradient(90deg, ${css("--wd-iot")} 50%, ${css("--wd-mobile")} 50%)`,
  hollow: RAISED,
};
const RING = { critical: css("--wd-critical"), caution: css("--wd-caution") };
const TRIANGLE = "polygon(50% 4%, 100% 94%, 0 94%)";

/**
 * A dot's CSS look (the design's `.mp-mk` set), for HTML dots: the loupe, the
 * phone preview and legend swatches. `size` overrides the diameter (legend
 * swatches). Returns `{ className, style, triangle }`: Health mode's Serious,
 * Quiet and Info dots are the status marks themselves (`.wd-st-*`, scaled up
 * on a raised halo); `triangle` asks for the raised triangle a Check mark
 * sits on.
 */
export function dotStyle(dot, size = dot.size) {
  const base = { display: "block", flex: "none", width: size, height: size, borderRadius: "50%" };
  const halo = `0 0 0 1.5px ${RAISED}`;
  const hollow = `inset 0 0 0 2px ${css("--wd-ink-3")}`;
  if (dot.mode === "health") {
    const scale = { transform: `scale(${(size / 12).toFixed(3)})` };
    switch (dot.shape) {
      case "critical":
        return { className: "wd-st wd-st-critical", style: { ...scale, boxShadow: `0 0 0 1.2px ${RAISED}` }, triangle: false };
      case "quiet":
      case "info":
        return { className: `wd-st wd-st-${dot.shape}`, style: { ...scale, background: RAISED, boxShadow: `0 0 0 1.2px ${RAISED}` }, triangle: false };
      case "caution":
        return { className: "", style: { ...base, borderRadius: 0, background: css("--wd-caution"), clipPath: TRIANGLE }, triangle: true };
      case "unknown":
        return { className: "", style: { ...base, background: RAISED, boxShadow: `${hollow}, ${halo}` }, triangle: false };
      case "checking":
        return { className: "", style: { ...base, background: RAISED, outline: `1.5px dashed ${css("--wd-ink-3")}`, outlineOffset: 1 }, triangle: false };
      default:
        return { className: "", style: { ...base, background: css("--wd-ink-3"), boxShadow: halo }, triangle: false };
    }
  }
  const style = { ...base, background: FILL[dot.fill] ?? FILL.neutral, boxShadow: halo };
  const inset = dot.fill === "hollow" ? `${hollow}, ` : "";
  style.boxShadow = `${inset}${halo}`;
  if (dot.ring === "critical" || dot.ring === "caution") style.boxShadow = `${inset}${halo}, 0 0 0 3.5px ${RING[dot.ring]}`;
  if (dot.ring === "checking") {
    style.outline = `1.5px dashed ${css("--wd-ink-3")}`;
    style.outlineOffset = 2.5;
  }
  if (dot.quiet) style.opacity = QUIET_ALPHA;
  return { className: "", style, triangle: false };
}

/** Draw order: big dots first, problem dots after, the selection last. */
export function dotRank(dot, selected) {
  const problem = dot.tier === "serious" || dot.tier === "check" ? 1 : 0;
  return (selected ? 1000 : 0) + problem * 100 + (40 - dot.size);
}

// ── Words a dot says ────────────────────────────────────────────────────────

/** "Mobile WiFi Indoor", "IoT Full · also on Mobile" (a dual-network Hotspot). */
export function deviceText(row) {
  return row.nets.dual ? `${row.deviceLabel} · also on Mobile` : row.deviceLabel;
}

/** The day a Mobile row's daily HNT is for: "Oct 14 (UTC)". */
export function earnedDayLabel(row, ctx) {
  return row.day?.day ? `${fmtDataDay(row.day.day)} (UTC)` : (ctx?.rewardsDayLabel ?? "latest UTC day");
}

const PENDING_WORD = { loading: "Loading", missing: "No data", failed: "Couldn't load", unavailable: "Unavailable" };

/**
 * The money line a dot leads with (portfolio first): a Mobile Hotspot's HNT
 * on the latest UTC day ("Earned Oct 14 (UTC): 0.10 HNT"), anything else its
 * lifetime ("Lifetime earned 14.29 HNT", "Never rewarded", "Lifetime earned
 * ≥ 137.89 HNT").
 */
export function moneyLine(row, ctx) {
  if (row.mobile) {
    const d = row.day;
    const value = d.state === "ok" ? `${fmtHnt(d.hnt, "list")} HNT` : (PENDING_WORD[d.state] ?? "Loading");
    return `Earned ${earnedDayLabel(row, ctx)}: ${value}`;
  }
  const l = row.lifetime;
  if (l.state === "ok") {
    if (l.never) return "Never rewarded";
    return `Lifetime earned ${l.lowerBound ? "≥ " : ""}${fmtHnt(l.hnt, "list")} HNT`;
  }
  return `Lifetime earned: ${PENDING_WORD[l.state] ?? "Loading"}`;
}

/** A state's label as shown, with a heartbeat's age: "Heartbeat 17m ago". */
export function stateLabel(state, now) {
  if (state.key === "heartbeatOk" && state.at) return `${state.label} ${fmtAgo(state.at, now)}`;
  return state.label;
}

/** "No heartbeat · last 60 min"; "Checking…" alone. */
export function statusLine(state, now) {
  const label = stateLabel(state, now);
  return state.window ? `${label} · ${state.window}` : label;
}

/** The IoT messages line ("61,345 messages, 30 days to Oct 14 (UTC)") when the
 * row's leading state is an IoT state with one; null otherwise. */
export function messagesLine(row) {
  const top = row.top;
  return top?.network === "iot" && top.window2 ? top.window2 : null;
}

/** "Also: No heartbeat, last 60 min" (and "+1 more" past two states); null for one state. */
export function alsoLine(row, now) {
  const second = row.states[1];
  if (!second) return null;
  const more = row.states.length > 2 ? `, +${row.states.length - 2} more` : "";
  return `Also: ${stateLabel(second, now)}${second.window ? `, ${second.window}` : ""}${more}`;
}

/** A tier's label tone (the registry's text class). */
export const tierTextClass = (tier) => TIERS[tier]?.textClass ?? "text-wd-ink-2";

/**
 * Everything a dot's tooltip shows, top to bottom: name first (the landing
 * capture finds a dot by it), device, money, the leading state with its
 * window (Banned is always first: the registry orders states), the IoT
 * messages line, "Also: …", and a dual row's "Mobile: No status reported".
 * Every fact is also in the list row and the detail (pointer-only here).
 */
export function dotLines(row, ctx, now) {
  return {
    name: row.name || "Unnamed Hotspot",
    device: deviceText(row),
    money: moneyLine(row, ctx),
    status: statusLine(row.top, now),
    tier: row.tier,
    more: [messagesLine(row), alsoLine(row, now), row.netLine].filter(Boolean),
  };
}

/**
 * A dot's accessible name (the loupe's buttons), as WdMap's `dot()`:
 * "Best Mercurial Raven. Mobile WiFi Indoor, Lutz, FL. OK: Heartbeat 20m ago,
 * last 60 min. Earned Oct 14 (UTC): 0.10 HNT." plus "Doesn't match the
 * filter." and "Selected." when they apply.
 */
export function dotAria(row, ctx, { dim = false, selected = false, now } = {}) {
  const top = row.top;
  const status =
    top.key === "checking"
      ? "Checking status."
      : `${TIERS[top.tier]?.word ?? "Unknown"}: ${stateLabel(top, now)}${top.window ? `, ${top.window}` : ""}.`;
  const also = alsoLine(row, now);
  const msgs = messagesLine(row);
  return [
    `${row.name || "Unnamed Hotspot"}.`,
    `${deviceText(row)}, ${row.placeText}.`,
    status,
    also ? `${also}.` : null,
    `${moneyLine(row, ctx)}.`,
    msgs ? `${msgs}.` : null,
    row.netLine ? `${row.netLine}.` : null,
    dim ? "Doesn't match the filter." : null,
    selected ? "Selected." : null,
  ]
    .filter(Boolean)
    .join(" ");
}

// ── Sites ───────────────────────────────────────────────────────────────────

/**
 * Counts over a set of rows (one site, or a marker's merged sites). With
 * `cityOnly` (the caption already names the fleet's one region: "in 19
 * cities in Piemonte, Italia") place labels are the city alone.
 * { n, mobile (Mobile only), iot (IoT only), dual, none, need (Serious +
 * Check), crit (Serious), checking, matched (in the list filter), labels:
 * { [place label]: n }, query: the most common city (or state) for a list
 * search }.
 */
export function siteStats(rows, filterKeys, { cityOnly = false } = {}) {
  const s = { n: 0, mobile: 0, iot: 0, dual: 0, none: 0, need: 0, crit: 0, checking: 0, matched: 0, labels: {}, queries: {} };
  for (const r of rows) {
    s.n++;
    if (r.nets.dual) s.dual++;
    else if (r.nets.iot) s.iot++;
    else if (r.nets.mobile) s.mobile++;
    else s.none++;
    if (needsALook(r.tier)) s.need++;
    if (r.tier === "serious") s.crit++;
    if (r.tier === "checking") s.checking++;
    if (!filterKeys || filterKeys.has(r.key)) s.matched++;
    const label = (cityOnly && r.place.city) || r.place.label || r.placeText;
    s.labels[label] = (s.labels[label] ?? 0) + 1;
    const q = r.place.city || r.place.state;
    if (q) s.queries[q] = (s.queries[q] ?? 0) + 1;
  }
  return s;
}

/** Merge site stats (a marker of several whole sites). */
export function mergeStats(a, b) {
  const out = { ...a, labels: { ...a.labels }, queries: { ...a.queries } };
  for (const k of ["n", "mobile", "iot", "dual", "none", "need", "crit", "checking", "matched"]) out[k] += b[k];
  for (const [k, v] of Object.entries(b.labels)) out.labels[k] = (out.labels[k] ?? 0) + v;
  for (const [k, v] of Object.entries(b.queries)) out.queries[k] = (out.queries[k] ?? 0) + v;
  return out;
}

const byCount = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** The place labels of a marker, most Hotspots first. */
export const siteLabels = (stats) => byCount(stats.labels).map(([l]) => l);
/** The list search a marker filters to: its most common city (or state). */
export const siteQuery = (stats) => byCount(stats.queries)[0]?.[0] ?? null;

/** "Lutz, FL", or "Casale Monferrato, Piemonte +2" for several places. */
export function siteLabel(stats) {
  const labels = siteLabels(stats);
  return labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : (labels[0] ?? "Place not reported");
}

/** A marker's label pill: "Lutz, FL", or with a filter "New York, New York +2 · 321 of 2,171". */
export function siteLabelText(stats, filtered = false) {
  return `${siteLabel(stats)}${filtered ? ` · ${fmtCount(stats.matched)} of ${fmtCount(stats.n)}` : ""}`;
}

/**
 * Where a marker's label runs so it stays inside a map `width` px wide: a
 * label centred under a marker near a side would be cut off, so it runs
 * inward ("start": right from the marker, "end": left), about 7 px a
 * character at 12 px semibold.
 */
export function labelAlignAt(x, stats, filtered, width) {
  const half = (siteLabelText(stats, filtered).length * 7 + 16) / 2;
  return x - half < 4 ? "start" : x + half > width - 4 ? "end" : "center";
}

/** "none need a look", "1 needs a look", "3 need a look" (copy.needsLine for a group). */
export function needTxt(n) {
  return needsLine(n);
}

/** The network split for words: ", all Mobile." or ": 6 Mobile, 2 IoT." */
function netsText(s) {
  const parts = [];
  if (s.mobile) parts.push(`${fmtCount(s.mobile)} Mobile`);
  if (s.iot) parts.push(`${fmtCount(s.iot)} IoT`);
  if (s.dual) parts.push(`${fmtCount(s.dual)} on IoT and Mobile`);
  if (s.none) parts.push(`${fmtCount(s.none)} on no network`);
  if (parts.length === 1 && (s.mobile === s.n || s.iot === s.n)) return `, all ${s.mobile ? "Mobile" : "IoT"}`;
  return `: ${parts.join(", ")}`;
}

/** "8 Hotspots · 6 Mobile, 2 IoT" / "8 Hotspots · all Mobile" (the phone's By place rows). */
export function siteSub(stats) {
  return `${plural(stats.n, "Hotspot")} · ${netsText(stats).slice(2)}`;
}

/**
 * A site marker's accessible name, as WdMap's `site()`: "Lutz, FL. 8
 * Hotspots, all Mobile. 3 need a look. Zoom in." with the filter, the loupe
 * and the selection named when they apply.
 */
export function siteAria(stats, { filtered = false, loupe = false, selected = false } = {}) {
  // A merged marker can span dozens of places: name the three biggest.
  const labels = siteLabels(stats);
  const places =
    labels.length > 3 ? `${labels.slice(0, 3).join(", ")} and ${plural(labels.length - 3, "more place")}` : labels.join(", ");
  const head = `${places}. ${plural(stats.n, "Hotspot")}${netsText(stats)}.`;
  let status;
  if (stats.need === 0 && stats.checking > 0) status = "Checking status.";
  else {
    const t = needTxt(stats.need);
    status = `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
    if (stats.checking > 0) status += ` ${fmtCount(stats.checking)} still being checked.`;
  }
  return [
    head,
    status,
    filtered ? `${fmtCount(stats.matched)} of ${fmtCount(stats.n)} match the filter.` : null,
    loupe ? "Shown up close in the inset." : null,
    selected ? "Includes the selected Hotspot." : null,
    "Zoom in.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * A marker's ring (CSS background): split by network (Mobile violet, IoT
 * green, a dual Hotspot half each, no network ink-4), or by status in Health
 * mode (Serious critical, Check caution, checking ink-4, the rest ink-3).
 */
export function siteRing(stats, mode) {
  const segs =
    mode === "health"
      ? [
          [css("--wd-critical"), stats.crit],
          [css("--wd-caution"), stats.need - stats.crit],
          [css("--wd-ink-4"), stats.checking],
          [css("--wd-ink-3"), stats.n - stats.need - stats.checking],
        ]
      : [
          [css("--wd-mobile"), stats.mobile + stats.dual / 2],
          [css("--wd-iot"), stats.iot + stats.dual / 2],
          [css("--wd-ink-4"), stats.none],
        ];
  const live = segs.filter(([, k]) => k > 0);
  if (live.length <= 1) return live[0]?.[0] ?? css("--wd-ink-3");
  let at = 0;
  const stops = live.map(([c, k]) => {
    const a = at;
    at += (k / stats.n) * 100;
    return `${c} ${Math.round(a)}% ${Math.round(at)}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

/** The marker's badge: the need-a-look count, "…" while it's checking. null for none. */
export function siteBadge(stats, filtered) {
  if (filtered) return null;
  if (stats.need > 0) return { text: fmtCount(stats.need), tier: stats.crit > 0 ? "serious" : "check" };
  if (stats.checking > 0) return { text: "…", tier: "checking" };
  return null;
}

/** Marker diameter: 52 px for 5 or more Hotspots, else 36 (44 / 30 in the phone preview). */
export const markerSize = (n, phone = false) => (n >= 5 ? (phone ? 44 : 52) : phone ? 30 : 36);

// ── Reported positions ──────────────────────────────────────────────────────

/**
 * One reported position as words (the position tooltip and the panel), the
 * selectedOverlay group's figures: "Reported position · 4 heartbeats in the
 * last 60 min · 31 m from asserted · Skyhook, trust 1.00 · last heard 20m
 * ago". A frozen window names its end and the last fix's time.
 */
export function positionText(group, hbWindow, now) {
  const frozen = hbWindow?.current === false;
  const heard = group.at ? (frozen ? `last heard at ${fmtClock(group.at, now)}` : `last heard ${fmtAgo(group.at, now)}`) : null;
  return [
    `Reported position · ${plural(group.count, "heartbeat")} ${hbWindow?.long ?? "in the last 60 min"}`,
    `${fmtMeters(group.distanceM)} from asserted`,
    [group.source && fmtLocationSource(group.source), group.trust != null && `trust ${fmtMultiplier(group.trust)}`]
      .filter(Boolean)
      .join(", ") || null,
    heard,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ── Modeled coverage footprint ──────────────────────────────────────────────

// One blue ramp over COVERAGE_RSSI_MIN to MAX, clear of the network and
// status hues; faintest at the floor. [r, g, b, alpha 0 to 1].
export const COVERAGE_RAMP = {
  light: { from: [183, 211, 246, 0.45], to: [28, 92, 171, 0.75] },
  dark: { from: [24, 79, 149, 0.45], to: [109, 167, 236, 0.8] },
};
// The service models coverage on res-8 cells.
const COVERAGE_RES = 8;

/** deck.gl fill ([r, g, b, 0 to 255]) for a modeled RSSI, along the ramp. */
export function coverageColor(rssi, dark) {
  const { from, to } = dark ? COVERAGE_RAMP.dark : COVERAGE_RAMP.light;
  const t = Math.min(1, Math.max(0, (rssi - COVERAGE_RSSI_MIN) / (COVERAGE_RSSI_MAX - COVERAGE_RSSI_MIN)));
  const [r, g, b, a] = from.map((v, i) => v + (to[i] - v) * t);
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)];
}

const cssRgba = ([r, g, b, a]) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
/** The ramp as a CSS gradient (legend and toggle swatches). */
export function rampCss(dark) {
  const { from, to } = dark ? COVERAGE_RAMP.dark : COVERAGE_RAMP.light;
  return `linear-gradient(to right, ${cssRgba(from)}, ${cssRgba(to)})`;
}

/** A whole dB value with a true minus sign: "−112 dBm". */
export { fmtDbm };

function h3Boundary(hex) {
  try {
    return cellToBoundary(hex, true);
  } catch {
    return null;
  }
}
function h3Parent(hex, res) {
  if (!hex) return null;
  try {
    return cellToParent(hex.toLowerCase(), res);
  } catch {
    return null;
  }
}

/**
 * The selected Hotspot's footprint as drawn: cells at or above the ramp's
 * floor with their outlines, plus the facts the coverage notes need
 * (`modeled`, `fromPreviousAssertion`, `onlyOwnCell`, `bounds` [w, s, e, n]).
 * null until cells load. `assertedHex`: the service record's location.
 */
export function deriveFootprint(cells, assertedHex) {
  if (!cells) return null;
  const ownCell = h3Parent(assertedHex, COVERAGE_RES);
  const drawn = [];
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const c of cells) {
    if (c.rssi < COVERAGE_RSSI_MIN) continue;
    const polygon = h3Boundary(c.hex);
    if (!polygon) continue;
    drawn.push({ ...c, polygon });
    for (const [lng, lat] of polygon) {
      w = Math.min(w, lng);
      e = Math.max(e, lng);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
  }
  const isOwn = (c) => c.hex.toLowerCase() === ownCell;
  return {
    modeled: cells.length,
    drawn,
    bounds: drawn.length ? [w, s, e, n] : null,
    // Built nightly from the asserted location at the time: a footprint that
    // misses the Hotspot's own cell predates its current assertion.
    fromPreviousAssertion: Boolean(ownCell) && cells.length > 0 && !cells.some(isOwn),
    onlyOwnCell: drawn.length === 1 && isOwn(drawn[0]),
  };
}

// ── Legend ──────────────────────────────────────────────────────────────────

/**
 * What a map draws, for the legend (rows only for encodings drawn):
 * { nets: {mobile, iot, dual, neutral}, rings: {critical, caution, checking},
 *   hollow, quiet, shapes: {critical, caution, quiet, info, unknown, ok,
 *   checking}, sizes: {10, 13, 20}, mobileDot, clusters, mixed, badge,
 *   unknownFailedOnly } built by `drawnOf` over the dots and markers.
 */
export function drawnOf({ dots = [], markers = [], mode }) {
  const d = {
    mode,
    nets: {},
    rings: {},
    shapes: {},
    sizes: {},
    hollow: false,
    quiet: false,
    mobileDot: false,
    clusters: markers.length > 0,
    mixed: false,
    badge: false,
    unknownKeys: new Set(),
  };
  for (const m of markers) {
    const s = m.stats;
    if (s.mobile || s.dual) d.nets.mobile = true;
    if (s.iot || s.dual) d.nets.iot = true;
    if ([s.mobile, s.iot, s.dual, s.none].filter((k) => k > 0).length > 1) d.mixed = true;
    if (m.badge && m.badge.tier !== "checking") d.badge = true;
  }
  for (const { dot, row } of dots) {
    if (mode === "health") d.shapes[dot.shape] = true;
    else {
      if (dot.fill === "hollow") d.hollow = true;
      else d.nets[dot.fill] = true;
      if (dot.ring) d.rings[dot.ring] = true;
      if (dot.quiet) d.quiet = true;
      if (row.nets.iot && row.messages.state === "ok") d.sizes[dot.size] = true;
      else if (dot.fill === "mobile" || dot.fill === "dual") d.mobileDot = true;
    }
    if (dot.tier === "unknown") d.unknownKeys.add(row.top.key);
  }
  return d;
}

/** A stable string for a drawn set (so legends re-render only when it changes). */
export function drawnSig(d) {
  if (!d) return "";
  const keys = (o) => Object.keys(o).filter((k) => o[k]).sort().join(",");
  return [d.mode, keys(d.nets), keys(d.rings), keys(d.shapes), keys(d.sizes), d.hollow, d.quiet, d.mobileDot, d.clusters, d.mixed, d.badge, [...d.unknownKeys].sort().join(",")].join("|");
}

/** Merge drawn sets (the main map plus the loupe). */
export function mergeDrawn(a, b) {
  if (!b) return a;
  if (!a) return b;
  return {
    ...a,
    nets: { ...a.nets, ...b.nets },
    rings: { ...a.rings, ...b.rings },
    shapes: { ...a.shapes, ...b.shapes },
    sizes: { ...a.sizes, ...b.sizes },
    hollow: a.hollow || b.hollow,
    quiet: a.quiet || b.quiet,
    mobileDot: a.mobileDot || b.mobileDot,
    clusters: a.clusters || b.clusters,
    mixed: a.mixed || b.mixed,
    badge: a.badge || b.badge,
    unknownKeys: new Set([...a.unknownKeys, ...b.unknownKeys]),
  };
}

/**
 * The legend's rows for what is drawn (WdMap `legend()`):
 *   { kind: "dot", dot, label } | { kind: "ring", background, label } |
 *   { kind: "badge", label } | { kind: "select" | "cell" | "pos" | "ramp", label, net? } |
 *   { kind: "head", label }
 * `overlay`: { cell: network | null, positions: boolean, window } for the
 * selected Hotspot's overlay; `footprint`: a footprint is drawn; `selected`:
 * a selected dot is drawn; `ctx` the list's window labels.
 */
export function legendRows(drawn, { selected = false, overlay = null, footprint = false, dark = false, ctx = {} } = {}) {
  if (!drawn) return [];
  const rows = [];
  const health = drawn.mode === "health";
  const dot = (d, label) => rows.push({ kind: "dot", dot: { mode: drawn.mode, size: 10, ring: null, fill: null, shape: null, quiet: false, ...d }, label });
  // A hollow dot is "Not reported", the Health shape the tier "Unknown";
  // both say "Couldn't check IoT status" when every one is a failed lookup.
  const failedOnly = drawn.unknownKeys.size > 0 && [...drawn.unknownKeys].every((k) => k === "iotFailed");
  const unknownLabel = failedOnly ? "Couldn't check IoT status" : health ? "Unknown" : "Not reported";
  if (!health) {
    if (drawn.nets.mobile) dot({ fill: "mobile" }, "Mobile");
    if (drawn.nets.iot) dot({ fill: "iot" }, "IoT");
    if (drawn.nets.dual) dot({ fill: "dual" }, "On IoT and Mobile");
    if (drawn.nets.neutral) dot({ fill: "neutral" }, "No network status");
  }
  if (drawn.clusters) {
    const byStatus = health;
    const background = byStatus
      ? `conic-gradient(${css("--wd-caution")} 0 50%, ${css("--wd-ink-3")} 50% 100%)`
      : drawn.mixed
        ? `conic-gradient(${css("--wd-mobile")} 0 70%, ${css("--wd-iot")} 70% 100%)`
        : drawn.nets.mobile
          ? css("--wd-mobile")
          : css("--wd-iot");
    rows.push({
      kind: "ring",
      background,
      label: byStatus
        ? "Group of nearby Hotspots, ring split by status"
        : drawn.mixed
          ? "Group of nearby Hotspots, ring split by network"
          : "Group of nearby Hotspots",
    });
  }
  if (drawn.badge) rows.push({ kind: "badge", label: "How many in the group need a look" });
  if (health) {
    const S = drawn.shapes;
    if (S.critical) dot({ shape: "critical" }, "Serious: needs a look");
    if (S.caution) dot({ shape: "caution", size: 13 }, "Check: needs a look");
    if (S.ok) dot({ shape: "ok" }, "OK");
    if (S.info) dot({ shape: "info" }, "Setting up");
    if (S.quiet) dot({ shape: "quiet" }, "Never rewarded");
    if (S.unknown) dot({ shape: "unknown" }, unknownLabel);
    if (S.checking) dot({ shape: "checking" }, "Checking status");
  } else {
    if (drawn.rings.critical) dot({ fill: "neutral", ring: "critical" }, "Serious: needs a look");
    if (drawn.rings.caution) dot({ fill: "neutral", ring: "caution" }, "Check: needs a look");
    if (drawn.hollow) dot({ fill: "hollow" }, unknownLabel);
    if (drawn.rings.checking) dot({ fill: "neutral", ring: "checking" }, "Checking status");
    if (drawn.quiet) dot({ fill: "neutral", quiet: true }, "Never rewarded");
  }
  if (selected) rows.push({ kind: "select", label: "Selected Hotspot" });
  if (overlay?.cell) rows.push({ kind: "cell", net: overlay.cell, label: "Asserted cell" });
  if (overlay?.positions) rows.push({ kind: "pos", label: `Reported positions (${overlay.window?.short ?? "60 min"})` });
  if (footprint) rows.push({ kind: "ramp", background: rampCss(dark), label: `Modeled coverage ${fmtDbm(COVERAGE_RSSI_MIN).replace(" dBm", "")} to ${fmtDbm(COVERAGE_RSSI_MAX)}` });
  if (!health) {
    const S = drawn.sizes;
    if (S[DOT_SIZE.quiet] || S[DOT_SIZE.some] || S[DOT_SIZE.busy]) {
      rows.push({ kind: "head", label: `IoT messages, ${ctx.trafficWindow ?? "30 days"}` });
      if (S[DOT_SIZE.quiet]) dot({ fill: "iot", size: DOT_SIZE.quiet }, "0");
      if (S[DOT_SIZE.some]) dot({ fill: "iot", size: DOT_SIZE.some }, `Under ${fmtCount(BUSY_MESSAGES)}`);
      if (S[DOT_SIZE.busy]) dot({ fill: "iot", size: DOT_SIZE.busy }, `${fmtCount(BUSY_MESSAGES)} or more`);
      if (drawn.mobileDot) dot({ fill: "mobile", size: DOT_SIZE.base }, "Mobile dots are one size");
    }
  }
  return rows;
}

/**
 * The windows line under the legend: "IoT status: Oct 14 (UTC). WiFi
 * heartbeats: last 60 min. Speedtests: last 24 h. Rewarded data: 7 days to
 * Oct 14 (UTC)." Frozen windows are named by their end; an IoT-only fleet
 * also names its messages window.
 */
export function windowsLine(list, iotStatus) {
  const ctx = list?.ctx ?? {};
  const c = list?.counts ?? {};
  const parts = [];
  if (c.iot > 0) {
    const allFailed = iotStatus?.iotTotal > 0 && iotStatus.failed >= iotStatus.iotTotal;
    parts.push(allFailed ? "IoT status: Couldn't check right now." : `IoT status: ${ctx.iotDayLabel ?? "latest reported UTC day"}.`);
    if (!c.mobileTables) parts.push(allFailed ? "Messages: Unavailable." : `Messages: ${ctx.trafficWindow ?? "Unavailable"}.`);
  }
  if (c.wifi > 0) {
    parts.push(`WiFi heartbeats: ${ctx.windows?.heartbeats?.span ?? "last 60 min"}.`);
    parts.push(`Speedtests: ${ctx.windows?.speedtests?.span ?? "last 24 h"}.`);
  }
  if (c.mobileTables > 0) parts.push(`Rewarded data: ${ctx.rewardsWindow ?? "7 days"}.`);
  return parts.join(" ");
}

/** "Mobile: 214 MB rewarded" style sub line for a Mobile row's day. */
export function rewardedSub(row) {
  const d = row.day;
  if (d.state !== "ok") return PENDING_WORD[d.state] ?? "Loading";
  return d.bytes > 0 ? `${fmtBytes(d.bytes)} rewarded` : "No rewarded data";
}
