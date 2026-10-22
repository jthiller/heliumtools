// ── Places and sites ─────────────────────────────────────────────────────────
// Where a fleet's Hotspots are, derived once per fleet: decoded positions, THE
// site derivation (Hotspots within 1 km of each other, single link), recorded
// places with their duplicate spellings, and the identity and map captions.
// The captions ("at 2 sites"), the map's site markers, the loupe and the phone
// "By place" list all read `sites`, so a site is the same thing everywhere.
// Places are shown as recorded (worker-side normalization is phase 2). Pure.
import { cellToLatLng } from "h3-js";
import { deviceLabelOf, fmtCount, plural } from "./format.js";
import { metersBetween } from "./mobile/tableMeta.js";

const SITE_M = 1000;
const CELL_DEG = 0.009; // ~1 km of latitude
const DEG = Math.PI / 180;

// US state names ↔ postal abbreviations: "FL" and "Florida" are one state
// recorded two ways.
const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", PR: "Puerto Rico",
};
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]));

/** One spelling-independent key for a recorded state ("Florida" → "FL"). */
function stateKeyOf(state) {
  if (!state) return null;
  const s = String(state).trim();
  if (US_STATES[s.toUpperCase()]) return s.toUpperCase();
  return STATE_BY_NAME[s.toLowerCase()] ?? s.toLowerCase();
}

