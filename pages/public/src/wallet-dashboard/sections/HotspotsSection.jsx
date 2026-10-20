import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  IOT_CONNECTIVITY_NOTE,
  deviceLabelOf,
  fmtCount,
  fmtDataDay,
  fmtHnt,
  fmtUtcMonth,
  plural,
} from "../format.js";
import { SORTS, checkingText, facetCounts, sortOption, sumRows, summaryLine, verdictsPartial } from "../hotspotList.js";
import { statusFilterLabel } from "../statusRegistry.js";
import { CLEAR_FILTERS, DATA_ONLY_NOTE, HOTSPOTS_ONLY_NOTE, WIFI_SIGNALS_NOTE, couldntCheck, needsLine } from "../copy.js";
import { dashboardSearch } from "../urlState.js";
import { useResetOnChange } from "../useWalletData.js";
import { downloadTextFile } from "../../lib/download.js";
import useMediaQuery from "../../lib/useMediaQuery.js";
import { Card } from "../ui/Card.jsx";
import { Btn2 } from "../ui/Controls.jsx";
import { FleetError } from "../ui/FleetError.jsx";
import { InfoTip } from "../ui/InfoTip.jsx";
import { StatusMark } from "../ui/StatusMark.jsx";
import Toolbar, { PhoneToolbar } from "../hotspots/Toolbar.jsx";
import StatusChips, { statusOptions } from "../hotspots/StatusChips.jsx";
import HotspotTable from "../hotspots/HotspotTable.jsx";
import HotspotListPhone from "../hotspots/HotspotListPhone.jsx";
import FilterSheet from "../hotspots/FilterSheet.jsx";
import Pager from "../hotspots/Pager.jsx";
import { csvFileName, hotspotsCsv } from "../hotspots/csv.js";

const COPY_FAILED = "Couldn't copy. Your browser blocked clipboard access.";
const PAGE = { desktop: 100, phone: 50 };
// "Show all" renders the rest in steps of this many pages (100 rows in the
// table), one step per frame, so a fleet of 2,000 never blocks the page in
// one long task (IMPL_PLAN 6: under 100 ms).
const ALL_STEP = 1;
// Live arrivals flash a row's Status cell only on lists this size or smaller.
const FLASH_MAX_ROWS = 200;
const FLASH_TABLES = ["heartbeats", "invalidHeartbeats", "speedtests"];
const NO_FLASHES = new Map();
const COPIED_MS = 5000;
const PENDING = Object.freeze({ pending: true });

const num = (text, extra) => ({ text, num: true, ...extra });
const word = (text) => ({ text, num: false });
const modelText = (m) => (m.pending ? "…" : m.text);
// "60 min", "24 h", "7:42 PM": never broken across lines.
const nbsp = (s) => s.replace(/(\d) (min|h|AM|PM)\b/g, "$1 $2");

/**
 * Per-row flash keys for the Status cell: the `arrivals.seq` of the last live
 * arrival that brought heartbeat, rejected-heartbeat or speedtest rows for
 * that Hotspot. Arrivals already in place on mount (or on a wallet switch)
 * are the baseline, never news. Off above FLASH_MAX_ROWS rows.
 */
function useStatusFlashes(arrivals, wallet, enabled) {
  const seq = arrivals?.seq ?? 0;
  const ref = useRef({ wallet, seen: seq, map: NO_FLASHES });
  if (ref.current.wallet !== wallet) ref.current = { wallet, seen: seq, map: NO_FLASHES };
  if (seq < ref.current.seen) ref.current = { ...ref.current, seen: seq };
  if (seq > ref.current.seen) {
    const map = new Map(ref.current.map);
    for (const t of FLASH_TABLES) for (const k of arrivals.byTable?.[t] ?? []) map.set(k, seq);
    ref.current = { ...ref.current, seen: seq, map };
  }
  return enabled ? ref.current.map : NO_FLASHES;
}

/** The phone and one-Hotspot export menu ("⋯"): Download CSV, Copy entity keys, Copy names.
 * While exports are off the items stay focusable (`aria-disabled`, so the
 * menu's keys still work) and are described by the reason. */
