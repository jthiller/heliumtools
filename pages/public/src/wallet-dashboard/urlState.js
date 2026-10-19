// ── Page state in the URL ────────────────────────────────────────────────────
// The canonical path is /wallet-dashboard/:address; everything else a viewer
// can change (the open Hotspot, the list's search, filters and sort, an
// onboard month) is a query parameter, so Copy link shares the exact view
// and Back closes a detail. A different wallet is a different path: every
// in-app wallet link goes to the bare path, so filters reset with it.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { DEVICE_LABEL, UNKNOWN_DEVICE } from "./format.js";
import { isStatusFilter } from "./statusRegistry.js";
import { DEFAULT_SORT, parseSort, serializeSort } from "./hotspotList.js";
import { prefersReducedMotion } from "../lib/useReducedMotion.js";
import { useResetOnChange } from "./useWalletData.js";

const SORT_STORE = "heliumtools:wallet-dashboard:sort:v1";
const SORT_STORE_MAX = 8;
const Q_MAX = 100;
const Q_DEBOUNCE_MS = 300;
const MONTH_RE = /^\d{4}-\d{2}$/;
const PARAMS = ["hotspot", "q", "net", "status", "device", "sort", "month"];

/** The remembered sort per wallet (this browser), most recent last. */
function readSortStore() {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_STORE) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function rememberSort(wallet, value) {
  try {
    const store = readSortStore();
    delete store[wallet];
    if (value) store[wallet] = value;
    const keys = Object.keys(store);
    for (const k of keys.slice(0, Math.max(0, keys.length - SORT_STORE_MAX))) delete store[k];
    localStorage.setItem(SORT_STORE, JSON.stringify(store));
  } catch {
    // Storage blocked or full: the sort just isn't remembered.
  }
}
const rememberedSort = (wallet) => {
  const v = readSortStore()[wallet];
  return typeof v === "string" && parseSort(v) ? v : null;
};

/**
 * The URL's view parameters, validated: unknown or invalid values read as
 * their default (and are dropped on the next write).
 * @param {URLSearchParams|string} search
 * @param {{ devices?: object, bothNetworks?: boolean }} [fleet]  the loaded
 *   list's facts: `device` must be a type in the fleet (or "unknown"), and
 *   `net` reads "all" unless both networks are present
 * @returns {{ hotspot: string|null, q: string, net: "all"|"iot"|"mobile", status: string,
 *   device: string, sort: { key, dir }, sortParam: string|null, month: string|null }}
 */
export function parseUrlParams(search, fleet = {}) {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const net = sp.get("net");
  const status = sp.get("status");
  const device = sp.get("device");
  const month = sp.get("month");
  const sortParam = sp.get("sort");
  const sort = parseSort(sortParam);
  const deviceOk =
    device && (device === UNKNOWN_DEVICE || Object.hasOwn(fleet.devices ?? DEVICE_LABEL, device));
  return {
    hotspot: sp.get("hotspot") || null,
    q: (sp.get("q") || "").slice(0, Q_MAX),
    net: (net === "iot" || net === "mobile") && fleet.bothNetworks !== false ? net : "all",
    status: status && isStatusFilter(status) ? status : "all",
    device: deviceOk ? device : "all",
    sort: sort ?? DEFAULT_SORT,
    sortParam: sort ? serializeSort(sort) : null,
    month: month && MONTH_RE.test(month) ? month : null,
  };
}

/**
 * `sp` with every view parameter re-validated (parseUrlParams): an invalid or
 * default value is dropped, the rest in a stable order (equal views share one
 * URL), other parameters kept after them.
 */
function canonicalParams(sp, fleet) {
  const v = parseUrlParams(sp, fleet);
  const out = new URLSearchParams();
  if (v.hotspot) out.set("hotspot", v.hotspot);
  if (v.q) out.set("q", v.q);
  if (v.net !== "all") out.set("net", v.net);
  if (v.status !== "all") out.set("status", v.status);
  if (v.device !== "all") out.set("device", v.device);
  if (v.sortParam && v.sortParam !== serializeSort(DEFAULT_SORT)) out.set("sort", v.sortParam);
  if (v.month) out.set("month", v.month);
  for (const [k, value] of sp) if (!PARAMS.includes(k)) out.append(k, value);
  return out;
}

