// View model for the LoRaWAN Traffic Map. Pure: no DOM, no fetch, no React, no map
// library, so it runs in the browser and in the Node test runner. The reads it
// works on come from lib/iotStatusApi.js (fetchNetworkTraffic, fetchOuiTraffic).
import { labelOuis } from "../lib/wellKnownOuis.js";

export const WINDOWS = ["1d", "7d", "30d"];
export const DEFAULT_WINDOW = "30d";
/** A point's packet count field per window. */
export const PROP = { "1d": "p1", "7d": "p7", "30d": "p30" };

// ---- palette ----
// Twenty colors on a golden-angle hue ramp (hue i * 137.508°, alternating
// saturation and lightness), handed out by rank (busiest OUI first) and cycled
// past twenty. Neighbouring ranks land far apart on the wheel.
export const PALETTE = [
  "#e74040", "#2dbe57", "#851ad1", "#d6c651", "#1ab2d1", "#be2d7b", "#6ae740", "#332dbe",
  "#d1571a", "#51d6a5", "#c21ad1", "#a0be2d", "#4094e7", "#be2d4b", "#1ad129", "#8451d6",
  "#d1941a", "#2dbeb8", "#e740bd", "#6fbe2d",
];
export const palette = (i) => PALETTE[i % PALETTE.length];
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// ---- OUI rows ----

/**
 * The index's OUIs (one per LoRaWAN network operator) as the page shows them:
 * busiest first by 30-day packets (ties by id), colored by that rank, and named
 * from Helium's well-known list where it has them. `names` is the Map from fetchWellKnownOuiNames, or null
 * when the list didn't load (every OUI then reads "OUI <n>").
 */
export function buildOuiRows(index, names) {
  const sorted = [...index.ouis].sort((a, b) => b.packets["30d"] - a.packets["30d"] || a.oui - b.oui);
  const labels = labelOuis(sorted.map((o) => o.oui), names);
  return sorted.map((o, i) => ({
    oui: o.oui,
    name: labels[i].fullName,
    color: palette(i),
    rgb: hexToRgb(palette(i)),
    rank: i,
    hotspots: o.hotspots,
    packets: o.packets,
    search: `${o.oui} oui ${o.oui} ${labels[i].fullName ?? ""}`.toLowerCase(),
  }));
}

/** An operator in words: its well-known name with its OUI number, or the number alone. */
export const ouiLabel = (row) => (row.name ? `${row.name} (OUI ${row.oui})` : `OUI ${row.oui}`);

// ---- packet range ----

export const SLIDER_MAX = 1000;

/**
 * Whether a count passes the packet range. With the upper handle at the end of
 * the track (`open`) there is no upper bound: the index and a per-OUI file can
 * come from different builds around a nightly publish, and a point above the
 * index's maxPackets must still show at full range.
 */
export const inRange = (p, lo, hi, open) => p >= lo && (open || p <= hi);

/** Slider position (0..SLIDER_MAX, log scale) to a packet threshold in 1..max. */
export function sliderToThreshold(pos, max) {
  if (pos <= 0) return 1;
  if (pos >= SLIDER_MAX) return max;
  return Math.min(max, Math.max(1, Math.round(10 ** ((pos / SLIDER_MAX) * Math.log10(max)))));
}

export function thresholdToSlider(threshold, max) {
  if (threshold <= 1 || max <= 1) return 0;
  if (threshold >= max) return SLIDER_MAX;
  return Math.round(Math.min(1, Math.log10(threshold) / Math.log10(max)) * SLIDER_MAX);
}

/**
 * A stored range fitted to a window whose busiest count is `max`: the lower
 * bound is clamped into [1, max]; an open upper bound sits at `max`, and a set
 * one is clamped into [lo, max] and counts as open once it reaches `max`.
 */
export function clampRange({ lo, hi, open }, max) {
  const nextLo = Math.min(Math.max(1, lo), max);
  const nextHi = open ? max : Math.min(Math.max(hi, nextLo), max);
  return { lo: nextLo, hi: nextHi, open: open || nextHi >= max };
}

