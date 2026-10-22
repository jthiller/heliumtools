// Site markers for the map: a supercluster index over the fleet's sites
// (fleetPlaces' `sites`, one point per site), so a marker is one site or
// several whole sites merged at low zoom, never part of one. At the current
// view a site still smaller than its marker stays a marker; once its extent
// spans more than the marker (or from zoom 15) it resolves into its single
// Hotspots, drawn by deck on the canvas. The same site the captions count
// ("at 2 sites") is the site the map draws.
import { useMemo } from "react";
import Supercluster from "supercluster";
import { WebMercatorViewport } from "@deck.gl/core";
import { markerSize, mergeStats, siteBadge, siteStats } from "./mapEncoding.js";

/** From this zoom every site resolves into its Hotspots. */
export const RESOLVE_ZOOM = 15;
const WORLD = [-180, -85, 180, 85];

const mercX = (lng, world) => ((lng + 180) / 360) * world;
function mercY(lat, world) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world;
}
/** A site's extent in screen px at `zoom` (512-px tiles, as deck and MapLibre). */
function spanPx([w, s, e, n], zoom) {
  const world = 512 * 2 ** zoom;
  return Math.max(Math.abs(mercX(e, world) - mercX(w, world)), Math.abs(mercY(s, world) - mercY(n, world)));
}

/**
 * Per-site counts over the list's rows (tiers, networks, the list filter's
 * matches) and the index over them. The index rebuilds only when those
 * counts change (a list flush that moves a tier, a filter change), not on
 * every flush.
 * @param {object} p
 * @param {object|null} p.places   deriveFleetPlaces result
 * @param {object} p.list          aggregateHotspotList result
 * @param {object} [p.filter]      filterRows result (dims what it doesn't match when `narrowed`)
 * @param {number} p.radius        merge radius in px (56 desktop, 48 phone)
 * @returns {{ index: Supercluster|null, statsById: Map, sitesById: Map, filtered: boolean, cityOnly: boolean }}
 */
export function useSiteClusters({ places, list, filter, radius }) {
  const filtered = Boolean(filter?.narrowed);
  const keys = filtered ? filter.keys : null;
  // Labels drop the state when the caption names the fleet's one region.
  const cityOnly = Boolean(places?.region) && (places?.sites?.length ?? 0) > 3;
  const statsById = useMemo(() => {
    const out = new Map();
    for (const site of places?.sites || []) {
      const rows = [];
      for (const k of site.keys) {
        const r = list?.byKey?.get(k);
        if (r) rows.push(r);
      }
      out.set(site.id, siteStats(rows, keys, { cityOnly }));
    }
    return out;
  }, [places, list, keys, cityOnly]);
  // What the index's cluster counts depend on, as one string.
  const sig = useMemo(() => {
    let s = `${filtered}|`;
    for (const [id, st] of statsById) s += `${id.length}:${st.n},${st.need},${st.crit},${st.checking},${st.matched};`;
    return s;
  }, [statsById, filtered]);
  const sitesById = useMemo(() => new Map((places?.sites || []).map((s) => [s.id, s])), [places]);

  const index = useMemo(() => {
    if (!places?.sites?.length) return null;
    const sc = new Supercluster({
      radius,
      extent: 512,
      maxZoom: 16,
      minPoints: 2,
      map: (p) => ({ stats: p.stats, siteIds: [p.siteId] }),
      reduce: (acc, p) => {
        acc.stats = mergeStats(acc.stats, p.stats);
        acc.siteIds = acc.siteIds.concat(p.siteIds);
      },
    });
    sc.load(
      places.sites.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { siteId: s.id, stats: statsById.get(s.id), siteIds: [s.id] },
      })),
    );
    return sc;
    // statsById is read through `sig`: the index follows the counts, not the flush.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, radius, sig]);

  // One object per change, so a pan (which re-renders the map every frame)
  // doesn't re-query the clusters or re-render the markers.
  return useMemo(() => ({ index, statsById, sitesById, filtered, cityOnly }), [index, statsById, sitesById, filtered, cityOnly]);
}

