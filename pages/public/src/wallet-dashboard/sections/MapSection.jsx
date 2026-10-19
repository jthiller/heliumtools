import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { XMarkIcon } from "@heroicons/react/20/solid";
import useMediaQuery from "../../lib/useMediaQuery.js";
import useDarkMode from "../../lib/useDarkMode.js";
import { prefersReducedMotion } from "../../lib/useReducedMotion.js";
import { encodeKeys } from "../../lib/urlCompression.js";
import { fmtCount } from "../format.js";
import { CLEAR_FILTERS, FLEET_UNAVAILABLE } from "../copy.js";
import { checkingText } from "../hotspotList.js";
import { useHotspotCoverage } from "../useIotLookups.js";
import { useResetOnChange } from "../useWalletData.js";
import { dashboardSearch, parseUrlParams } from "../urlState.js";
import { selectedOverlay } from "../map/selectedOverlay.js";
import { deriveFootprint, legendRows, rampCss, windowsLine } from "../map/mapEncoding.js";
import { Card, FleetError, IconBtn, PortalTarget, Section, Seg, Skeleton, StatusMark } from "../ui/index.js";
import FleetMap from "../FleetMap.jsx";
import { MapLegend } from "../map/MapLegend.jsx";
import { MapPanel } from "../map/MapPanel.jsx";
import { PhoneMap } from "../map/PhoneMap.jsx";

const FULL_MAP = "/hotspot-map";
// "Open full map" carries the fleet's keys while the whole URL stays this short.
const FULL_MAP_MAX_URL = 8192;
const NO_SELECTION = { key: null, coverage: false, fly: 0 };
// The floating legend's width plus its margins: a fleet fit keeps markers clear of it.
const FLOAT_LEGEND_INSET = { left: 290 };
const NO_INSET = { left: 0 };
const COLOR_BY = [
  { value: "network", label: "Network" },
  { value: "health", label: "Health" },
];
const NO_LOCATION = { status: "noLocation", sort: { key: "status", dir: "desc" } };
const NO_LOCATION_HREF = dashboardSearch(NO_LOCATION);
const LINK = "inline-flex min-h-6 items-center text-[13px] font-medium text-accent-text hover:underline max-md:min-h-11";

/**
 * The map's caption names the fleet by place ("10 Hotspots at 2 sites", "26
 * Hotspots in 19 cities in Piemonte, Italia", "1 Hotspot in Smilde, Drenthe,
 * Nederland"): the identity caption without its network split or device,
 * which the legend and the panel carry here.
 */
function mapCaption(places, list) {
  if ((places.counts?.total ?? 0) === 1) {
    const place = list?.rows?.[0]?.place?.full;
    return place ? `1 Hotspot in ${place}` : "1 Hotspot";
  }
  const full = places.caption();
  const cut = full.lastIndexOf(" · ");
  return cut > 0 ? full.slice(0, cut) : full;
}

/** The toolbar over the map: Color by, then the close-up, filter or scan
 * line, and the Mobile note when its data couldn't update. */