const fmt = (n) => n.toLocaleString("en-US");

export function rangeLabel({ lo, hi, open }) {
  if (open) return lo <= 1 ? "any number of packets" : `at least ${fmt(lo)} packets`;
  return `${fmt(lo)} to ${fmt(hi)} packets`;
}

// ---- dots ----

/** Largest dot radius (px), at a million packets and beyond. */
export const MAX_RADIUS = 11;
const RADIUS_STOPS = [[0, 2.5], [2, 4], [4, 7], [6, MAX_RADIUS]];

/** Dot radius in px: linear between stops on log10(packets). */
export function radiusFor(packets) {
  const x = Math.log10(Math.max(1, packets));
  for (let i = 1; i < RADIUS_STOPS.length; i++) {
    const [x1, r1] = RADIUS_STOPS[i];
    if (x <= x1) {
      const [x0, r0] = RADIUS_STOPS[i - 1];
      return r0 + ((x - x0) / (x1 - x0)) * (r1 - r0);
    }
  }
  return MAX_RADIUS;
}

// ---- what is shown ----

/**
 * Small integer ids for a layer's Hotspots, index-aligned with its points, from
 * a registry shared by every layer of one load. They let countShown() count
 * unique Hotspots with a typed-array check instead of a Set of 51-character
 * keys on every slider move.
 */
export function assignHotspotIds(points, registry) {
  const ids = new Uint32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    let id = registry.get(points[i].address);
    if (id === undefined) registry.set(points[i].address, (id = registry.size));
    ids[i] = id;
  }
  return ids;
}

/**
 * Counts for the current filters. `layers` is Map oui -> { points, ids }.
 * Per OUI: `pass`, its located Hotspots inside the packet range, and
 * `passPackets`, their packets. Across the OUIs in `enabled`: `unique`
 * Hotspots (one delivering for two OUIs counts once) and `packets`.
 * `scratch` is { seen: Uint32Array, epoch } and is reused between calls: a
 * fresh epoch empties `seen` without clearing it.
 */
export function countShown({ rows, layers, enabled, win, range, scratch }) {
  const key = PROP[win];
  const { lo, hi, open } = range;
  const epoch = ++scratch.epoch;
  const { seen } = scratch;
  const perOui = new Map();
  let unique = 0;
  let packets = 0;
  for (const row of rows) {
    const layer = layers.get(row.oui);
    const on = enabled.has(row.oui);
    let pass = 0;
    let passPackets = 0;
    if (layer) {
      const { points, ids } = layer;
      for (let i = 0; i < points.length; i++) {
        const p = points[i][key];
        if (p <= 0 || !inRange(p, lo, hi, open)) continue;
        pass++;
        passPackets += p;
        if (on && seen[ids[i]] !== epoch) {
          seen[ids[i]] = epoch;
          unique++;
        }
      }
    }
    if (on) packets += passPackets;
    perOui.set(row.oui, { pass, passPackets, loaded: !!layer });
  }
  return { perOui, unique, packets };
}