/**
 * The markers and single Hotspots at a view.
 * @param {object} c          useSiteClusters' result
 * @param {object} view       { longitude, latitude, zoom } (at the last settle or whole-zoom step)
 * @param {{ width, height }} size
 * @param {{ phone?: boolean, margin?: number }} [opts]  `margin`: markers kept this
 *   many viewport widths beyond the edges (so a pan reveals them before it settles)
 * @returns {{ markers: Array<{ id, lng, lat, stats, siteIds, site, clusterId, size, badge }>,
 *   singleKeys: string[], loupeSite: object|null }}
 *   `loupeSite`: the largest site of 5 or more Hotspots still drawn as a marker in view.
 */
export function queryClusters(c, view, size, { phone = false, margin = 0.6 } = {}) {
  const empty = { markers: [], singleKeys: [], loupeSite: null };
  if (!c?.index || !view || !size?.width || !size?.height) return empty;
  const zoom = view.zoom;
  const features = c.index.getClusters(WORLD, Math.floor(zoom));
  const vp = new WebMercatorViewport({ ...view, width: size.width, height: size.height });
  const [x0, y0] = [-size.width * margin, -size.height * margin];
  const [x1, y1] = [size.width * (1 + margin), size.height * (1 + margin)];
  const inBox = (lng, lat, pad = 0) => {
    const [x, y] = vp.project([lng, lat]);
    return x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad;
  };
  const inView = (lng, lat) => {
    const [x, y] = vp.project([lng, lat]);
    return x >= 0 && x <= size.width && y >= 0 && y <= size.height;
  };
  const markers = [];
  const singleKeys = [];
  let loupeSite = null;
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    const p = f.properties;
    if (p.cluster) {
      if (!inBox(lng, lat)) continue;
      const stats = p.stats;
      markers.push({
        id: `cluster:${p.siteIds[0]}:${p.siteIds.length}`,
        clusterId: p.cluster_id,
        lng,
        lat,
        stats,
        siteIds: p.siteIds,
        site: null,
        size: markerSize(stats.n, phone),
        badge: siteBadge(stats, c.filtered),
      });
      if (inView(lng, lat)) {
        for (const id of p.siteIds) {
          const s = c.sitesById.get(id);
          if (s && s.count >= 5 && (!loupeSite || s.count > loupeSite.count)) loupeSite = s;
        }
      }
      continue;
    }
    const site = c.sitesById.get(p.siteId);
    if (!site) continue;
    const stats = c.statsById.get(site.id) ?? p.stats;
    const mSize = markerSize(site.count, phone);
    if (site.count === 1 || zoom >= RESOLVE_ZOOM || spanPx(site.bbox, zoom) > mSize) {
      for (const k of site.keys) singleKeys.push(k);
      continue;
    }
    if (!inBox(site.lng, site.lat)) continue;
    markers.push({
      id: site.id,
      clusterId: null,
      lng: site.lng,
      lat: site.lat,
      stats,
      siteIds: [site.id],
      site,
      size: mSize,
      badge: siteBadge(stats, c.filtered),
    });
    if (site.count >= 5 && inView(site.lng, site.lat) && (!loupeSite || site.count > loupeSite.count)) loupeSite = site;
  }
  return { markers: separate(markers, vp, c, phone), singleKeys, loupeSite };
}

/**
 * Cluster centroids drift toward their heavier side, so two markers can end
 * up overlapping at this view. Merge any marker that would touch a bigger
 * one into it (whole sites only, weighted position), so markers never sit
 * on each other.
 */
function separate(markers, vp, c, phone) {
  if (markers.length < 2) return markers;
  let placed = markers.map((m) => {
    const [x, y] = vp.project([m.lng, m.lat]);
    return { m, x, y };
  });
  // A merged marker grows and moves, so pass again until nothing touches (a few passes at most).
  for (let pass = 0; pass < 4; pass++) {
    const next = mergePass(placed, c, phone);
    const done = next.length === placed.length;
    placed = next;
    if (done) break;
  }
  return placed.map((k) => {
    if (k.m.siteIds.length === 1 || k.m.clusterId != null) return k.m;
    const [lng, lat] = vp.unproject([k.x, k.y]);
    return { ...k.m, lng, lat };
  });
}

