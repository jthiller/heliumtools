import { useMemo } from "react";
import { orderRows } from "../hotspotList.js";

const NONE = new Set();
const noop = () => {};

/**
 * The applied order of the filtered list. STUB (U0a): sorts immediately on
 * every change; U2 replaces it with the stable order (rows never move while
 * data fills in, "Order is out of date. Sort now", "No longer matches").
 *
 * useHotspotOrder(list, filter, sort, { settled, listRegionRef,
 *   detailRegionRef, total, wallet })
 * → { keys: string[] (the applied order, every filtered row, past the
 *     rendered page too), groups: [{ kind, label, rows }], stale: boolean,
 *     staleText: string|null, sortNow(), noLongerMatches: Set<key> }
 */
export default function useHotspotOrder(list, filter, sort) {
  return useMemo(() => {
    const { groups, keys } = orderRows(filter.rows, sort);
    return { keys, groups, stale: false, staleText: null, sortNow: noop, noLongerMatches: NONE };
  }, [filter.rows, sort]);
}