/** [west, south, east, north] over the given OUIs' points, or null if none. */
export function boundsOf(layers, ouis) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const oui of ouis) {
    const points = layers.get(oui)?.points;
    if (!points) continue;
    for (const { lng, lat } of points) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

// ---- the drawn scene ----

/** Outline width (px) around every dot. */
export const STROKE_WIDTH = 0.6;

/**
 * Every loaded dot as flat arrays, in the order the map draws them: operator
 * by operator along `order` (a later one on top), each in its file's order.
 * One layer draws the whole network from these in a single call, and the
 * page's own hit test reads the same arrays, so what is drawn and what can be
 * hovered or clicked can't drift apart.
 *   positions  Float64Array, [lng, lat] per dot
 *   colors     Uint8Array, [r, g, b, alpha] per dot: its operator's color
 *   points     the point objects, for what a hit names
 *   rowIndex   Uint16Array, each dot's operator as an index into `rows`
 */
export function buildScene(order, layers, alpha = 255) {
  let length = 0;
  for (const row of order) length += layers.get(row.oui)?.points.length ?? 0;
  const positions = new Float64Array(length * 2);
  const colors = new Uint8Array(length * 4);
  const points = new Array(length);
  const rowIndex = new Uint16Array(length);
  const rows = [];
  let i = 0;
  for (const row of order) {
    const list = layers.get(row.oui)?.points;
    if (!list?.length) continue;
    const r = rows.push(row) - 1;
    const [red, green, blue] = row.rgb;
    for (const point of list) {
      positions[i * 2] = point.lng;
      positions[i * 2 + 1] = point.lat;
      colors[i * 4] = red;
      colors[i * 4 + 1] = green;
      colors[i * 4 + 2] = blue;
      colors[i * 4 + 3] = alpha;
      points[i] = point;
      rowIndex[i] = r;
      i++;
    }
  }
  return { length, positions, colors, points, rowIndex, rows };
}

/**
 * Each dot's drawn size under the filters, index-aligned with the scene:
 * `radius` (px, by its packets in the window) and `lineWidth` (its outline).
 * Both are 0 for a dot the filters hide (operator switched off, no packets in
 * the window, outside the packet range), so it draws nothing and can't be hit.
 * These two arrays are all that is rebuilt when a filter moves.
 */
export function sceneSizes(scene, { enabled, win, range }) {
  const key = PROP[win];
  const { lo, hi, open } = range;
  const { length, points, rowIndex } = scene;
  const on = scene.rows.map((row) => enabled.has(row.oui));
  const radius = new Float32Array(length);
  const lineWidth = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (!on[rowIndex[i]]) continue;
    const p = points[i][key];
    if (p <= 0 || !inRange(p, lo, hi, open)) continue;
    radius[i] = radiusFor(p);
    lineWidth[i] = STROKE_WIDTH;
  }
  return { radius, lineWidth };
}

// ---- hovering and clicking the map ----

/** How far (px) around the click a dot still counts as clicked. */
export const CLICK_PAD = 6;

/**
 * A test for "does dot i's drawn circle come within `pad` px of (x, y)".
 * `project` maps [lng, lat] to screen px and `unproject` the reverse (a
 * deck.gl viewport's). Only dots inside the lng/lat box that can reach the
 * spot are projected; the rest are skipped on two comparisons.
 */
function reachTest(scene, radius, { x, y, pad, project, unproject }) {
  const reach = pad + MAX_RADIUS + STROKE_WIDTH;
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => unproject([x + sx * reach, y + sy * reach]));
  const west = Math.min(...corners.map((c) => c[0]));
  const east = Math.max(...corners.map((c) => c[0]));
  const south = Math.min(...corners.map((c) => c[1]));
  const north = Math.max(...corners.map((c) => c[1]));
  const { positions } = scene;
  return (i) => {
    const size = radius[i];
    if (size === 0) return false;
    const lng = positions[i * 2];
    if (lng < west || lng > east) return false;
    const lat = positions[i * 2 + 1];
    if (lat < south || lat > north) return false;
    const [px, py] = project([lng, lat]);
    const dx = Math.max(Math.abs(px - x) - pad, 0);
    const dy = Math.max(Math.abs(py - y) - pad, 0);
    const r = size + STROKE_WIDTH;
    return dx * dx + dy * dy <= r * r;
  };
}

/**
 * The dot drawn on top at (x, y): the index of the last drawn dot whose circle
 * covers that spot, or -1 over empty map. `radius` is sceneSizes().radius. The
 * map's hover reads this instead of a GPU picking pass.
 */
export function topDotAt(scene, radius, { x, y, project, unproject }) {
  const touches = reachTest(scene, radius, { x, y, pad: 0, project, unproject });
  for (let i = scene.length - 1; i >= 0; i--) if (touches(i)) return i;
  return -1;
}

/**
 * Every shown dot under a click: the dots whose drawn circle comes within
 * CLICK_PAD px of (x, y), as [{ oui, point }] in draw order.
 */
