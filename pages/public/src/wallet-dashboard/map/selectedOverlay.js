// The selected WiFi Hotspot's heartbeat geometry, in one place: its asserted
// res-12 cell, its reported positions (fixes within `groupM` grouped), lines
// out to the positions farther than `farM` from the cell's centre, and the
// one distance wording. The fleet map (deck.gl) and the detail's mini map
// (MapLibre) both draw from it, so they show the same groups, lines and
// figure. Pure.
import { cellToBoundary, cellToLatLng } from "h3-js";
import { metersBetween } from "../mobile/tableMeta.js";
import { fmtMeters } from "../mobileFormat.js";

function cellOf(hex) {
  if (!hex) return null;
  try {
    const [lat, lng] = cellToLatLng(hex);
    return { hex, center: { lat, lng }, polygon: cellToBoundary(hex, true) };
  } catch {
    return null;
  }
}

/**
 * @param {object|null} row  a HotspotRow (hotspotList.js): reads `row.mobile`
 *   (aggregateMobile's row: assertedCell, points, distance, wifi) and
 *   `row.hotspot.location`
 * @param {object} [mobile]  aggregateMobile result (for the heartbeat window)
 * @returns {null | {
 *   cell: { hex, center: { lat, lng }, polygon: [lng, lat][] (closed ring) } | null,
 *   groups: Array<{ lat, lng, count, at, distanceM, trust, source }>,   newest first
 *   farLines: Array<{ from: [lng, lat], to: [lng, lat], distanceM }>,
 *   nearest: number|null, farthest: number|null,                       meters
 *   text: string|null,      "Reported 40 m from its asserted cell" (the latest heartbeat's figure)
 *   window: object|null     aggregateMobile.windows.heartbeats
 * }}  null when there's no WiFi row or no cell to anchor to.
 */
export function selectedOverlay(row, mobile, { groupM = 15, farM = 25 } = {}) {
  const m = row?.mobile;
  const cell = cellOf(m?.assertedCell || row?.hotspot?.location);
  if (!row || !cell) return null;
  const groups = [];
  if (m?.wifi) {
    // The engine already groups fixes within 15 m of a group's first fix;
    // merging again keeps the grouping right for any `groupM`.
    for (const p of m.points || []) {
      const g = groups.find((x) => metersBetween(x.lat, x.lng, p.lat, p.lon) <= groupM);
      if (g) {
        g.count += p.n ?? 1;
        if ((p.lastAt ?? 0) > g.at) {
          g.at = p.lastAt;
          g.trust = p.trust ?? g.trust;
          g.source = p.source ?? g.source;
        }
        continue;
      }
      groups.push({
        lat: p.lat,
        lng: p.lon,
        count: p.n ?? 1,
        at: p.lastAt ?? 0,
        // The table's distance from asserted (between res-12 cell centres)
        // when it has one: the same figure the panel and agent tool show.
        distanceM: p.distance ?? metersBetween(cell.center.lat, cell.center.lng, p.lat, p.lon),
        trust: p.trust ?? null,
        source: p.source ?? null,
      });
    }
    groups.sort((a, b) => b.at - a.at);
  }
  const distances = groups.map((g) => g.distanceM).filter(Number.isFinite);
  const figure = Number.isFinite(m?.distance) ? m.distance : distances.length ? Math.max(...distances) : null;
  return {
    cell,
    groups,
    farLines: groups
      .filter((g) => g.distanceM > farM)
      .map((g) => ({ from: [cell.center.lng, cell.center.lat], to: [g.lng, g.lat], distanceM: g.distanceM })),
    nearest: distances.length ? Math.min(...distances) : null,
    farthest: distances.length ? Math.max(...distances) : null,
    text: figure != null ? `Reported ${fmtMeters(figure)} from its asserted cell` : null,
    window: mobile?.windows?.heartbeats ?? null,
  };
}