function Toolbar({ colorBy, onColorBy, zoomTxt, filterTxt, onClearFilter, scanTxt, noteTxt }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-wd-line-2 px-4 py-2.5 md:min-h-[60px] md:py-3">
      <div className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="text-wd-cap text-wd-ink-2">
          Color by
        </span>
        <Seg label="Color by" options={COLOR_BY} value={colorBy} onChange={onColorBy} />
      </div>
      {(zoomTxt || filterTxt || scanTxt || noteTxt) && (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {zoomTxt && <span className="text-wd-sm text-wd-ink-2">{zoomTxt}</span>}
          {filterTxt && (
            <>
              <span className="text-wd-sm text-wd-ink">{filterTxt}</span>
              <button
                type="button"
                onClick={onClearFilter}
                className="h-7 rounded-full border border-wd-control bg-surface-raised px-2.5 text-xs font-medium text-wd-ink hover:bg-wd-well max-md:h-11 max-md:px-3.5"
              >
                {CLEAR_FILTERS}
              </button>
            </>
          )}
          {scanTxt && (
            <span className="text-wd-sm text-wd-ink-2">
              <StatusMark tier="checking" sr={false} className="mr-1.5 align-[-1px]" />
              {scanTxt}
            </span>
          )}
          {noteTxt && (
            <span className="text-wd-sm text-wd-ink-2">
              <StatusMark tier="unknown" sr={false} className="mr-1.5 align-[-1px]" />
              {noteTxt}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * Map (WdMap): the fleet by site, colored by network or by health, with the
 * selected Hotspot's summary, the legend and, at fleet zoom, the loupe. The
 * list filter drives it too (non-matching dots dim, the camera fits the
 * matches). Desktop and tablet: the interactive map in its card (legend
 * floating from 1280 px, under the map below that). Phones: a static
 * preview with "Open map" (a full-screen dialog with the interactive map),
 * the Legend disclosure and a "By place" list. States: loading, failed
 * (the shared fleet error with Retry), no asserted locations, empty.
 *
 * Selection is the map's own (reset per wallet): a dot click selects it, a
 * URL `hotspot` change selects it and flies to its site, and "Show on map"
 * (`mapSelect`, a new `seq` each time) re-selects and re-flies; on phones it
 * also opens the map dialog and focuses the panel heading there.
 *
 * Props: wallet, list, places, iotStatus, mobile, activity, freshness,
 * heartbeatsLive, fleetState ({ state, error, retry }), filter (filterRows
 * result), onClearFilter(), detailKey (the URL's `hotspot`), mapSelect
 * ({ key, seq } | null), onOpenDetail(param, el), onPlace(city), and
 * optionally onShowStatus(key) (the unasserted links; without it they set
 * the URL themselves).
 */
export default memo(function MapSection({
  wallet,
  list,
  places,
  iotStatus,
  mobile,
  activity,
  freshness,
  heartbeatsLive,
  fleetState,
  filter,
  onClearFilter,
  detailKey,
  mapSelect,
  onOpenDetail,
  onPlace,
  onShowStatus,
}) {
  const desk = useMediaQuery("(min-width: 768px)");
  const wide = useMediaQuery("(min-width: 1280px)");
  const dark = useDarkMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [colorBy, setColorBy] = useState("network");
  const [sel, setSel] = useState(NO_SELECTION);
  const [closeUp, setCloseUp] = useState(false);
  const [drawn, setDrawn] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fullHref, setFullHref] = useState(FULL_MAP);
  const regionRef = useRef(null);
  const panelRef = useRef(null);
  const openRef = useRef(null);
  const panelHeadingId = useId();
  const dialogTitleId = useId();

  // Per wallet: Color by back to Network, selection, coverage and close-up
  // cleared, the dialog closed (the camera refits when the new fleet's map mounts).
  useResetOnChange(wallet, () => {
    setColorBy("network");
    setSel((s) => ({ ...NO_SELECTION, fly: s.fly }));
    setCloseUp(false);
    setDrawn(null);
    setDialogOpen(false);
  });

  // `focus`: the selection came from a button that goes away with it (a loupe
  // dot), so focus moves to the panel heading once the panel renders.
  const focusPanelRef = useRef(false);
  const select = useCallback((key, { fly = false, again = false, focus = false } = {}) => {
    if (key != null && focus) focusPanelRef.current = true;
    setSel((s) => {
      if (key == null) return s.key == null ? s : { ...NO_SELECTION, fly: s.fly };
      if (s.key === key && !again) return s;
      return { key, coverage: s.key === key ? s.coverage : false, fly: fly ? s.fly + 1 : s.fly };
    });
  }, []);
  const onSelect = useCallback((key, opts) => select(key, opts), [select]);
  useEffect(() => {
    if (!focusPanelRef.current || !sel.key) return;
    focusPanelRef.current = false;
    panelRef.current?.querySelector("h3")?.focus({ preventScroll: true });
  }, [sel.key]);
  const toggleCoverage = useCallback(() => setSel((s) => ({ ...s, coverage: !s.coverage })), []);

  // A URL `hotspot` (a detail opened anywhere) selects it on the map.
  const detailRowKey = detailKey ? (list?.byParam?.get(detailKey)?.key ?? null) : null;
  useEffect(() => {
    if (detailRowKey) select(detailRowKey, { fly: true, again: true });
  }, [detailRowKey, select]);

  // "Show on map" from the detail: select and fly; phones open the map dialog
  // with it. Focus lands on the panel heading once the detail's modal dialog
  // (drawer or full screen) has closed: closing a modal dialog hands focus
  // back to whatever had it before the dialog opened.
  const mapSelectSeq = mapSelect?.seq ?? 0;
  const dialogElRef = useRef(null);
  useEffect(() => {
    if (!mapSelect?.key) return undefined;
    select(mapSelect.key, { fly: true, again: true });
    if (!desk) setDialogOpen(true);
    let tries = 0;
    let raf = 0;
    const focus = () => {
      const own = dialogElRef.current;
      const otherModal = [...document.querySelectorAll("dialog[open]")].some((d) => d !== own);
      const h = panelRef.current?.querySelector("h3");
      if (h && !otherModal && (desk || own?.open)) {
        if (document.activeElement !== h) h.focus({ preventScroll: true });
      } else if (++tries < 120) raf = requestAnimationFrame(focus);
    };
    raf = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(raf);
  }, [mapSelectSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  // A phone dialog has no place on a wider screen.
  useEffect(() => {
    if (desk) setDialogOpen(false);
  }, [desk]);

  // "Open full map" with this fleet's keys when the link stays short enough
  // (computed once the fleet is in, so the link is a plain anchor).
  useEffect(() => {
    let cancelled = false;
    setFullHref(FULL_MAP);
    const keys = (places?.points || []).map((p) => p.key);
    if (!keys.length || keys.reduce((n, k) => n + k.length + 1, 0) > 64_000) return undefined;
    encodeKeys(keys)
      .then((enc) => {
        const href = `${FULL_MAP}?keys=${enc}`;
        if (!cancelled && `${window.location.origin}${href}`.length <= FULL_MAP_MAX_URL) setFullHref(href);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [places]);

  // ── The selection ──
  const selRow = sel.key ? (list?.byKey?.get(sel.key) ?? null) : null;
  const overlay = useMemo(() => (selRow ? selectedOverlay(selRow, mobile) : null), [selRow, mobile]);
  const coverageEligible = selRow?.iot?.status === "active" && Boolean(selRow.iot.hex);
  const coverageShown = coverageEligible && sel.coverage;
  const cov = useHotspotCoverage(coverageShown ? sel.key : null);
  const footprint = useMemo(() => deriveFootprint(cov.cells, selRow?.iot?.hex), [cov.cells, selRow?.iot?.hex]);
  const ramp = rampCss(dark);
  const coverage = useMemo(
    () =>
      coverageEligible
        ? { shown: coverageShown, onToggle: toggleCoverage, state: cov.state, retry: cov.retry, footprint, rampCss: ramp }
        : null,
    [coverageEligible, coverageShown, toggleCoverage, cov.state, cov.retry, footprint, ramp],
  );
  const mobileTables = useMemo(() => ({ loaded: mobile?.loaded, failed: mobile?.failed }), [mobile?.loaded, mobile?.failed]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);
  const openDialog = useCallback(() => {
    setDialogOpen(true);
  }, []);
  // Escape in the panel: focus the map it belongs to (on a phone with the
  // dialog closed, "Open map" under the preview).
  const previewRef = useRef(false);
  previewRef.current = !desk && !dialogOpen;
  const onClosePanel = useCallback(
    ({ focusMap } = {}) => {
      select(null);
      if (!focusMap) return;
      const target = previewRef.current ? openRef : regionRef;
      requestAnimationFrame(() => target.current?.focus({ preventScroll: true }));
    },
    [select],
  );
  // "Clear filters" goes away with the filter: focus moves to the map it
  // filtered (on a phone with the dialog closed, "Open map").
  const clearFilter = useCallback(() => {
    onClearFilter?.();
    const target = previewRef.current ? openRef : regionRef;
    requestAnimationFrame(() => target.current?.focus({ preventScroll: true }));
  }, [onClearFilter]);
  const openDetail = useCallback(
    (param, el) => {
      // The detail and the phone map dialog are never open together.
      setDialogOpen(false);
      onOpenDetail(param, el);
    },
    [onOpenDetail],
  );
  const locRef = useRef(location);
  locRef.current = location;
  const showNoLocation = useCallback(() => {
    setDialogOpen(false);
    if (onShowStatus) {
      onShowStatus("noLocation");
      return;
    }
    const loc = locRef.current;
    navigate({ pathname: loc.pathname, search: NO_LOCATION_HREF }, { replace: true, state: loc.state });
    requestAnimationFrame(() => {
      const s = document.getElementById("hotspots");
      s?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      (s?.querySelector("[data-wd-list-heading]") || s?.querySelector("h2"))?.focus({ preventScroll: true });
    });
  }, [onShowStatus, navigate]);
  const onUnassertedClick = useCallback(
    (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      showNoLocation();
    },
    [showNoLocation],
  );

  const placement = desk ? "float" : "below";
  const panel = useMemo(
    () =>
      selRow ? (
        <MapPanel
            rootRef={panelRef}
            row={selRow}
            ctx={list.ctx}
            wallet={wallet}
            overlay={overlay}
            hbWindow={mobile?.windows?.heartbeats}
            mobileTables={mobileTables}
            coverage={coverage}
            onClose={onClosePanel}
            onOpenDetail={openDetail}
            placement={placement}
            headingId={panelHeadingId}
          />
      ) : null,
    [selRow, list?.ctx, wallet, overlay, mobile?.windows?.heartbeats, mobileTables, coverage, onClosePanel, openDetail, placement, panelHeadingId],
  );

  // ── Lines ──
  const total = list?.counts?.total ?? 0;
  const site = selRow ? places?.siteByKey?.get(selRow.key) : null;
  // The phone preview always shows a selection's site up close; the
  // interactive map until the user pans or zooms away.
  const atSite = desk || dialogOpen ? closeUp : Boolean(site);
  const zoomTxt =
    atSite && site ? (total === 1 ? site.label : `${site.label}: ${fmtCount(site.count)} of ${fmtCount(total)} Hotspots`) : null;
  const filterTxt = filter?.narrowed
    ? `Showing ${fmtCount(filter.count)} of ${fmtCount(total)} ${total === 1 ? "Hotspot" : "Hotspots"}: ${filter.label}`
    : null;
  // Which filter is applied, from the URL: the camera fits its matches once
  // per change. Its label can't say: a sliding window freezing renames it
  // ("No heartbeat (60 min)" to "… (60 min to 3:42 PM)") without a change.
  const urlFilter = parseUrlParams(location.search);
  const filterId = filter?.narrowed
    ? [urlFilter.q.trim().toLowerCase(), urlFilter.net, urlFilter.device, urlFilter.status, urlFilter.month ?? ""].join("|")
    : "";
  // The Hotspot list's subtitle, word for word, while the verdicts settle.
  const settled = list?.settled;
  const scanTxt = useMemo(
    () => (list?.rows && !settled?.verdicts && total > 0 ? checkingText(list) : null),
    [list, settled?.verdicts, total],
  );
  // The one Mobile note (mobileFreshness), as the list, Health and the detail show it.
  const noteTxt = (list?.counts?.mobileTables ?? 0) > 0 ? (freshness?.note ?? null) : null;
  const windows = useMemo(() => windowsLine(list, iotStatus), [list, iotStatus]);
  const legend = useMemo(
    () =>
      legendRows(drawn, {
        selected: Boolean(drawn?.selected),
        overlay: overlay?.cell ? { cell: selRow?.nets?.iot ? "iot" : "mobile", positions: overlay.groups.length > 0, window: overlay.window } : null,
        footprint: Boolean(coverageShown && footprint?.drawn?.length),
        dark,
        ctx: list?.ctx,
      }),
    [drawn, overlay, selRow, coverageShown, footprint, dark, list?.ctx],
  );
  const phoneWindows = useMemo(() => ({ line: windows, hb: mobile?.windows?.heartbeats }), [windows, mobile?.windows?.heartbeats]);

  // ── The phone map dialog ──
  const [dialogEl, setDialogEl] = useState(null);
  const dialogRef = useCallback((el) => {
    dialogElRef.current = el;
    setDialogEl(el);
  }, []);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!dialogEl) return;
    if (dialogOpen && !dialogEl.open) dialogEl.showModal();
    if (!dialogOpen && dialogEl.open) dialogEl.close();
    // Focus goes back to "Open map" however the dialog closed (Close, Escape).
    if (wasOpenRef.current && !dialogOpen) openRef.current?.focus({ preventScroll: true });
    wasOpenRef.current = dialogOpen;
  }, [dialogOpen, dialogEl]);

  // ── States ──
  const failed = fleetState?.state === "failed";
  const loading = !failed && (fleetState?.state !== "ready" || !places || !list);
  const empty = !failed && !loading && total === 0;
  const noLocation = !failed && !loading && !empty && places.points.length === 0;
  const caption = !failed && !loading && places ? mapCaption(places, list) : null;
  const fullLink = empty ? null : (
    <a href={fullHref} className={`${LINK} px-0.5`}>
      Open full map
    </a>
  );

  let body;
  if (failed) {
    body = <FleetError fleetState={fleetState} line={FLEET_UNAVAILABLE.map} />;
  } else if (loading) {
    body = (
      <Card pad={false} busy className="overflow-hidden">
        <div className="flex items-center border-b border-wd-line-2 px-4 py-3 md:min-h-[60px]">
          <Skeleton w={220} h={30} />
        </div>
        <div className="relative h-[260px] p-4 md:h-[520px]">
          <Skeleton w="100%" h="100%" className="rounded-[10px]" />
          <p role="status" className="absolute inset-x-0 top-1/2 m-0 -translate-y-1/2 text-center text-wd-sm text-wd-ink-2">
            Loading Hotspots…
          </p>
        </div>
      </Card>
    );
  } else if (empty) {
    body = <p className="m-0 py-1 text-wd-sm text-wd-ink-2">No Hotspots in this wallet.</p>;
  } else if (noLocation) {
    body = (
      <Card className="flex min-h-[240px] flex-col items-center justify-center gap-1.5 text-center">
        <p className="m-0 text-wd-sm text-wd-ink">None of this wallet&apos;s Hotspots have an asserted location.</p>
        <a href={NO_LOCATION_HREF} onClick={onUnassertedClick} className={LINK}>
          Show them in the Hotspot list
        </a>
      </Card>
    );
  } else {
    const toolbar = (
      <Toolbar
        colorBy={colorBy}
        onColorBy={setColorBy}
        zoomTxt={zoomTxt}
        filterTxt={filterTxt}
        onClearFilter={clearFilter}
        scanTxt={scanTxt}
        noteTxt={noteTxt}
      />
    );
    const mapProps = {
      wallet,
      list,
      places,
      filter,
      filterId,
      mode: colorBy,
      selKey: sel.key,
      flySeq: sel.fly,
      onSelect,
      overlay,
      footprint,
      coverageShown,
      arrivals: activity?.arrivals,
      heartbeatsLive,
      hbWindow: mobile?.windows?.heartbeats,
      panelRef,
      onDrawn: setDrawn,
      onCloseUp: setCloseUp,
      onUnasserted: showNoLocation,
      unassertedHref: NO_LOCATION_HREF,
    };
    body = desk ? (
      <Card pad={false} wdCard="map" className="overflow-hidden">
        {toolbar}
        <div
          ref={regionRef}
          role="region"
          aria-label={`Map of ${caption}`}
          tabIndex={-1}
          className="relative h-[520px] wd-ring-inset"
        >
          <FleetMap
            {...mapProps}
            panelPlacement="float"
            fitInsets={wide ? FLOAT_LEGEND_INSET : NO_INSET}
            loupeAllowed={!(detailKey && !wide && total > 1)}
          />
          {wide && <MapLegend rows={legend} windows={windows} variant="float" />}
          {panel}
        </div>
        {!wide && <MapLegend rows={legend} windows={windows} variant="row" />}
      </Card>
    ) : (
      <Card pad={false} wdCard="map" className="overflow-hidden">
        {toolbar}
        <PhoneMap
          list={list}
          places={places}
          filter={filter}
          mode={colorBy}
          selKey={sel.key}
          overlay={overlay}
          panel={dialogOpen ? null : panel}
          ctx={list.ctx}
          windows={phoneWindows}
          dark={dark}
          suspended={dialogOpen}
          openRef={openRef}
          onOpenMap={openDialog}
          onPlace={onPlace}
          onOpenDetail={openDetail}
        />
        <dialog
          ref={dialogRef}
          className="wd-full"
          aria-labelledby={dialogTitleId}
          onCancel={closeDialog}
          onClose={closeDialog}
        >
          <PortalTarget node={dialogEl}>
            <div className="flex h-full flex-col">
              <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-wd-line-2 pl-4 pr-2">
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <h2 id={dialogTitleId} className="m-0 font-display text-wd-h2-sm font-semibold text-wd-ink">
                    Map
                  </h2>
                  <span className="truncate text-wd-cap text-wd-ink-2">{caption}</span>
                </div>
                <IconBtn aria-label="Close map" onClick={closeDialog}>
                  <XMarkIcon aria-hidden="true" className="h-5 w-5" />
                </IconBtn>
              </div>
              {toolbar}
              <div ref={regionRef} role="region" aria-label={`Map of ${caption}`} tabIndex={-1} className="relative min-h-0 flex-1 wd-ring-inset">
                {dialogOpen && <FleetMap {...mapProps} panelPlacement="below" loupeAllowed={false} />}
              </div>
              {panel && dialogOpen ? (
                <div className="max-h-[45%] shrink-0 overflow-auto">{panel}</div>
              ) : (
                <MapLegend rows={legend} windows={windows} variant="details" className="shrink-0" />
              )}
            </div>
          </PortalTarget>
        </dialog>
      </Card>
    );
  }

  return (
    <Section id="map" title="Map" caption={caption} right={fullLink} busy={loading} data-wd-section="map">
      {body}
    </Section>
  );
});