export function hitsNear(scene, radius, { x, y, project, unproject }) {
  const touches = reachTest(scene, radius, { x, y, pad: CLICK_PAD, project, unproject });
  const hits = [];
  for (let i = 0; i < scene.length; i++) {
    if (touches(i)) hits.push({ oui: scene.rows[scene.rowIndex[i]].oui, point: scene.points[i] });
  }
  return hits;
}

/** Whether a point draws a dot under the filters: packets in the window, inside the packet range. */
export function isShown(point, win, { lo, hi, open }) {
  const p = point[PROP[win]];
  return p > 0 && inRange(p, lo, hi, open);
}

/**
 * The clicked dots the map still shows under the current filters: operator
 * switched on, packets in the window, inside the packet range. A clicked
 * spot's list is built from these, so it never names a Hotspot whose dot is
 * gone. Returns [] when nothing at the spot is shown any more.
 */
export function shownHits(hits, { enabled, win, range }) {
  return hits.filter(({ oui, point }) => enabled.has(oui) && isShown(point, win, range));
}

/**
 * Clicked dots grouped into one row per Hotspot, busiest first: { address,
 * lng, lat, total, per: [{ oui, packets }] } with `per` busiest first too.
 * `sameSpot` says whether every row shares one coordinate.
 */
export function groupHits(hits, win) {
  const key = PROP[win];
  const byAddress = new Map();
  for (const { oui, point } of hits) {
    let row = byAddress.get(point.address);
    if (!row) byAddress.set(point.address, (row = { address: point.address, lng: point.lng, lat: point.lat, total: 0, per: [] }));
    if (row.per.some((x) => x.oui === oui)) continue;
    row.per.push({ oui, packets: point[key] });
    row.total += point[key];
  }
  const rows = [...byAddress.values()].sort((a, b) => b.total - a.total || (a.address < b.address ? -1 : 1));
  for (const row of rows) row.per.sort((a, b) => b.packets - a.packets || a.oui - b.oui);
  const sameSpot = rows.every((r) => r.lng === rows[0].lng && r.lat === rows[0].lat);
  return { rows, sameSpot };
}

// ---- URL state ----
// ?window=7d&ouis=12,691&min=100&max=5000. Every parameter is optional: the
// defaults are the 30-day window, every OUI, and the full packet range.

/** Parse the URL's filters. Unknown or malformed values fall back to defaults. */
export function readUrlState(params) {
  const win = WINDOWS.includes(params.get("window")) ? params.get("window") : DEFAULT_WINDOW;
  const raw = params.get("ouis");
  let ouis = null; // null = every OUI
  if (raw === "none") ouis = [];
  else if (raw) {
    const ids = raw.split(",").map((s) => (/^\d{1,9}$/.test(s) ? Number(s) : NaN)).filter(Number.isInteger);
    if (ids.length) ouis = [...new Set(ids)];
  }
  const whole = (name) => (/^\d{1,12}$/.test(params.get(name) || "") ? Math.max(1, Number(params.get(name))) : null);
  return { win, ouis, min: whole("min"), max: whole("max") };
}

/** The query string for the current filters ("" at the defaults). */
export function writeUrlState({ win, enabled, allOuis, range }) {
  const params = new URLSearchParams();
  if (win !== DEFAULT_WINDOW) params.set("window", win);
  if (enabled.size !== allOuis.length) {
    params.set("ouis", enabled.size ? allOuis.filter((oui) => enabled.has(oui)).sort((a, b) => a - b).join(",") : "none");
  }
  if (range.lo > 1) params.set("min", String(range.lo));
  if (!range.open) params.set("max", String(range.hi));
  // Commas are legal in a query string; keep them readable.
  return params.toString().replace(/%2C/g, ",");
}

// ---- dates ----

/** "2026-11-09" as "Nov 9" (the data days are UTC calendar days). */
export function fmtDay(day, { year = false } = {}) {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...(year ? { year: "numeric" } : null) });
}

/** A window's dates: "Nov 9", or "Oct 11 to Nov 9". */
export function fmtWindow({ start, end }) {
  return start === end ? fmtDay(end) : `${fmtDay(start)} to ${fmtDay(end)}`;
}