/** A fleet row's H3 `location` (hex string) as { lat, lng }; null when unasserted or invalid. */
export function decodeLocation(hex) {
  if (!hex) return null;
  try {
    const [lat, lng] = cellToLatLng(hex);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

const placeLabel = (h) => (h.city && h.state ? `${h.city}, ${h.state}` : h.state || h.city || null);

function mostCommon(counts) {
  let best = null;
  for (const [label, n] of counts) if (label && (!best || n > best[1])) best = [label, n];
  return best?.[0] ?? null;
}

// Single-link groups within SITE_M, in O(n): bucket points into ~1 km grid
// cells (longitude scaled per latitude row), then union each point with the
// points within SITE_M in its own and the 8 neighbouring cells.
function groupSites(points) {
  const parent = points.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const rowOf = (lat) => Math.floor(lat / CELL_DEG);
  const colOf = (lng, row) => Math.floor((lng * Math.max(0.01, Math.cos((row + 0.5) * CELL_DEG * DEG))) / CELL_DEG);
  const grid = new Map();
  points.forEach((p, i) => {
    const row = rowOf(p.lat);
    const id = `${row}:${colOf(p.lng, row)}`;
    const cell = grid.get(id);
    if (cell) cell.push(i);
    else grid.set(id, [i]);
  });
  points.forEach((p, i) => {
    const row0 = rowOf(p.lat);
    for (let row = row0 - 1; row <= row0 + 1; row++) {
      const col0 = colOf(p.lng, row);
      for (let col = col0 - 1; col <= col0 + 1; col++) {
        for (const j of grid.get(`${row}:${col}`) || []) {
          if (j > i && metersBetween(p.lat, p.lng, points[j].lat, points[j].lng) <= SITE_M) union(i, j);
        }
      }
    }
  });
  const groups = new Map();
  points.forEach((p, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(p);
    else groups.set(r, [p]);
  });
  return [...groups.values()];
}

// Recorded places with duplicate spellings marked: an entry whose spelling
// isn't its group's most common one gets `aliasOf` that spelling.
function rollup(entries, keyOf) {
  const byLabel = new Map();
  for (const { label, key } of entries) {
    if (!label) continue;
    const e = byLabel.get(label) ?? { label, count: 0, keys: [], norm: keyOf(label) };
    e.count++;
    if (key) e.keys.push(key);
    byLabel.set(label, e);
  }
  const list = [...byLabel.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const canonical = new Map();
  for (const e of list) if (!canonical.has(e.norm)) canonical.set(e.norm, e.label);
  return list.map(({ norm, ...e }) => ({ ...e, aliasOf: canonical.get(norm) === e.label ? null : canonical.get(norm) }));
}

const cityKeyOf = (label) => {
  const [city, state] = label.split(", ");
  return `${city.toLowerCase()}|${stateKeyOf(state) ?? ""}`;
};

/** The network split for captions: "8 Mobile, 2 IoT", "1,647 Mobile, 9 on IoT and Mobile, 3 on no network". */
function networkSplit(c) {
  const parts = [];
  if (c.mobileOnly) parts.push(`${fmtCount(c.mobileOnly)} Mobile`);
  if (c.iotOnly) parts.push(`${fmtCount(c.iotOnly)} IoT`);
  if (c.dual) parts.push(`${fmtCount(c.dual)} on IoT and Mobile`);
  if (c.none) parts.push(`${fmtCount(c.none)} on no network`);
  return parts.join(", ");
}

/**
 * @param {object[]|undefined} hotspots  the fleet rows
 * @returns {null | {
 *   points: Array<{ key, lat, lng }>,                 asserted Hotspots, decoded once
 *   sites: Array<{ id, label, keys, count, lat, lng, bbox: [w, s, e, n] }>,  biggest first
 *   siteByKey: Map<entityKey, site>,
 *   cities: Array<{ label "Lutz, FL", count, keys, aliasOf }>,   as recorded, most first
 *   states: Array<{ label, count, keys, aliasOf }>, countries: Array<{ label, count, keys, aliasOf }>,
 *   region: string|null,                              "Piemonte, Italia" when every placed Hotspot shares one
 *   aliases: boolean,                                 some place is recorded two ways
 *   unasserted: number,
 *   counts: { total, mobileOnly, iotOnly, dual, none },
 *   caption(counts?): string                          the identity and map caption
 * }}  null while the fleet loads.
 */
export function deriveFleetPlaces(hotspots) {
  if (!Array.isArray(hotspots)) return null;
  const points = [];
  let unasserted = 0;
  const counts = { total: 0, mobileOnly: 0, iotOnly: 0, dual: 0, none: 0 };
  const cityEntries = [];
  const stateEntries = [];
  const countryEntries = [];
  const devices = new Map();
  for (const h of hotspots) {
    counts.total++;
    const nets = h.networks || [];
    const iot = nets.includes("iot");
    const mobile = nets.includes("mobile");
    if (iot && mobile) counts.dual++;
    else if (iot) counts.iotOnly++;
    else if (mobile) counts.mobileOnly++;
    else counts.none++;
    devices.set(h.deviceType ?? null, (devices.get(h.deviceType ?? null) ?? 0) + 1);
    const ll = decodeLocation(h.location);
    if (ll) points.push({ key: h.entityKey, lat: ll.lat, lng: ll.lng, label: placeLabel(h) });
    else unasserted++;
    cityEntries.push({ label: h.city ? placeLabel(h) : null, key: h.entityKey });
    stateEntries.push({ label: h.state || null, key: h.entityKey });
    countryEntries.push({ label: h.country || null, key: h.entityKey });
  }

  const siteByKey = new Map();
  const sites = groupSites(points)
    .map((members) => {
      const labels = new Map();
      let lat = 0;
      let lng = 0;
      let w = Infinity;
      let s = Infinity;
      let e = -Infinity;
      let n = -Infinity;
      for (const p of members) {
        labels.set(p.label, (labels.get(p.label) ?? 0) + 1);
        lat += p.lat;
        lng += p.lng;
        w = Math.min(w, p.lng);
        e = Math.max(e, p.lng);
        s = Math.min(s, p.lat);
        n = Math.max(n, p.lat);
      }
      return {
        id: `site:${members[0].key}`,
        label: mostCommon(labels) ?? "Place not reported",
        keys: members.map((p) => p.key),
        count: members.length,
        lat: lat / members.length,
        lng: lng / members.length,
        bbox: [w, s, e, n],
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  for (const site of sites) for (const k of site.keys) siteByKey.set(k, site);

  const cities = rollup(cityEntries, cityKeyOf);
  const states = rollup(stateEntries, (l) => stateKeyOf(l));
  const countries = rollup(countryEntries, (l) => l.toLowerCase());
  const canonicalStates = states.filter((s) => !s.aliasOf);
  const canonicalCountries = countries.filter((c) => !c.aliasOf);
  const region =
    canonicalStates.length === 1 && canonicalCountries.length === 1
      ? `${canonicalStates[0].label}, ${canonicalCountries[0].label}`
      : null;
  const aliases = cities.some((c) => c.aliasOf) || states.some((s) => s.aliasOf);
  const onlyDevice = devices.size === 1 ? [...devices.keys()][0] : undefined;
  const one = hotspots[0];

  const caption = (c = counts) => {
    if (!c.total) return "No Hotspots";
    if (c.total === 1) {
      const place = [one?.city, one?.state, one?.country].filter(Boolean).join(", ");
      const device = deviceLabelOf(one?.deviceType ?? "unknown");
      return place ? `1 Hotspot · ${device} in ${place}` : `1 Hotspot · ${device}`;
    }
    const all = c.mobileOnly === c.total ? "all Mobile" : c.iotOnly === c.total ? "all IoT" : null;
    const head = plural(c.total, "Hotspot");
    if (sites.length >= 1 && sites.length <= 3) {
      return `${head} at ${plural(sites.length, "site")} · ${all ?? networkSplit(c)}`;
    }
    const cityCount = cities.filter((x) => !x.aliasOf).length;
    if (region && cityCount > 1) return `${head} in ${plural(cityCount, "city", "cities")} in ${region} · ${all ?? networkSplit(c)}`;
    if (all && onlyDevice !== undefined) return `${head} · all ${deviceLabelOf(onlyDevice ?? "unknown")}`;
    return `${head} · ${all ?? networkSplit(c)}`;
  };

  return {
    points: points.map(({ key, lat, lng }) => ({ key, lat, lng })),
    sites,
    siteByKey,
    cities,
    states,
    countries,
    region,
    aliases,
    unasserted,
    counts,
    caption,
  };
}