/**
 * The query string for a view (defaults left out), e.g. for an agent tool or
 * a link: dashboardSearch({ status: "noHeartbeat", sort: { key: "status", dir: "desc" } })
 * → "?status=noHeartbeat&sort=status". Returns "" for the default view.
 */
export function dashboardSearch(params = {}) {
  const sp = new URLSearchParams();
  if (params.hotspot) sp.set("hotspot", params.hotspot);
  if (params.q) sp.set("q", String(params.q).slice(0, Q_MAX));
  if (params.net && params.net !== "all") sp.set("net", params.net);
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.device && params.device !== "all") sp.set("device", params.device);
  const sort = typeof params.sort === "string" ? parseSort(params.sort) : params.sort;
  if (sort && !(sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir)) sp.set("sort", serializeSort(sort));
  if (params.month) sp.set("month", params.month);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function focusListHeading() {
  const section = document.getElementById("hotspots");
  if (!section) return;
  section.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  const heading = section.querySelector("[data-wd-list-heading]") || section.querySelector("h2");
  heading?.focus({ preventScroll: true });
}

/**
 * The page's view state, read from and written to the URL.
 *
 * const [url, setUrl, nav] = useDashboardUrlState(wallet, list, { fleetLoaded })
 *
 * url: parseUrlParams's object (validated against the loaded list), plus
 *   `seq`, which moves on every change, and `source`: "user" for a change
 *   made through setUrl / nav with `announce` (the list's result line
 *   announces only those), else "url" (load, Back / Forward, a drop).
 *
 * setUrl(patch, { push = false, focusList = false, announce = true, immediate = false })
 *   Writes `patch` (any of hotspot, q, net, status, device, sort ({key,dir} or
 *   its URL form), month; null or the default removes it). Replace by
 *   default, keeping the history state, so a filter change while a detail is
 *   open keeps its `wdDetail` and Close still goes back. A `q` patch is
 *   debounced 300 ms unless `immediate`. A sort is remembered for the wallet.
 *   `focusList` scrolls #hotspots into view (smooth unless reduced motion)
 *   and focuses the list's heading ([data-wd-list-heading] or its h2).
 *
 * nav.openDetail(param, opener, { preferOpener, modal })  no detail open: push
 *   `hotspot` with history state { wdDetail: true } and remember `opener` (the
 *   element focus returns to); one open (another row, a Health name, the map
 *   panel): replace it. `preferOpener`: the detail opened over the page from
 *   outside the list (a drawer or full-screen dialog), so closing returns to
 *   the opener, where the viewer was, rather than the list row. `modal`: the
 *   detail covers the page (drawer or full screen), so the opener's place in
 *   the viewport is remembered too: whatever grew above it while the page was
 *   covered (the map's selection panel on a phone), closing puts it back there.
 * nav.closeDetail({ returnFocus = true })  history back when the detail
 *   pushed, else replace without `hotspot`. Leaving a pushed detail by going
 *   back (Close, Escape or the browser's Back) keeps a filter, search or sort
 *   changed while it was open: the entry below is read with that view from
 *   its first frame and then replaced with it. On close focus returns to the
 *   row link of the Hotspot last shown ([data-hotspot-link="<param>"]), else
 *   the opener, else the list heading (the opener first with `preferOpener`);
 *   after a `modal` open, that element (the opener, or the opened Hotspot's
 *   row link) sits where the opener was. `returnFocus: false` skips it (Show
 *   on map focuses the map instead).
 * nav.stepDetail(param)  replace `hotspot` (Back still closes). Callers first
 *   run listApiRef.current.ensureRendered(key) so the row exists for focus.
 * nav.detailPushed  the open detail was pushed (Back closes it).
 *
 * Behavior: with no `sort` in the URL, the wallet's remembered sort is written
 * in by replace (so Copy link and a reload carry it); the default stays out.
 * Once the fleet loads, a `hotspot` not in it is dropped by replace; a deep
 * link to a valid one gets the list entry below it (the same view without
 * `hotspot`), so Back closes the detail and a second Back leaves. Every
 * write also drops view parameters that don't validate (an unknown status,
 * a device the fleet doesn't have, `net` without both networks).
 */