function mergePass(placed, c, phone) {
  const kept = [];
  const order = [...placed].sort((a, b) => b.m.stats.n - a.m.stats.n);
  for (const o of order) {
    const hit = kept.find((k) => Math.hypot(k.x - o.x, k.y - o.y) < (k.m.size + o.m.size) / 2 + 4);
    if (!hit) {
      kept.push({ ...o });
      continue;
    }
    const a = hit.m.stats.n;
    const b = o.m.stats.n;
    hit.x = (hit.x * a + o.x * b) / (a + b);
    hit.y = (hit.y * a + o.y * b) / (a + b);
    const stats = mergeStats(hit.m.stats, o.m.stats);
    const siteIds = hit.m.siteIds.concat(o.m.siteIds);
    hit.m = {
      ...hit.m,
      id: `cluster:${siteIds[0]}:${siteIds.length}`,
      clusterId: null,
      stats,
      siteIds,
      site: null,
      size: markerSize(stats.n, phone),
      badge: siteBadge(stats, c.filtered),
    };
  }
  return kept;
}

/**
 * Where a marker zooms to: a site to its own extent, a merged marker to the
 * zoom where it splits (supercluster's expansion zoom) or its sites'
 * extent, whichever is closer in. Returns `{ bounds: [w, s, e, n], minZoom }`.
 */
export function markerTarget(c, marker, currentZoom) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const id of marker.siteIds) {
    const site = c.sitesById.get(id);
    if (!site) continue;
    w = Math.min(w, site.bbox[0]);
    s = Math.min(s, site.bbox[1]);
    e = Math.max(e, site.bbox[2]);
    n = Math.max(n, site.bbox[3]);
  }
  let minZoom = Math.floor(currentZoom) + 1;
  if (marker.clusterId != null) {
    try {
      minZoom = Math.max(minZoom, c.index.getClusterExpansionZoom(marker.clusterId));
    } catch {
      // A stale cluster id (the index rebuilt): the extent alone decides.
    }
  }
  return { bounds: [w, s, e, n], minZoom };
}

// ── Camera math, shared by the fleet map, the loupe and the phone preview ──

/** [w, s, e, n] around `{ lat, lng }` points; null for none. */
export function boundsOf(points) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** Keep padding inside the box (a tiny box gets an even margin). */
export function fitPadding(p, { width, height }) {
  const pad = { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 };
  if (pad.left + pad.right >= width - 40 || pad.top + pad.bottom >= height - 40) {
    const m = Math.max(0, Math.round(Math.min(width, height) / 6));
    return { top: m, right: m, bottom: m, left: m };
  }
  return pad;
}

/**
 * The view that shows `bounds` ([w, s, e, n]) inside the padded area, centred
 * in it at the final zoom (fitBounds offsets for uneven padding at its
 * unclamped zoom, so at maxZoom a point could land under the panel).
 */
export function fitView(vs, size, bounds, { padding, maxZoom = 15, minZoom = 1 }) {
  const { width, height } = size;
  const pad = fitPadding(padding, size);
  const [w, s, e, n] = bounds;
  const base = { longitude: vs.longitude, latitude: vs.latitude, zoom: vs.zoom, pitch: 0, bearing: 0, width, height };
  let zoom;
  if (e - w < 1e-7 && n - s < 1e-7) zoom = maxZoom;
  else {
    const fit = new WebMercatorViewport(base).fitBounds([[w, s], [e, n]], { padding: pad, maxZoom });
    zoom = fit.zoom;
  }
  zoom = Math.max(minZoom, Math.min(maxZoom, zoom));
  const at = new WebMercatorViewport({ ...base, longitude: (w + e) / 2, latitude: (s + n) / 2, zoom });
  // The bounds' screen centre (Mercator, not the latitude midpoint) moves to the padded area's centre.
  const [x0, y0] = at.project([w, n]);
  const [x1, y1] = at.project([e, s]);
  const tx = pad.left + (width - pad.left - pad.right) / 2;
  const ty = pad.top + (height - pad.top - pad.bottom) / 2;
  const [longitude, latitude] = at.unproject([width / 2 + (x0 + x1) / 2 - tx, height / 2 + (y0 + y1) / 2 - ty]);
  return { longitude, latitude, zoom };
}
