import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { orderRows, sortOption } from "../hotspotList.js";
import { fmtCount, plural } from "../format.js";

// The URL parameters a viewer changes the list with. A change to any of them
// (a chip, the search, a select, a header, "View in list" elsewhere, Back) is
// a user action: the order is applied again. Data flushes never are.
const VIEW_PARAMS = ["q", "net", "status", "device", "month", "sort"];
const NAME_SORT = Object.freeze({ key: "name", dir: "asc" });
// Fleets this size or smaller paint once, already sorted: the first paint
// waits up to WAIT_MS for the sort's data (one rewards batch), with skeleton
// rows in the final shape meanwhile.
const SMALL_FLEET = 50;
const WAIT_MS = 2000;
const NONE = new Set();
const INITIAL = { wallet: null, viewKey: null, sortValue: null, mode: "none", groups: [], firstDone: false, startedAt: 0 };

function viewKeyOf(search) {
  const sp = new URLSearchParams(search);
  return VIEW_PARAMS.map((k) => sp.get(k) ?? "").join("|");
}

/** Whether the data a sort ranks by has settled. */
function sortReady(key, settled) {
  switch (key) {
    case "name":
      return true;
    case "status":
      return Boolean(settled?.verdicts);
    case "day":
    case "week":
      return Boolean(settled?.mobile);
    case "messages":
      return Boolean(settled?.iot);
    case "onboarded":
      return Boolean(settled?.onboard);
    default:
      return Boolean(settled?.rewards);
  }
}

/** How many Hotspots have the value a sort ranks by (answered, failed or not). */
function checkedFor(key, rows) {
  let n = 0;
  for (const r of rows) {
    const done =
      key === "status"
        ? !r.checking
        : key === "day"
          ? r.day.state !== "loading"
          : key === "week"
            ? r.week.state !== "loading"
            : key === "messages"
              ? r.messages.state !== "pending"
              : key === "onboarded"
                ? r.onboarded.at !== undefined
                : r.unclaimed.state !== "loading";
    if (done) n++;
  }
  return n;
}

const snapshot = (order) => order.groups.map((g) => ({ kind: g.kind, label: g.label, keys: g.rows.map((r) => r.key) }));
const nameSnapshot = (rows) => snapshot(orderRows(rows, NAME_SORT));

/**
 * The list's applied order (IMPL_PLAN 3.5, JUDGE 6): rows never move while
 * data fills in. Fleets of 50 or fewer wait up to 2 s for the sort's data and
 * then paint sorted (`waiting` meanwhile: skeleton rows). While a sort's data
 * is still being checked the rows stay in name order with
 * "Unclaimed: 150 of 1,659 Hotspots checked. Rows sort when it finishes."
 * and Sort now; when it finishes they sort themselves, unless focus is in the
 * list or the detail (then "Order is out of date." and Sort now). A row that
 * stops matching the filter stays in place (`noLongerMatches`) and newly
 * matching rows wait, both until the next user action (a filter, search or
 * sort change, Sort now, paging). Resets per wallet.
 *
 * useHotspotOrder(list, filter, sort, { settled, listRegionRef, detailRegionRef, total, wallet })
 * → { keys (the applied order, every displayed row, past the rendered page
 *     too), groups: [{ kind, label, rows }], stale, staleText, sortNow(),
 *     noLongerMatches: Set<key>, waiting, scanning, early, reapply() }
 *   `stale` with `staleText`: show the line with a "Sort now" button.
 *   `scanning`: rows are in name order while the sort's data is checked;
 *   `early`: sorted by what's checked so far (Sort now, or a sort picked
 *   mid-scan), so the phone result line says "so far".
 *   `reapply()`: apply the order again for a user action that isn't a URL
 *   change (paging).
 */