export function useDashboardUrlState(wallet, list, { fleetLoaded = false } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const navType = useNavigationType();
  const locRef = useRef(location);
  locRef.current = location;
  const openerRef = useRef(null);
  const preferOpenerRef = useRef(false);
  // A modal detail's opener: { el, param, top } (its viewport offset at open).
  const anchorRef = useRef(null);
  const lastShownRef = useRef(null);
  const shownRef = useRef(null);
  // Whether the next detail close returns focus (not after "Show on map",
  // which focuses the map, nor when an invalid `hotspot` is dropped).
  const focusReturnRef = useRef(true);
  const pendingRef = useRef({ patch: null, timer: null, opts: null });
  const changeRef = useRef({ seq: 0, source: "url", search: location.search });
  // The location last committed, and the view kept on the entry below a
  // detail left by going back: { key: that entry's key, search }.
  const committedRef = useRef(location);
  const keepRef = useRef(null);
  // The deep-link list entry below a detail is being inserted (its replace and push).
  const insertingRef = useRef(false);
  const deepLinkForRef = useRef(null);
  // A Close is already going back (until the detail is gone).
  const closingRef = useRef(false);

  // The fleet facts the URL validates against, keyed on their values so the
  // returned `url` keeps its identity across list flushes.
  const devices = fleetLoaded && list ? Object.keys(list.counts.devices).sort().join(",") : null;
  const bothNetworks = fleetLoaded && list ? list.counts.iot > 0 && list.counts.mobile > 0 : null;
  const fleet = useMemo(
    () =>
      devices == null ? {} : { devices: Object.fromEntries(devices.split(",").filter(Boolean).map((d) => [d, true])), bothNetworks },
    [devices, bothNetworks],
  );
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;

  useResetOnChange(wallet, () => {
    openerRef.current = null;
    preferOpenerRef.current = false;
    anchorRef.current = null;
    lastShownRef.current = null;
    shownRef.current = null;
    focusReturnRef.current = true;
    keepRef.current = null;
    clearTimeout(pendingRef.current.timer);
    pendingRef.current = { patch: null, timer: null, opts: null };
  });
  useEffect(() => () => clearTimeout(pendingRef.current.timer), []);

  // Going back from a pushed detail (Close, Escape, the browser's Back) lands
  // on the entry below with the view changed while the detail was open: read
  // that view from the first frame (no flash of the old one, and the row link
  // focus returns to is the one that stays), then replace the entry with it.
  let keep = keepRef.current?.key === location.key ? keepRef.current.search : null;
  if (keep == null) {
    const prev = committedRef.current;
    if (
      prev &&
      prev.key !== location.key &&
      navType === "POP" &&
      prev.pathname === location.pathname &&
      prev.state?.wdDetail &&
      new URLSearchParams(prev.search).get("hotspot") &&
      !new URLSearchParams(location.search).get("hotspot")
    ) {
      const sp = new URLSearchParams(prev.search);
      sp.delete("hotspot");
      const qs = canonicalParams(sp, fleetRef.current).toString();
      const kept = qs ? `?${qs}` : "";
      if (kept !== location.search) keep = kept;
    }
  }
  const search = keep ?? location.search;

  if (changeRef.current.search !== search) {
    const intent = changeRef.current.intent;
    changeRef.current = {
      seq: changeRef.current.seq + 1,
      source: intent?.search === search && intent.announce ? "user" : "url",
      search,
    };
  }
  const { seq, source } = changeRef.current;

  const url = useMemo(() => ({ ...parseUrlParams(search, fleet), seq, source }), [search, fleet, seq, source]);

  const write = useCallback(
    (patch, { push = false, announce = true, focusList = false, state } = {}) => {
      const loc = locRef.current;
      const sp = new URLSearchParams(loc.search);
      for (const [k, v] of Object.entries(patch)) {
        if (!PARAMS.includes(k)) continue;
        let value = v;
        if (k === "sort" && value && typeof value === "object") value = serializeSort(value);
        if (k === "sort" && value === serializeSort(DEFAULT_SORT)) value = null;
        if ((k === "net" || k === "status" || k === "device") && value === "all") value = null;
        if (k === "q" && value) value = String(value).slice(0, Q_MAX);
        if (value == null || value === "") sp.delete(k);
        else sp.set(k, value);
      }
      const qs = canonicalParams(sp, fleetRef.current).toString();
      const search = qs ? `?${qs}` : "";
      if ("sort" in patch && wallet) {
        const value = patch.sort && typeof patch.sort === "object" ? serializeSort(patch.sort) : patch.sort;
        rememberSort(wallet, value && value !== serializeSort(DEFAULT_SORT) ? value : null);
      }
      if (search !== loc.search) {
        changeRef.current.intent = { search, announce };
        navigate({ pathname: loc.pathname, search, hash: "" }, { replace: !push, state: state ?? loc.state });
      }
      if (focusList) requestAnimationFrame(focusListHeading);
    },
    [navigate, wallet],
  );

  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    clearTimeout(p.timer);
    if (p.patch) write(p.patch, p.opts);
    pendingRef.current = { patch: null, timer: null, opts: null };
  }, [write]);

  const setUrl = useCallback(
    (patch, opts = {}) => {
      if ("q" in patch && !opts.immediate) {
        const p = pendingRef.current;
        clearTimeout(p.timer);
        const { q, ...rest } = patch;
        if (Object.keys(rest).length) write(rest, opts);
        pendingRef.current = {
          patch: { q },
          opts,
          timer: setTimeout(flushPending, Q_DEBOUNCE_MS),
        };
        return;
      }
      if (pendingRef.current.patch) flushPending();
      write(patch, opts);
    },
    [write, flushPending],
  );

  // The wallet's remembered sort, written in when the URL has none.
  const appliedSortFor = useRef(null);
  useEffect(() => {
    if (!wallet || appliedSortFor.current === wallet) return;
    appliedSortFor.current = wallet;
    if (new URLSearchParams(locRef.current.search).get("sort")) return;
    const remembered = rememberedSort(wallet);
    if (remembered) write({ sort: remembered }, { announce: false });
  }, [wallet, write]);

  // A `hotspot` this fleet doesn't have is dropped once the fleet is in.
  useEffect(() => {
    if (!fleetLoaded || !url.hotspot || !list) return;
    if (!list.byParam.has(url.hotspot)) {
      focusReturnRef.current = false;
      write({ hotspot: null }, { announce: false });
    }
  }, [fleetLoaded, list, url.hotspot, write]);

  // The entry below a detail left by going back gets the view kept from it.
  useEffect(() => {
    committedRef.current = location;
    if (!new URLSearchParams(location.search).get("hotspot")) closingRef.current = false;
    if (keep == null) {
      if (keepRef.current && keepRef.current.key !== location.key) keepRef.current = null;
      return;
    }
    keepRef.current = { key: location.key, search: keep };
    changeRef.current.intent = { search: keep, announce: false };
    navigate({ pathname: location.pathname, search: keep, hash: "" }, { replace: true, state: location.state });
  }, [location, keep, navigate]);

  // A deep link to a Hotspot (no detail pushed in this tab) gets the list
  // entry below it once the fleet is in, so Back closes the detail and a
  // second Back leaves the page (IMPL_PLAN 10.4).
  useEffect(() => {
    if (!fleetLoaded || !list || !wallet || deepLinkForRef.current === wallet) return;
    deepLinkForRef.current = wallet;
    const loc = locRef.current;
    const hotspot = new URLSearchParams(loc.search).get("hotspot");
    if (!hotspot || loc.state?.wdDetail || !list.byParam.has(hotspot) || list.counts.total <= 1) return;
    const sp = new URLSearchParams(loc.search);
    sp.delete("hotspot");
    const qs = canonicalParams(sp, fleetRef.current).toString();
    insertingRef.current = true;
    changeRef.current.intent = { search: loc.search, announce: false };
    navigate({ pathname: loc.pathname, search: qs ? `?${qs}` : "", hash: loc.hash }, { replace: true, state: loc.state });
    navigate({ pathname: loc.pathname, search: loc.search, hash: loc.hash }, { state: { ...(loc.state || {}), wdDetail: true } });
  }, [fleetLoaded, list, wallet, navigate]);
  useEffect(() => {
    if (insertingRef.current && location.state?.wdDetail) insertingRef.current = false;
  }, [location]);

  // Focus return when a detail closes, however it closed (Close, Escape, Back).
  useEffect(() => {
    const was = shownRef.current;
    shownRef.current = url.hotspot;
    if (url.hotspot) {
      lastShownRef.current = url.hotspot;
      return;
    }
    // The deep link's list entry passing by is not a close.
    if (!was || insertingRef.current) return;
    const returnFocus = focusReturnRef.current;
    focusReturnRef.current = true;
    const preferOpener = preferOpenerRef.current;
    preferOpenerRef.current = false;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!returnFocus) return;
    const param = lastShownRef.current;
    const opener = openerRef.current;
    openerRef.current = null;
    requestAnimationFrame(() => {
      const link = param ? document.querySelector(`[data-hotspot-link="${CSS.escape(param)}"]`) : null;
      const openerOk = opener?.isConnected && opener !== document.body ? opener : null;
      // A detail opened over the page from outside the list returns to where
      // the viewer was; otherwise the row link (or the opener, or the heading).
      const target = preferOpener ? openerOk || link : link || openerOk;
      if (!target) {
        focusListHeading();
        return;
      }
      // The page couldn't scroll under a modal detail, but it could change
      // above the opener: put the opener (or its Hotspot's row link, the same
      // row re-rendered) back at its offset, then focus it without a scroll.
      if (anchor && (target === anchor.el || (anchor.param && target.getAttribute?.("data-hotspot-link") === anchor.param))) {
        const dy = target.getBoundingClientRect().top - anchor.top;
        if (Math.abs(dy) >= 1) window.scrollTo({ top: window.scrollY + dy, left: window.scrollX, behavior: "instant" });
        target.focus({ preventScroll: true });
      } else target.focus();
    });
  }, [url.hotspot]);

  const nav = useMemo(() => {
    const detailPushed = Boolean(location.state?.wdDetail);
    return {
      detailPushed,
      openDetail(param, opener, { preferOpener = false, modal = false } = {}) {
        if (!param) return;
        if (!url.hotspot) {
          openerRef.current = opener ?? document.activeElement ?? null;
          preferOpenerRef.current = preferOpener;
          const el = openerRef.current;
          // Only an opener on the page itself (not inside another dialog).
          anchorRef.current =
            modal && el?.isConnected && el !== document.body && !el.closest?.("dialog") && el.getClientRects().length
              ? { el, param: el.getAttribute("data-hotspot-link") === param ? param : null, top: el.getBoundingClientRect().top }
              : null;
          write({ hotspot: param }, { push: true, announce: false, state: { ...(locRef.current.state || {}), wdDetail: true } });
        } else if (param !== url.hotspot) {
          write({ hotspot: param }, { announce: false });
        }
      },
      closeDetail({ returnFocus = true } = {}) {
        // Nothing open, or this close is already going back (a second Close
        // before the pop lands must not go back twice).
        if (!url.hotspot || closingRef.current) return;
        focusReturnRef.current = returnFocus;
        // A search still in its debounce goes with the close.
        const pending = pendingRef.current.patch;
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = { patch: null, timer: null, opts: null };
        const loc = locRef.current;
        if (loc.state?.wdDetail) {
          // The pending search lands on the detail entry first; going back
          // then keeps it (see `keep` above).
          if (pending) write(pending, { announce: false });
          closingRef.current = true;
          navigate(-1);
        } else write({ ...pending, hotspot: null }, { announce: false });
      },
      stepDetail(param) {
        if (param && param !== url.hotspot) write({ hotspot: param }, { announce: false });
      },
    };
  }, [location.state, url.hotspot, write, navigate]);

  return [url, setUrl, nav];
}