function ExportMenu({ exports }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const away = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };
  const onKeyDown = (e) => {
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    let to = null;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") to = items[(i + 1) % items.length];
    else if (e.key === "ArrowUp") to = items[(i - 1 + items.length) % items.length];
    else if (e.key === "Home") to = items[0];
    else if (e.key === "End") to = items[items.length - 1];
    else if (e.key === "Tab") setOpen(false);
    if (to) {
      e.preventDefault();
      to.focus();
    }
  };
  const off = exports.disabled;
  const act = (fn) => () => {
    if (off) return;
    close();
    fn();
  };
  const whyId = off && exports.why ? "hs-menu-why" : undefined;
  const ITEM =
    "min-h-11 rounded-lg px-3 text-left text-sm font-medium text-wd-ink hover:bg-wd-well aria-disabled:cursor-not-allowed aria-disabled:text-wd-ink-3 aria-disabled:hover:bg-transparent";
  const item = (label, fn) => (
    <button type="button" role="menuitem" aria-disabled={off || undefined} aria-describedby={whyId} onClick={act(fn)} className={ITEM}>
      {label}
    </button>
  );
  return (
    <div className="relative ml-auto self-center">
      <button
        ref={btnRef}
        type="button"
        aria-label="Export Hotspots"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="h-11 w-11 rounded-[10px] text-xl font-semibold leading-5 text-wd-ink-2 hover:bg-wd-well"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Export Hotspots"
          onKeyDown={onKeyDown}
          className="absolute right-0 top-[46px] z-10 flex min-w-[210px] flex-col rounded-xl bg-surface-raised p-1.5 shadow-soft-lg"
        >
          {item("Download CSV", exports.onCsv)}
          {item("Copy entity keys", exports.onKeys)}
          {item("Copy names", exports.onNames)}
          {whyId && (
            // Read as each item's description, so not a child of the menu for assistive tech.
            <p id={whyId} aria-hidden="true" className="m-0 px-3 py-2 text-wd-cap text-wd-ink-2">
              {exports.why}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A note above the list: a caution (frozen windows) or a failure with Retry
 * (`retryLabel` names what it retries for assistive tech). */
function Note({ tone = "caution", children, onRetry, retryLabel }) {
  const caution = tone === "caution";
  return (
    <p
      className={`m-0 flex items-center gap-2 rounded-lg px-3 py-2 text-wd-sm ${
        caution ? "bg-wd-caution-surface font-medium text-wd-caution-text" : "bg-wd-well text-wd-ink"
      }`}
    >
      <StatusMark tier={caution ? "check" : "unknown"} sr={false} />
      <span>{children}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={retryLabel}
          className="relative ml-auto whitespace-nowrap rounded-md px-1.5 py-1 text-wd-sm font-semibold text-accent-text before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[''] hover:underline md:before:-inset-y-1"
        >
          Retry
        </button>
      )}
    </p>
  );
}

/**
 * Hotspots: the one list of a wallet's IoT and Mobile Hotspots (WdHotspots,
 * JUDGE 3 to 11). The head (count, "5 of 10 need a look", the windows
 * caption and its InfoTip, notes for frozen windows and failed checks), the
 * toolbar (search, network, device, sort, exports), the status chips, the
 * result and stable-order lines, then the table (768 px and up) or the phone
 * list with its filter sheet (one renderer, chosen by a media query). The
 * detail sits beside the list from 1280 px (the shell passes it in), and is
 * the whole body for a one-Hotspot wallet. Every filter, the search and the
 * sort live in the URL; the order on screen is `order` (useHotspotOrder).
 *
 * Props: wallet, list, filter, order, url, setUrl, fleetState, iotStatus,
 * mobile, activity, freshness, detailMode, detail, selectedKey,
 * onOpenDetail(param, linkEl), listRegionRef, listApiRef (filled with
 * { ensureRendered(key), focusRow(param) }); optional onRetryIot,
 * onRetryRewards, onRetryMobile (the failed-only retries) and veHntPending
 * (veHNT rewards: the Unclaimed total's caption).
 */
export default memo(function HotspotsSection({
  wallet,
  list,
  filter,
  order,
  url,
  setUrl,
  fleetState,
  iotStatus,
  mobile,
  activity,
  freshness,
  detailMode,
  detail,
  selectedKey,
  onOpenDetail,
  listRegionRef,
  listApiRef,
  onRetryIot,
  onRetryRewards,
  onRetryMobile,
  veHntPending = 0,
}) {
  const phone = !useMediaQuery("(min-width: 768px)");
  const wide = useMediaQuery("(min-width: 1280px)");
  const ctx = list.ctx;
  const counts = list.counts;
  const settled = list.settled;
  const loading = fleetState.state === "loading";
  const failed = fleetState.state === "failed";
  const total = counts.total;
  // While the fleet loads the list is empty and `unlisted` is /summary's count.
  const expected = loading ? counts.unlisted || null : total;
  // One Hotspot: from 1280 px its one-row list sits beside the detail (the
  // aside layout, always open); narrower, the detail is the whole body.
  const oneWide = detailMode === "inline" && total === 1 && wide && Boolean(detail);
  const inline = detailMode === "inline" && total === 1 && !oneWide;
  const showBody = !failed && (loading || total > 0);
  const hasI = counts.iot > 0;
  const hasM = counts.mobile > 0;
  const hasWifi = counts.wifi > 0;
  const hasDataOnly = counts.dataOnly > 0;
  const iotMode = url.net === "iot" || (!loading && !hasM);
  const narrow = Boolean(detail) && (detailMode === "aside" || oneWide);
  const pageSize = phone ? PAGE.phone : PAGE.desktop;
  const sortOpt = sortOption(url.sort);
  const sortShort = sortOpt.short(ctx);
  const narrowed = filter.narrowed;
  const M = filter.count;

  // ── Per-wallet and per-view state ──
  const [q, setQ] = useState(url.q);
  useResetOnChange(url.q, () => setQ(url.q));
  const [pages, setPages] = useState(1);
  const [growing, setGrowing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const [announce, setAnnounce] = useState("");
  const viewKey = `${url.q}|${url.net}|${url.status}|${url.device}|${url.month}|${url.sortParam}`;
  useResetOnChange(viewKey, () => {
    setPages(1);
    setGrowing(false);
  });
  useResetOnChange(wallet, () => {
    setPages(1);
    setGrowing(false);
    setSheetOpen(false);
    setCopied("");
    setAnnounce("");
  });
  // The filter sheet belongs to the phone list: it closes when the table takes over.
  useResetOnChange(phone, () => setSheetOpen(false));
  const copiedTimer = useRef(0);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const say = useCallback((text) => {
    clearTimeout(copiedTimer.current);
    setCopied(text);
    copiedTimer.current = setTimeout(() => setCopied(""), COPIED_MS);
  }, []);

  // ── Filters, facets and the controls ──
  const facets = useMemo(
    () => facetCounts(list, { q: url.q, net: url.net, device: url.device, month: url.month }),
    [list, url.q, url.net, url.device, url.month],
  );
  // While the fleet loads, "All" counts the Hotspots /summary says it has.
  const statusModel = useMemo(() => {
    const m = statusOptions({ list, facets, status: url.status, loading });
    return loading ? { ...m, all: expected } : m;
  }, [list, facets, url.status, loading, expected]);
  const onQ = useCallback(
    (v) => {
      setQ(v);
      setUrl({ q: v });
    },
    [setUrl],
  );
  const onStatus = useCallback((key) => setUrl({ status: key === "all" ? null : key }), [setUrl]);
  const onNet = useCallback((v) => setUrl({ net: v === "all" ? null : v }), [setUrl]);
  const onDevice = useCallback((v) => setUrl({ device: v === "all" ? null : v }), [setUrl]);
  const onSortValue = useCallback((v) => setUrl({ sort: v }), [setUrl]);
  // A control that clears goes away with the filters, so focus moves on: to
  // the list heading (the rule for every entry point into the list), or on a
  // phone's chip row to its Filter button; inside the filter sheet it stays.
  const clearFilters = useCallback(
    (focus) => {
      setQ("");
      setUrl({ status: null, net: null, device: null, q: null, month: null }, { immediate: true, focusList: focus === "list" });
      if (focus === "filterBtn") requestAnimationFrame(() => filterBtnRef.current?.focus());
    },
    [setUrl],
  );
  const clearAll = useCallback(() => clearFilters("list"), [clearFilters]);
  const clearAllChips = useCallback(() => clearFilters("filterBtn"), [clearFilters]);
  const clearAllInSheet = useCallback(() => clearFilters(null), [clearFilters]);

  const showNet = !loading && hasI && hasM;
  const netCtl = showNet
    ? {
        value: url.net,
        onChange: onNet,
        options: [
          { value: "all", label: "All", count: facets.net.all },
          { value: "mobile", label: "Mobile", net: "mobile", count: facets.net.mobile },
          { value: "iot", label: "IoT", net: "iot", count: facets.net.iot },
        ],
      }
    : null;
  const deviceTypes = Object.keys(counts.devices);
  const deviceCtl =
    !loading && deviceTypes.length > 1
      ? {
          value: url.device,
          onChange: onDevice,
          items: [
            { value: "all", name: "All devices", count: facets.device.all },
            ...deviceTypes
              .map((d) => ({ value: d, name: deviceLabelOf(d), count: facets.device[d] ?? 0 }))
              .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
          ],
        }
      : null;
  const sortOptions = SORTS.filter((s) => s.available(list) || s.value === sortOpt.value);
  // A sort this wallet can't use (Messages without IoT) leaves the URL.
  useEffect(() => {
    if (fleetState.state === "ready" && total > 0 && !sortOpt.available(list)) setUrl({ sort: null }, { announce: false });
  }, [fleetState.state, total, sortOpt, list, setUrl]);

  // ── Rendered rows (paging) and the list API for the detail's Previous/Next ──
  const limit = pages * pageSize;
  const rendered = useMemo(() => {
    let left = limit;
    const groups = [];
    for (const g of order.groups) {
      if (left <= 0) break;
      const rows = g.rows.slice(0, left);
      left -= rows.length;
      groups.push({ ...g, rows });
    }
    return { groups, count: groups.reduce((n, g) => n + g.rows.length, 0) };
  }, [order.groups, limit]);
  const displayed = order.keys.length;

  const latest = useRef(null);
  latest.current = { order, limit, pageSize, list };
  useImperativeHandle(
    listApiRef,
    () => {
      const ensureRendered = (key) => {
        const { order: o, limit: l, pageSize: size } = latest.current;
        const i = o.keys.indexOf(key);
        if (i >= l) setPages(Math.ceil((i + 1) / size));
      };
      return {
        ensureRendered,
        focusRow(param) {
          const row = latest.current.list.byParam.get(param);
          if (row) ensureRendered(row.key);
          requestAnimationFrame(() => document.querySelector(`[data-hotspot-link="${CSS.escape(param)}"]`)?.focus());
        },
      };
    },
    [],
  );

  // "Show more" moves focus to the first new row.
  const focusFromRef = useRef(null);
  const grow = useCallback(
    (all) => {
      focusFromRef.current = rendered.count;
      order.reapply?.();
      setPages((p) => p + (all ? ALL_STEP : 1));
      setGrowing(all);
    },
    [rendered.count, order],
  );
  useLayoutEffect(() => {
    const from = focusFromRef.current;
    if (from == null) return;
    focusFromRef.current = null;
    const key = order.keys[from];
    const row = key ? list.byKey.get(key) : null;
    if (row) document.querySelector(`[data-hotspot-link="${CSS.escape(row.param)}"]`)?.focus();
  }, [rendered, order.keys, list]);
  // "Show all" keeps adding steps until every row is in. The next step waits
  // for the frame that paints this one (a frame callback, then a task after
  // it): chained timeouts alone run several steps before the browser renders,
  // and then one frame lays out and paints all of them in one long task.
  // A hidden tab runs no frames, so the steps resume when it's shown again.
  useEffect(() => {
    if (!growing) return undefined;
    if (rendered.count >= displayed) {
      setGrowing(false);
      return undefined;
    }
    let t = 0;
    const frame = requestAnimationFrame(() => {
      t = setTimeout(() => setPages((p) => p + ALL_STEP), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(t);
    };
  }, [growing, rendered.count, displayed]);

  // ── Exports: the current filter, in the order shown ──
  const exportRows = useCallback(() => {
    const keys = order.keys.filter((k) => filter.keys.has(k));
    const seen = new Set(keys);
    for (const r of filter.rows) if (!seen.has(r.key)) keys.push(r.key);
    return keys.map((k) => list.byKey.get(k)).filter(Boolean);
  }, [order.keys, filter, list]);
  const copyLines = useCallback(
    async (kind) => {
      const rows = exportRows();
      const text = rows.map((r) => (kind === "keys" ? r.key : r.name || r.key)).join("\n");
      try {
        if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
        await navigator.clipboard.writeText(text);
        say(`Copied ${plural(rows.length, kind === "keys" ? "entity key" : "name")}`);
      } catch {
        say(COPY_FAILED);
      }
    },
    [exportRows, say],
  );
  const downloadCsv = useCallback(() => {
    const rows = exportRows();
    const name = csvFileName(wallet, list, iotStatus);
    downloadTextFile(name, hotspotsCsv({ rows, list, mobile }), "text/csv;charset=utf-8");
    say(`Downloaded ${name}, ${plural(rows.length, "Hotspot")}`);
  }, [exportRows, wallet, list, iotStatus, mobile, say]);
  const exportsOff = loading || M === 0;
  const exports = {
    disabled: exportsOff,
    why: loading ? "Export is available once the list loads." : M === 0 ? "No rows to export." : null,
    onKeys: () => copyLines("keys"),
    onNames: () => copyLines("names"),
    onCsv: downloadCsv,
  };

  // ── Head: subtitle, caption, notes ──
  const iotFailed = iotStatus?.failed ?? 0;
  const rewardsFailed = list.totals.rewardsFailed;
  const hb = mobile?.windows?.heartbeats;
  const sp = mobile?.windows?.speedtests;
  // The one Mobile note every surface shows (mobileFreshness): what couldn't
  // update and what's shown instead.
  const mobileNote = counts.mobileTables > 0 ? (freshness?.note ?? null) : null;
  const iotNote = settled.iot && iotFailed > 0 ? couldntCheck("IoT status", iotFailed) : null;
  const rewardsNote = settled.rewards && rewardsFailed > 0 ? couldntCheck("rewards", rewardsFailed) : null;
  // A source that failed or froze leaves verdicts unknown: never "No issues" then.
  const partial = verdictsPartial(list, freshness);

  let subtitle = null;
  let needTone = false;
  if (loading) subtitle = expected ? `Checking 0 of ${plural(expected, "Hotspot")}…` : "Checking Hotspots…";
  else if (total > 0 && !settled.verdicts) subtitle = checkingText(list);
  else if (total > 0) {
    const needs = counts.needs ?? 0;
    // "No issues" only when every source answered: a failed or frozen one
    // keeps the count ("0 of 10 need a look").
    subtitle = needsLine(needs, total, { partial });
    needTone = needs > 0;
  }

  const caption = [];
  caption.push("Amounts in HNT.");
  if (hasI) {
    caption.push(
      `IoT status for ${ctx.iotDayLabel ?? "the latest reported UTC day"}${ctx.trafficWindow ? `, messages for the ${ctx.trafficWindow}` : ""}.`,
    );
  }
  if (hasWifi) {
    caption.push(
      `Mobile WiFi heartbeats for the ${hb && !hb.current ? hb.short : "last 60 min"}, speedtests for the ${sp && !sp.current ? sp.short : "last 24 h"}.`,
    );
  }
  if (hasDataOnly) {
    caption.push(
      `Mobile data-only rewards for ${ctx.rewardsDay ? `${fmtDataDay(ctx.rewardsDay)} and the ${ctx.rewardsWindow}` : "the latest 7 UTC days"}. ${DATA_ONLY_NOTE}`,
    );
  }
  const statusNote = [hasI ? IOT_CONNECTIVITY_NOTE : null, hasWifi ? WIFI_SIGNALS_NOTE : null, hasDataOnly ? DATA_ONLY_NOTE : null]
    .filter(Boolean)
    .join(" ");

  // ── Result line, stable-order line, announcements ──
  const totals = useMemo(() => sumRows(filter.rows), [filter.rows]);
  const scanning = order.scanning || order.waiting;
  let result = null;
  if (loading) result = expected ? plural(expected, "Hotspot") : null;
  else if (total > 0) {
    const of = narrowed ? `${fmtCount(M)} of ${plural(total, "Hotspot")}` : plural(total, "Hotspot");
    if (!settled.rewards || scanning) result = of;
    else if (narrowed && M === 0) result = of;
    else {
      // Never a false 0: no figure when no Hotspot's unclaimed HNT is known,
      // and what's left out when some couldn't be checked or confirmed.
      const left = [
        totals.rewardsFailed ? `${fmtCount(totals.rewardsFailed)} couldn't be checked` : null,
        totals.unconfirmed ? `${fmtCount(totals.unconfirmed)} couldn't be confirmed` : null,
      ].filter(Boolean);
      const u = totals.unclaimedKnown
        ? `${fmtHnt(totals.unclaimedHnt, "list")} HNT unclaimed${left.length ? `, ${left.join(", ")}` : ""}`
        : totals.rewardsFailed
          ? "Couldn't load unclaimed HNT"
          : totals.unconfirmed
            ? "Couldn't confirm unclaimed HNT"
            : null;
      result = u ? `${of} · ${u}` : of;
    }
  }
  const phoneResult =
    loading || total === 0
      ? result
      : `${narrowed ? `${fmtCount(M)} of ${plural(total, "Hotspot")}` : plural(total, "Hotspot")}${
          order.scanning ? `, by name until ${sortShort} is checked` : `, by ${sortShort}${order.early ? " so far" : ""}`
        }`;

  // Announce what a viewer's change shows (never a data flush), and an
  // out-of-date order once.
  const lastSortRef = useRef(url.sortParam);
  useEffect(() => {
    const sortChanged = lastSortRef.current !== url.sortParam;
    lastSortRef.current = url.sortParam;
    if (url.source !== "user" || loading) return;
    const shown = narrowed ? `Showing ${fmtCount(M)} of ${plural(total, "Hotspot")}: ${filter.label}` : `Showing all ${plural(total, "Hotspot")}`;
    setAnnounce(`${shown}${sortChanged ? `, sorted by ${sortOpt.label(ctx)}` : ""}.`);
  }, [url.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const outOfDate = order.staleText === "Order is out of date.";
  useEffect(() => {
    if (outOfDate) setAnnounce("Order is out of date.");
  }, [outOfDate]);

  // ── Phone: filter sheet and applied-filter chips ──
  const filterBtnRef = useRef(null);
  const sheetWasOpen = useRef(false);
  useEffect(() => {
    if (sheetOpen) sheetWasOpen.current = true;
    else if (sheetWasOpen.current) {
      sheetWasOpen.current = false;
      filterBtnRef.current?.focus();
    }
  }, [sheetOpen]);
  // A removed chip goes away: focus moves to the Filter button beside the row.
  const thenFilterBtn = (fn) => () => {
    fn();
    requestAnimationFrame(() => filterBtnRef.current?.focus());
  };
  const active = [];
  if (url.status !== "all" && url.status !== "needs") {
    active.push({ key: "status", label: statusFilterLabel(url.status, ctx), onRemove: thenFilterBtn(() => onStatus("all")) });
  }
  if (url.net !== "all") active.push({ key: "net", label: url.net === "iot" ? "IoT" : "Mobile", onRemove: thenFilterBtn(() => onNet("all")) });
  if (url.device !== "all") active.push({ key: "device", label: deviceLabelOf(url.device), onRemove: thenFilterBtn(() => onDevice("all")) });
  const monthLabel = url.month ? `Onboarded ${fmtUtcMonth(url.month)} (UTC)` : null;
  // The desktop chip row's month chip: focus to the list heading.
  const clearMonth = () => setUrl({ month: null }, { focusList: true });
  if (monthLabel) active.push({ key: "month", label: monthLabel, onRemove: thenFilterBtn(() => setUrl({ month: null })) });
  const activeCount = (url.status !== "all" ? 1 : 0) + active.filter((a) => a.key !== "status").length;
  const needsCount = statusModel.options.find((o) => o.key === "needs")?.count ?? 0;
  const phoneNeeds =
    (settled.verdicts && needsCount > 0) || url.status === "needs"
      ? { on: url.status === "needs", count: needsCount, onToggle: () => onStatus(url.status === "needs" ? "all" : "needs") }
      : null;

  const rewardsChecked = useMemo(() => list.rows.reduce((n, r) => n + (r.unclaimed.state === "loading" ? 0 : 1), 0), [list.rows]);

  // ── Totals (tfoot and the phone strip): over every matching row ──
  const foot = useMemo(() => {
    const rows = filter.rows;
    const rewardsIn = rows.some((r) => r.unclaimed.state !== "loading");
    const unconf = totals.unconfirmed;
    const failedN = totals.rewardsFailed;
    // Never a false 0: "…" before the first answer, then a word when no
    // Hotspot's figure is known (every batch failed, or none could be confirmed).
    const money = (v, known, prefix = "") => {
      if (loading || (!settled.rewards && !rewardsIn)) return PENDING;
      if (!known) {
        if (failedN) return word("Couldn't load");
        if (unconf) return word("Couldn't confirm");
        if (rows.length && rows.every((r) => r.unclaimed.state === "unavailable")) return word("Unavailable");
      }
      return num(`${prefix}${fmtHnt(v, "list")}`);
    };
    const u = money(totals.unclaimedHnt, totals.unclaimedKnown);
    if (u.num) {
      u.sub = unconf ? `${fmtCount(unconf)} couldn't be confirmed` : null;
      u.sub2 = veHntPending > 0 ? HOTSPOTS_ONLY_NOTE : null;
    }
    const life = money(totals.lifetimeHnt, totals.rewardsChecked, totals.lifetimeLowerBound ? "≥ " : "");
    const daily = rows.filter((r) => !r.noDaily);
    const dayish = (field, okOf, sumOf) => {
      if (loading) return PENDING;
      if (!daily.length) return word("No daily HNT");
      const ok = daily.filter(okOf);
      if (ok.length) return num(fmtHnt(sumOf(), "list"));
      return daily.some((r) => r[field].state === "loading") ? PENDING : word("No data");
    };
    const day = dayish("day", (r) => r.day.state === "ok", () => totals.latestDayHnt);
    const week = dayish("week", (r) => r.week.hnt != null, () => totals.weekHnt);
    let msg;
    const iotRows = rows.filter((r) => r.nets.iot);
    if (loading) msg = PENDING;
    else if (!iotRows.length) msg = word("Not on IoT");
    else if (iotRows.some((r) => r.messages.state === "ok")) msg = num(fmtCount(totals.messages30d));
    else if (iotRows.some((r) => r.messages.state === "pending")) msg = PENDING;
    // The rows' own word: "Not published" when every one is unpublished.
    else msg = word(iotRows.every((r) => r.messages.state === "unpublished") ? "Not published" : "Unavailable");
    const label = loading
      ? expected
        ? `Total, ${plural(expected, "Hotspot")}`
        : "Total"
      : narrowed
        ? `Total, ${fmtCount(M)} shown`
        : `Total, ${plural(total, "Hotspot")}`;
    // "so far" while the scan runs; once it settled, what couldn't be checked.
    const shown = rows.length;
    const sub = loading
      ? null
      : !settled.rewards && rewardsChecked > 0
        ? `so far · ${fmtCount(rewardsChecked)} of ${fmtCount(total)} checked`
        : settled.rewards && failedN > 0 && failedN < shown
          ? `${fmtCount(shown - failedN)} of ${fmtCount(shown)} checked · ${fmtCount(failedN)} couldn't be checked`
          : null;
    return { label, sub, cells: { u, life, day, week, msg } };
  }, [filter.rows, totals, loading, settled.rewards, veHntPending, expected, narrowed, M, total, rewardsChecked]);
  const phoneTotal = {
    lead: `${foot.label}:`,
    body: iotMode
      ? `Unclaimed ${modelText(foot.cells.u)} · Messages ${modelText(foot.cells.msg)} · Lifetime ${modelText(foot.cells.life)}`
      : `Unclaimed ${modelText(foot.cells.u)} · 7 days ${modelText(foot.cells.week)} · Lifetime ${modelText(foot.cells.life)}`,
    sub: foot.sub,
    // The tfoot's Unclaimed lines ("N couldn't be confirmed", the veHNT caption).
    // Out from under their column, each names what it's about and ends as a sentence.
    notes: [foot.cells.u.sub, foot.cells.u.sub2]
      .filter((n) => n && n !== "cantClaim")
      .map((n) => (n === HOTSPOTS_ONLY_NOTE ? n : `Unclaimed: ${n}.`)),
  };

  // ── Rows ──
  const flashKeys = useStatusFlashes(activity?.arrivals, wallet, total <= FLASH_MAX_ROWS);
  const hrefBase = useMemo(
    () => dashboardSearch({ q: url.q, net: url.net, status: url.status, device: url.device, sort: url.sort, month: url.month }),
    [url.q, url.net, url.status, url.device, url.sort, url.month],
  );
  const hrefFor = useCallback((param) => `${hrefBase ? `${hrefBase}&` : "?"}hotspot=${encodeURIComponent(param)}`, [hrefBase]);
  // The one Hotspot's detail is always open beside its row: its name moves
  // focus to the detail's heading instead of opening it again.
  const focusDetail = useCallback(
    () => document.querySelector("#hotspots aside h2[tabindex]")?.focus({ preventScroll: true }),
    [],
  );
  // A row opened from the list in aside mode: once the detail renders, the
  // page moves so the aside's bar (name, Close, Previous, Next) is in view.
  const openedFromRowRef = useRef(false);
  const onOpenRow = useCallback(
    (param, el) => {
      openedFromRowRef.current = true;
      onOpenDetail(param, el);
    },
    [onOpenDetail],
  );
  const rowProps = {
    selectedKey,
    flashKeys,
    noLongerMatches: order.noLongerMatches,
    scaleMax: list.spark.scaleMax,
    wallet,
    hrefFor,
    onOpen: oneWide ? focusDetail : onOpenRow,
  };
  // The aside sticks under the app bar, but only inside the list's grid: near
  // the end of a long list its bottom edge pushes it up and its bar leaves the
  // screen. Opening a row there scrolls up just enough for the list's end to
  // sit at the viewport's bottom, where the aside (at most a viewport tall)
  // fits under the bar; the row clicked stays in view (it moves down by less
  // than the gap below it).
  const gridRef = useRef(null);
  useLayoutEffect(() => {
    if (!openedFromRowRef.current) return;
    openedFromRowRef.current = false;
    const grid = gridRef.current;
    if (!narrow || !grid || !selectedKey) return;
    const gap = window.innerHeight - 8 - grid.getBoundingClientRect().bottom;
    if (gap > 0.5) window.scrollBy({ top: -gap, left: 0, behavior: "auto" });
  }, [selectedKey, narrow]);
  const skeleton = loading ? Math.min(expected ?? 8, 10) : order.waiting ? Math.min(M, pageSize) : 0;
  const isEmpty = !loading && !order.waiting && total > 0 && displayed === 0;
  const netWord = url.net === "iot" ? "IoT " : url.net === "mobile" ? "Mobile " : "";
  const filterOn = url.status !== "all" || url.device !== "all" || Boolean(url.month);
  const emptyText = `No ${netWord}Hotspots match ${
    url.q && filterOn ? "your search and filter." : url.q ? "your search." : "this filter."
  }`;
  const busy = loading || order.waiting || order.scanning;
  const pagerProps =
    !loading && !order.waiting && !growing && rendered.count < displayed
      ? { shown: rendered.count, total: displayed, step: pageSize, onMore: () => grow(false), onAll: () => grow(true) }
      : null;
  const tableCaption = `Hotspots in this wallet, ${
    order.scanning ? `in name order while ${sortShort} is checked` : `sorted by ${sortShort}`
  }. Select a name to open its details.`;
  const summary = summaryLine(list);
  // Rows without an asset ID the list couldn't show; never while the fleet failed (nothing is listed then).
  const unlisted = !loading && !failed && counts.unlisted > 0 ? `${plural(counts.unlisted, "Hotspot")} couldn't be listed.` : null;

  const lines = (
    <>
      <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1.5">
        {result && <p className={`m-0 text-wd-sm text-wd-ink-2 ${phone ? "w-full" : ""}`}>{phone ? phoneResult : result}</p>}
        {order.stale && order.staleText && (
          <p className="m-0 inline-flex flex-wrap items-center gap-x-2 rounded-lg bg-accent-surface py-1 pl-2.5 pr-1.5 text-wd-sm text-wd-ink">
            <span>{order.staleText}</span>
            <button
              type="button"
              onClick={() => {
                // The line goes away with the new order: keep focus in the list.
                document.getElementById("hotspots-title")?.focus({ preventScroll: true });
                order.sortNow();
              }}
              className="relative whitespace-nowrap rounded-md px-1.5 py-1 font-semibold text-accent-text before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[''] hover:underline md:before:-inset-y-1"
            >
              Sort now
            </button>
          </p>
        )}
        <span role="status" className="text-wd-cap text-wd-ink-2">
          {copied}
        </span>
      </div>
      {summary && <p className="m-0 rounded-lg bg-wd-well px-3 py-2.5 text-wd-sm text-wd-ink">{summary}</p>}
    </>
  );

  let body = null;
  if (showBody && inline) {
    body = (
      <div ref={listRegionRef} className="min-w-0">
        {detail}
      </div>
    );
  } else if (showBody) {
    const list_ = phone ? (
      <>
        <PhoneToolbar
          ref={filterBtnRef}
          q={q}
          onQ={onQ}
          sort={{
            options: sortOptions.map((s) => ({ value: s.value, label: s.phoneLabel(ctx) })),
            value: sortOpt.value,
            onChange: onSortValue,
          }}
          activeCount={activeCount}
          sheetOpen={sheetOpen}
          onOpenSheet={() => setSheetOpen(true)}
          needs={phoneNeeds}
          active={active}
          onClearAll={clearAllChips}
          pending={statusModel.pending}
        />
        <div className="mt-2.5 flex flex-col gap-2.5">{lines}</div>
        <HotspotListPhone
          groups={rendered.groups}
          skeleton={skeleton}
          iot={iotMode}
          sortKey={url.sort.key}
          dayLabel={ctx.rewardsDayLabel ?? "Latest UTC day"}
          busy={busy}
          rowProps={rowProps}
          pager={pagerProps}
          total={isEmpty ? null : phoneTotal}
          empty={isEmpty ? { text: emptyText, onClear: clearAll } : null}
        />
        {sheetOpen && (
          <FilterSheet
            count={M}
            onClose={() => setSheetOpen(false)}
            onClearAll={clearAllInSheet}
            status={{
              value: url.status,
              onChange: onStatus,
              options: [
                { value: "all", label: "All", count: statusModel.all },
                ...statusModel.options.map((o) => ({ value: o.key, label: o.label, count: o.count, tier: o.tier })),
              ],
            }}
            net={netCtl}
            device={
              deviceCtl && {
                value: deviceCtl.value,
                onChange: deviceCtl.onChange,
                options: deviceCtl.items.map((d) => ({ value: d.value, label: d.name, count: d.count })),
              }
            }
          />
        )}
      </>
    ) : (
      <Card pad={false} busy={busy}>
        <div className="flex flex-col gap-3 px-6 pb-3.5 pt-[18px] max-lg:px-4">
          <Toolbar
            q={q}
            onQ={onQ}
            net={netCtl}
            device={
              deviceCtl && {
                value: deviceCtl.value,
                onChange: deviceCtl.onChange,
                options: deviceCtl.items.map((d) => ({ value: d.value, label: `${d.name} ${fmtCount(d.count)}` })),
              }
            }
            sort={{ options: sortOptions.map((s) => ({ value: s.value, label: s.label(ctx) })), value: sortOpt.value, onChange: onSortValue }}
            exports={exports}
          />
          <StatusChips model={statusModel} status={url.status} onStatus={onStatus} monthLabel={monthLabel} onClearMonth={clearMonth} />
          {lines}
        </div>
        {isEmpty ? (
          <div className="flex flex-col items-center gap-3 border-t border-wd-line px-6 pb-11 pt-10 text-center">
            <p className="m-0 text-sm text-wd-ink">{emptyText}</p>
            <Btn2 onClick={clearAll} className="text-sm">
              {CLEAR_FILTERS}
            </Btn2>
          </div>
        ) : (
          <HotspotTable
            groups={rendered.groups}
            skeleton={skeleton}
            mode={iotMode ? "iot" : "mixed"}
            narrow={narrow}
            showOnboarded={wide && !narrow}
            sort={url.sort}
            onSort={onSortValue}
            ctx={ctx}
            statusNote={statusNote}
            caption={tableCaption}
            busy={busy}
            foot={foot}
            pager={pagerProps && <Pager {...pagerProps} />}
            rowProps={rowProps}
          />
        )}
      </Card>
    );
    body = (
      <div ref={gridRef} className={narrow ? "grid grid-cols-[minmax(0,1fr)_440px] items-start gap-4" : ""}>
        <div ref={listRegionRef} className="min-w-0">
          {list_}
        </div>
        {narrow && (
          <aside
            aria-label="Hotspot details"
            className="sticky top-[calc(var(--wd-appbar-h)+8px)] -m-2 max-h-[calc(100vh-var(--wd-appbar-h)-16px)] min-w-0 scroll-pb-2 scroll-pt-16 self-start overflow-auto p-2"
          >
            {detail}
          </aside>
        )}
      </div>
    );
  }

  return (
    <section id="hotspots" aria-labelledby="hotspots-title" data-wd-section="hotspots" className="min-w-0">
      <div className="flex flex-col gap-3 md:gap-3.5">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 max-md:items-center max-md:gap-x-2.5">
            <h2
              id="hotspots-title"
              tabIndex={-1}
              data-wd-list-heading=""
              data-wd-anchor=""
              className="m-0 font-display text-wd-h2-sm font-semibold text-wd-ink md:text-wd-h2"
            >
              Hotspots
            </h2>
            {phone && showBody && expected != null && (
              <span aria-hidden="true" className="font-display text-[15px] font-semibold leading-5 text-wd-ink-2">
                {fmtCount(expected)}
              </span>
            )}
            {!phone && subtitle && (
              <span className={`text-wd-sm ${needTone ? "font-semibold text-wd-caution-text" : "text-wd-ink-2"}`}>{subtitle}</span>
            )}
            {(phone || inline) && showBody && <ExportMenu exports={exports} />}
          </div>
          {unlisted && <p className="m-0 text-wd-sm text-wd-ink-2">{unlisted}</p>}
          {showBody && (
            <p className="m-0 max-w-[1000px] text-wd-cap text-wd-ink-2">
              {nbsp(caption.join(" "))}
              {statusNote && (
                <InfoTip label="About these windows" className="ml-1.5">
                  {statusNote}
                </InfoTip>
              )}
            </p>
          )}
          {mobileNote && (
            <Note tone="error" onRetry={onRetryMobile} retryLabel="Retry Mobile data">
              {nbsp(mobileNote)}
            </Note>
          )}
          {iotNote && (
            <Note tone="error" onRetry={onRetryIot} retryLabel="Retry IoT status">
              {iotNote}
            </Note>
          )}
          {rewardsNote && (
            <Note tone="error" onRetry={onRetryRewards} retryLabel="Retry Hotspot rewards">
              {rewardsNote}
            </Note>
          )}
          {!failed && !loading && total === 0 && !unlisted && (
            <p className="m-0 text-sm text-wd-ink-2">No Hotspots in this wallet.</p>
          )}
          <p role="status" className="sr-only">
            {announce}
          </p>
        </div>
        {failed && <FleetError fleetState={fleetState} />}
        {body}
      </div>
    </section>
  );
});