export default function useHotspotOrder(list, filter, sort, { settled, listRegionRef, detailRegionRef, total, wallet } = {}) {
  const location = useLocation();
  const viewKey = viewKeyOf(location.search);
  const sortValue = sortOption(sort).value;
  const ready = sortReady(sort?.key, settled);
  const computed = useMemo(() => orderRows(filter.rows, sort), [filter.rows, sort]);
  const latest = useRef(null);
  latest.current = { filter, computed, ready };

  const [st, setSt] = useState(INITIAL);

  // How a user action applies the order: sorted once the data is in; a new
  // sort picked mid-scan sorts what's checked so far ("early", as Sort now);
  // otherwise name order while the scan runs.
  const applied = (s, { sortChanged = false } = {}) => {
    if (ready) return { ...s, mode: "sorted", groups: snapshot(computed), firstDone: true };
    if (s.mode === "wait") return { ...s, groups: [] };
    if (sortChanged || s.mode === "early") return { ...s, mode: "early", groups: snapshot(computed), firstDone: true };
    return { ...s, mode: "scan", groups: nameSnapshot(filter.rows), firstDone: true };
  };

  // Derived state, set during render so a user action never paints the old
  // order for a frame.
  let next = st;
  if (next.wallet !== wallet) next = { ...INITIAL, wallet, viewKey, sortValue };
  if (!total) {
    if (next.mode !== "none") next = { ...next, mode: "none", groups: [], viewKey, sortValue };
  } else if (next.mode === "none") {
    next = { ...next, viewKey, sortValue };
    if (ready) next = { ...next, mode: "sorted", groups: snapshot(computed), firstDone: true };
    else if (!next.firstDone && total <= SMALL_FLEET) next = { ...next, mode: "wait", groups: [], startedAt: Date.now() };
    else next = { ...next, mode: "scan", groups: nameSnapshot(filter.rows), firstDone: true };
  } else if (next.viewKey !== viewKey) {
    next = applied({ ...next, viewKey, sortValue }, { sortChanged: next.sortValue !== sortValue });
  } else if (next.mode === "wait" && ready) {
    next = { ...next, mode: "sorted", groups: snapshot(computed), firstDone: true };
  }
  if (next !== st) setSt(next);

  // A small fleet's first paint waits no longer than WAIT_MS.
  useEffect(() => {
    if (st.mode !== "wait") return undefined;
    const t = setTimeout(
      () =>
        setSt((s) =>
          s.mode !== "wait" || s.wallet !== wallet
            ? s
            : latest.current.ready
              ? { ...s, mode: "sorted", groups: snapshot(latest.current.computed), firstDone: true }
              : { ...s, mode: "scan", groups: nameSnapshot(latest.current.filter.rows), firstDone: true },
        ),
      Math.max(0, WAIT_MS - (Date.now() - st.startedAt)),
    );
    return () => clearTimeout(t);
  }, [st.mode, st.startedAt, wallet]);

  // The scan finished: sort, unless the viewer is working in the list or
  // the detail (then keep what they see, and say it's out of date).
  useLayoutEffect(() => {
    if (!ready || (st.mode !== "scan" && st.mode !== "early")) return;
    const a = document.activeElement;
    const inside =
      Boolean(a) &&
      a !== document.body &&
      Boolean(listRegionRef?.current?.contains(a) || detailRegionRef?.current?.contains(a));
    setSt((s) => {
      if (s.mode !== "scan" && s.mode !== "early") return s;
      if (!inside) return { ...s, mode: "sorted", groups: snapshot(latest.current.computed) };
      // Keep the rows where they are: the name order on screen becomes the snapshot.
      if (s.mode === "scan") {
        const keys = new Set(s.groups.flatMap((g) => g.keys));
        for (const r of latest.current.filter.rows) keys.add(r.key);
        return { ...s, mode: "sorted", groups: nameSnapshot([...keys].map((k) => list.byKey.get(k)).filter(Boolean)) };
      }
      return { ...s, mode: "sorted" };
    });
  }, [ready, st.mode, listRegionRef, detailRegionRef, list]);

  const sortNow = useCallback(
    () =>
      setSt((s) => {
        const { computed: c, ready: r } = latest.current;
        if (s.mode === "none") return s;
        return { ...s, mode: r ? "sorted" : "early", groups: snapshot(c), firstDone: true };
      }),
    [],
  );
  const reapply = useCallback(
    () =>
      setSt((s) => {
        const { computed: c, ready: r, filter: f } = latest.current;
        if (s.mode === "none" || s.mode === "wait") return s;
        if (r) return { ...s, mode: "sorted", groups: snapshot(c) };
        if (s.mode === "early") return { ...s, groups: snapshot(c) };
        return { ...s, mode: "scan", groups: nameSnapshot(f.rows) };
      }),
    [],
  );

  const mode = next.mode;
  const groupsState = next.groups;
  const view = useMemo(() => {
    if (mode === "none") return { groups: [], keys: [] };
    if (mode === "wait") return { groups: computed.groups, keys: computed.keys };
    if (mode === "scan") {
      // Name order over the rows shown since the order was applied plus the
      // rows matching now: a row never jumps, new matches slot in by name.
      const keys = new Set(groupsState.flatMap((g) => g.keys));
      for (const r of filter.rows) keys.add(r.key);
      const order = orderRows([...keys].map((k) => list.byKey.get(k)).filter(Boolean), NAME_SORT);
      return { groups: order.groups, keys: order.keys };
    }
    const groups = groupsState
      .map((g) => ({ kind: g.kind, label: g.label, rows: g.keys.map((k) => list.byKey.get(k)).filter(Boolean) }))
      .filter((g) => g.rows.length);
    return { groups, keys: groups.flatMap((g) => g.rows.map((r) => r.key)) };
  }, [mode, groupsState, computed, filter.rows, list]);

  const noLongerMatches = useMemo(() => {
    if (mode === "none" || mode === "wait") return NONE;
    let out = null;
    for (const k of view.keys) {
      if (!filter.keys.has(k)) (out ??= new Set()).add(k);
    }
    return out ?? NONE;
  }, [mode, view.keys, filter.keys]);

  // Out of date: the rows shown (those still matching) aren't the computed
  // order, or rows that match now aren't shown yet.
  const outOfDate = useMemo(() => {
    if (mode !== "sorted") return false;
    const shown = view.keys.filter((k) => filter.keys.has(k));
    if (shown.length !== computed.keys.length) return true;
    for (let i = 0; i < shown.length; i++) if (shown[i] !== computed.keys[i]) return true;
    return false;
  }, [mode, view.keys, filter.keys, computed.keys]);

  let staleText = null;
  if (mode === "scan" && sort?.key !== "name") {
    const short = sortOption(sort).short(list.ctx);
    staleText = `${short}: ${fmtCount(checkedFor(sort.key, list.rows))} of ${plural(total, "Hotspot")} checked. Rows sort when it finishes.`;
  } else if (outOfDate) {
    staleText = "Order is out of date.";
  }

  return useMemo(
    () => ({
      keys: view.keys,
      groups: view.groups,
      stale: staleText != null,
      staleText,
      sortNow,
      reapply,
      noLongerMatches,
      waiting: mode === "wait",
      scanning: mode === "scan" && sort?.key !== "name",
      early: mode === "early",
    }),
    [view, staleText, sortNow, reapply, noLongerMatches, mode, sort?.key],
  );
}
