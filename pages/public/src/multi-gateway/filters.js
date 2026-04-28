// Shared filter predicate for the multi-gateway inspector. The chart, the
// spectrum chart, and the table all gate the same packet stream on the same
// (visibleTypes, netIdFilter, trackFilter) tuple, so the predicate lives in
// one place to keep them behaviorally identical.
export function packetMatchesFilters(pkt, { visibleTypes, netIdFilter, trackFilter }) {
  if (visibleTypes && pkt.frame_type && visibleTypes[pkt.frame_type] === false) return false;
  if (netIdFilter && netIdFilter !== "all" && pkt._netId !== netIdFilter) return false;
  if (trackFilter && trackFilter !== "all" && pkt._trackId !== trackFilter) return false;
  return true;
}
