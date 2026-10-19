// Shared filter predicate for the multi-gateway inspector. The chart, the
// spectrum chart, and the table all gate the same packet stream on the same
// (visibleTypes, netIdFilter, netIdSwitches, trackFilter) tuple, so the
// predicate lives in one place to keep them behaviorally identical.
export function packetMatchesFilters(pkt, { visibleTypes, netIdFilter, netIdSwitches, trackFilter }) {
  if (visibleTypes && pkt.frame_type && visibleTypes[pkt.frame_type] === false) return false;
  if (netIdFilter && netIdFilter !== "all" && pkt._netId !== netIdFilter) return false;
  if (pkt._netId && !switchedOn(netIdSwitches, pkt._netId)) return false;
  if (trackFilter && trackFilter !== "all" && pkt._trackId !== trackFilter) return false;
  return true;
}

// The chart legend's NetID switches. `{ only: false, ids }` switches `ids`
// off and leaves every other NetID on, including ones first seen later;
// `{ only: true, ids }` shows just `ids`, so later arrivals stay off. null
// when nothing is switched. Packets without a NetID (joins) aren't governed.
export function switchedOn(netIdSwitches, netId) {
  if (!netIdSwitches) return true;
  return netIdSwitches.only ? netIdSwitches.ids.has(netId) : !netIdSwitches.ids.has(netId);
}
