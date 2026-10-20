import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useSearchParams, useNavigate, useLocation } from "react-router-dom";
import "./wallet-dashboard.css";
import useFleetRewards from "./useFleetRewards.js";
import useFleetIotStatus from "./useFleetIotStatus.js";
import useFleetOnboarded from "./useFleetOnboarded.js";
import { useUtilizationIndex } from "./useIotLookups.js";
import useMobileActivity from "./mobile/useMobileActivity.js";
import { useWalletSummary, useWalletFleet, useGovernance, useWalletTransactions, useResetOnChange } from "./useWalletData.js";
import { aggregateRewards, aggregateIotStatus, onboardingStats, shortAddress } from "./format.js";
import { aggregateMobile } from "./mobileFormat.js";
import { aggregateHotspotList, filterRows, detailModeOf, sortOption } from "./hotspotList.js";
import { deriveFleetPlaces } from "./fleetPlaces.js";
import { mobileFreshness } from "./mobileFreshness.js";
import { deriveMoney } from "./money.js";
import { useDashboardUrlState } from "./urlState.js";
import { rememberWallet } from "./recentWallets.js";
import useHotspotOrder from "./hotspots/useHotspotOrder.js";
import { useRetryFocus } from "./ui/index.js";
import AppBar from "./AppBar.jsx";
import LookupPage from "./LookupPage.jsx";
import SummarySection from "./sections/SummarySection.jsx";
import EarningsSection from "./sections/EarningsSection.jsx";
import HotspotsSection from "./sections/HotspotsSection.jsx";
import HealthSection from "./sections/HealthSection.jsx";
import MapSection from "./sections/MapSection.jsx";
import WalletSection from "./sections/WalletSection.jsx";
import AboutSection from "./sections/AboutSection.jsx";
import HotspotDetail from "./detail/HotspotDetail.jsx";
import DetailDialog from "./detail/DetailDialog.jsx";
import { useWebMcpTools } from "../webmcp/useWebMcpTools.js";
import { makeWalletDashboardTools } from "./webmcpTools.js";
import useMediaQuery from "../lib/useMediaQuery.js";
import { prefersReducedMotion } from "../lib/useReducedMotion.js";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
// Stable stand-in for a fleet that failed to load (a fresh [] per render
// would restart every scan and re-render every memoized section).
const EMPTY_FLEET = [];
const isValidWallet = (a) => typeof a === "string" && a.length >= 32 && a.length <= 44 && BASE58_RE.test(a);
const STATUS_SORT = { key: "status", dir: "desc" };

// The section wrapper's entrance (`.wd-zone`, first mount only; the root is
// never re-keyed by wallet, so a wallet switch doesn't replay it).
function Zone({ i, children }) {
  return (
    <div className="wd-zone min-w-0" style={{ "--wd-zone-i": i }}>
      {children}
    </div>
  );
}

/**
 * The Wallet Dashboard shell: the wallet lives in the route
 * (/wallet-dashboard/:address; ?wallet= redirects there, keeping the other
 * parameters), the view in the query (urlState.js). It runs every data hook,
 * derives each aggregate once per flush (rewards, IoT, Mobile, then the
 * unified list, places, freshness and money) and hands the sections stable
 * props: Summary, Earnings, Hotspots (with the detail), Health, Map, Wallet,
 * About. Health, Map and About show only for a wallet with Hotspots (or
 * while the fleet loads and isn't known to be empty).
 */
export default function WalletDashboard() {
  const { address } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  // URL is the source of truth: prefer the path param, accept ?wallet= as an alias.
  const queryWallet = searchParams.get("wallet");
  const wallet = address || queryWallet || null;
  const valid = isValidWallet(wallet);
  const activeWallet = valid ? wallet : null;

  const goToWallet = useCallback((addr) => navigate(`/wallet-dashboard/${addr.trim()}`), [navigate]);
  // A pressed Retry that goes away while its retry runs leaves focus nearby.
  useRetryFocus();

  // Redirect the ?wallet= alias to the canonical path form, keeping the view.
  useEffect(() => {
    if (address || !queryWallet || !isValidWallet(queryWallet)) return;
    const sp = new URLSearchParams(location.search);
    sp.delete("wallet");
    const qs = sp.toString();
    navigate({ pathname: `/wallet-dashboard/${queryWallet}`, search: qs ? `?${qs}` : "", hash: location.hash }, { replace: true });
  }, [address, queryWallet, navigate, location.search, location.hash]);

  // ── The wallet's own data (each scoped to this wallet) ──
  const summaryState = useWalletSummary(activeWallet);
  const fleetQuery = useWalletFleet(activeWallet);
  const govState = useGovernance(activeWallet);
  const txState = useWalletTransactions(activeWallet);
  const summary = summaryState.data;

  // Remember the wallet for the lookup screen's Recent wallets once its own
  // summary loads: a well-formed string that isn't a real address never gets
  // one, so it can't push a real wallet off the list.
  useEffect(() => {
    if (valid && summary?.wallet === wallet) rememberWallet(wallet, { hotspots: summary.fleet?.count });
  }, [wallet, valid, summary]);

  // The fleet once it's this wallet's. A fleet that failed to load settles
  // as empty (scans finish) and every fleet section shows the shared error.
  const fleetFailed = fleetQuery.error && !fleetQuery.data ? fleetQuery.error : null;
  const walletHotspots = fleetFailed
    ? EMPTY_FLEET
    : fleetQuery.data?.wallet === wallet
      ? fleetQuery.data.hotspots
      : undefined;
  const fleetLoaded = walletHotspots !== undefined && !fleetFailed;
  const fleetState = useMemo(
    () => ({
      state: fleetFailed ? "failed" : fleetLoaded ? "ready" : "loading",
      error: fleetFailed,
      retry: fleetQuery.retry,
    }),
    [fleetFailed, fleetLoaded, fleetQuery.retry],
  );

  // ── Scans over the fleet ──
  const rewardsState = useFleetRewards(activeWallet, walletHotspots);
  const rewardsAgg = useMemo(() => aggregateRewards(rewardsState.rewardsByKey), [rewardsState.rewardsByKey]);
  // IoT connectivity (active/inactive) + 30-day traffic from
  // api-iot.heliumtools.org, fetched directly from the browser. One GET per
  // IoT Hotspot (the only per-row fan-out).
  const iotStatusState = useFleetIotStatus(walletHotspots);
  // On-chain onboard dates (the Entity API's are a re-index artifact).
  const onboardedState = useFleetOnboarded(walletHotspots);
  const { onboardedByKey } = onboardedState;
  // Stats appear once every date is in (a half-built histogram would reshuffle).
  const onboardingStatsValue = useMemo(
    () => (onboardedState.done ? onboardingStats(onboardedByKey, walletHotspots) : null),
    [onboardedState.done, onboardedByKey, walletHotspots],
  );
  const onboarding = useMemo(
    () => ({
      stats: onboardingStatsValue,
      done: onboardedState.done,
      progress: onboardedState.progress,
      byKey: onboardedByKey,
      failed: onboardedState.failed,
      retrying: onboardedState.retrying,
      retry: onboardedState.retry,
    }),
    [
      onboardingStatsValue,
      onboardedState.done,
      onboardedState.progress,
      onboardedByKey,
      onboardedState.failed,
      onboardedState.retrying,
      onboardedState.retry,
    ],
  );
  // The one per-flush derivation of every row's IoT verdicts.
  const iotStatusAgg = useMemo(
    () => aggregateIotStatus(walletHotspots, iotStatusState.statusByKey, iotStatusState.dataThrough, onboardedByKey),
    [walletHotspots, iotStatusState.statusByKey, iotStatusState.dataThrough, onboardedByKey],
  );
  // Final once no IoT row is pending: a not-active verdict also waits on its
  // onboard date (setting up vs inactive), but Mobile rows' dates don't hold it.
  const iotStatusDone = iotStatusState.done && iotStatusAgg.counted === iotStatusAgg.iotTotal;
  // A Retry of failed lookups doesn't send the list and the money figures
  // back to checking: what loaded stays settled while the retried rows read
  // "Checking…". (Health keeps `iotStatusDone` and shows the retry's progress.)
  const iotSettled = iotStatusDone || (iotStatusState.retrying && iotStatusAgg.counted > 0);
  const hasIotFleet = iotStatusAgg.iotTotal > 0;
  // Network utilization index (one request per page): completeness of the
  // 30-day window, for the "lower bound" note.
  const { index: utilizationIndex } = useUtilizationIndex(hasIotFleet, iotStatusAgg.trafficRange?.max);

  // Mobile Hotspots' network activity, read in a Web Worker straight from
  // Helium's public Mobile network tables and kept live while the page is
  // visible. Nothing runs for a fleet without Mobile Hotspots.
  const mobileRefreshRef = useRef(null);
  const mobileActivity = useMobileActivity(activeWallet, walletHotspots, { refreshRef: mobileRefreshRef });
  // The one derivation of every Mobile row's verdicts; re-runs only on the
  // hook's own updates (a post, its `asOf` clock, the page shown or hidden).
  // Unchanged Hotspots keep their row objects across assembles (`prev`).
  const prevMobileRef = useRef(null);
  const mobileAgg = useMemo(
    () => aggregateMobile(walletHotspots, mobileActivity, mobileActivity.asOf, prevMobileRef.current),
    [walletHotspots, mobileActivity],
  );
  prevMobileRef.current = mobileAgg;
  // The map decides its one camera ease per selection on live heartbeats,
  // not on the saved paint.
  const heartbeatsLive = Boolean(mobileActivity.heartbeats) && !mobileActivity.cachedSections.includes("heartbeats");
  const mobileSettled =
    walletHotspots !== undefined &&
    (mobileAgg.mobileTotal === 0 || mobileActivity.checked || mobileActivity.phase === "error");

  // ── Derivations over the aggregates (once per flush) ──
  const prevListRef = useRef(null);
  const [mapSelect, setMapSelect] = useState(null);
  const openerSeqRef = useRef(0);
  useResetOnChange(activeWallet, () => {
    prevListRef.current = null;
    openerSeqRef.current = 0;
    setMapSelect(null);
  });
  // A different wallet starts at its Summary (not at the last one's scroll
  // depth: the sticky app bar's field is reachable from anywhere).
  const shownWalletRef = useRef(activeWallet);
  useEffect(() => {
    if (shownWalletRef.current === activeWallet) return;
    const had = shownWalletRef.current;
    shownWalletRef.current = activeWallet;
    if (had && activeWallet) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeWallet]);
  const hotspotList = useMemo(
    () =>
      aggregateHotspotList({
        hotspots: walletHotspots,
        iotStatus: iotStatusAgg,
        iotDone: iotSettled,
        mobile: mobileAgg,
        mobileSettled,
        rewardsByKey: rewardsState.rewardsByKey,
        rewardsDone: rewardsState.done,
        rewardsRetrying: rewardsState.retrying,
        onboardedByKey,
        onboardedDone: onboardedState.done,
        fleetCount: summary?.fleet?.count ?? null,
        prev: prevListRef.current,
      }),
    [
      walletHotspots,
      iotStatusAgg,
      iotSettled,
      mobileAgg,
      mobileSettled,
      rewardsState.rewardsByKey,
      rewardsState.done,
      rewardsState.retrying,
      onboardedByKey,
      onboardedState.done,
      summary?.fleet?.count,
    ],
  );
  prevListRef.current = hotspotList;
  const places = useMemo(() => deriveFleetPlaces(walletHotspots), [walletHotspots]);
  const freshness = useMemo(() => mobileFreshness(mobileActivity, mobileAgg), [mobileActivity, mobileAgg]);
  const money = useMemo(
    () =>
      deriveMoney({
        summary: summaryState,
        rewards: rewardsAgg,
        rewardsState,
        list: hotspotList,
        governance: govState.data,
        govLoading: govState.loading,
        govError: govState.error,
        mobile: mobileAgg,
        iotStatus: iotStatusAgg,
        iotDone: iotSettled,
        freshness,
        fleetLoaded,
        fleetFailed: Boolean(fleetFailed),
      }),
    [summaryState, rewardsAgg, rewardsState, hotspotList, govState, mobileAgg, iotStatusAgg, iotSettled, freshness, fleetLoaded, fleetFailed],
  );

  // ── The view (URL) ──
  const [url, setUrl, nav] = useDashboardUrlState(activeWallet, hotspotList, { fleetLoaded });
  const filter = useMemo(
    () => filterRows(hotspotList, { q: url.q, net: url.net, device: url.device, status: url.status, month: url.month }),
    [hotspotList, url.q, url.net, url.device, url.status, url.month],
  );
  const listRegionRef = useRef(null);
  const detailRegionRef = useRef(null);
  const detailHeadingRef = useRef(null);
  const listApiRef = useRef({ ensureRendered() {}, focusRow() {} });
  const order = useHotspotOrder(hotspotList, filter, url.sort, {
    settled: hotspotList.settled,
    listRegionRef,
    detailRegionRef,
    total: hotspotList.counts.total,
    wallet: activeWallet,
  });

  // ── The detail ──
  const wide = useMediaQuery("(min-width: 1280px)");
  const medium = useMediaQuery("(min-width: 768px)");
  const detailMode = detailModeOf(hotspotList.counts.total, { wide, medium });
  const selectedRow =
    detailMode === "inline"
      ? (hotspotList.rows[0] ?? null)
      : url.hotspot
        ? (hotspotList.byParam.get(url.hotspot) ?? null)
        : null;
  const detailNav = useMemo(() => {
    const keys = order.keys;
    const index = selectedRow ? keys.indexOf(selectedRow.key) : -1;
    const at = (i) => {
      const r = i >= 0 && i < keys.length ? hotspotList.byKey.get(keys[i]) : null;
      return r ? { key: r.key, param: r.param, name: r.name } : null;
    };
    return {
      index,
      total: index >= 0 ? keys.length : 0,
      sortLabel: sortOption(url.sort).short(hotspotList.ctx),
      prev: index >= 0 ? at(index - 1) : null,
      next: index >= 0 ? at(index + 1) : null,
    };
  }, [order.keys, selectedRow, hotspotList, url.sort]);

  // Focus moves to the detail heading when the viewer opens or steps one, or
  // an agent's open-wallet-dashboard opens one (as the viewer would from
  // outside the list: in the aside, the list comes into view first). Not on
  // a deep link's first paint, nor on Back or Forward.
  const focusDetailRef = useRef(false);
  // The `hotspot` an agent's open asked for (one the page drops never matches).
  const agentOpenRef = useRef(null);
  useEffect(() => {
    const agent = agentOpenRef.current != null && agentOpenRef.current === url.hotspot;
    if (!selectedRow || !(focusDetailRef.current || agent)) return;
    focusDetailRef.current = false;
    agentOpenRef.current = null;
    if (agent && detailMode === "aside") {
      document.getElementById("hotspots")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    }
    requestAnimationFrame(() => detailHeadingRef.current?.focus({ preventScroll: true }));
  }, [selectedRow?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // A drawer or full-screen detail covers the page: closing puts the opener
  // back where it was in the viewport.
  const modalDetail = detailMode === "drawer" || detailMode === "fullscreen";
  const onOpenDetail = useCallback(
    (param, el) => {
      focusDetailRef.current = true;
      nav.openDetail(param, el, { modal: modalDetail });
    },
    [nav, modalDetail],
  );
  // From outside the list (Summary, Health, About, the map panel): bring the
  // list into view first when the detail opens beside it. A drawer or
  // full-screen detail opens over the page where the viewer is, so closing
  // returns there (the opener), not to the list row far above.
  const onOpenHotspot = useCallback(
    (param, el) => {
      if (detailMode === "aside") {
        document.getElementById("hotspots")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      }
      focusDetailRef.current = true;
      nav.openDetail(param, el, { preferOpener: modalDetail, modal: modalDetail });
    },
    [detailMode, modalDetail, nav],
  );
  const onCloseDetail = useCallback(() => nav.closeDetail(), [nav]);
  const onNavigate = useCallback(
    (target) => {
      if (!target) return;
      listApiRef.current?.ensureRendered?.(target.key);
      focusDetailRef.current = true;
      nav.stepDetail(target.param);
    },
    [nav],
  );
  // "Show on map": close the detail (through history), then select the
  // Hotspot on the map. Desktop and tablet scroll to the map; on phone
  // MapSection opens its map dialog with it. MapSection (on `mapSelect`)
  // focuses the panel heading once the detail's modal dialog has closed.
  const onShowOnMap = useCallback(
    (key) => {
      nav.closeDetail({ returnFocus: false });
      openerSeqRef.current += 1;
      setMapSelect({ key, seq: openerSeqRef.current });
      if (!medium) return;
      requestAnimationFrame(() => {
        document.getElementById("map")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      });
    },
    [nav, medium],
  );

  // ── Cross-section handlers ──
  const onShowStatus = useCallback(
    (key) => setUrl({ status: key, sort: STATUS_SORT, q: null, net: null, device: null, month: null }, { focusList: true, immediate: true }),
    [setUrl],
  );
  const onFilter = useCallback((patch) => setUrl(patch, { focusList: true, immediate: true }), [setUrl]);
  const onPlace = useCallback((city) => setUrl({ q: city }, { focusList: true, immediate: true }), [setUrl]);
  const onClearFilter = useCallback(
    () => setUrl({ status: null, net: null, device: null, q: null, month: null }, { immediate: true }),
    [setUrl],
  );
  const onRetryRewards = rewardsState.retryFailed;
  const onRetryIot = iotStatusState.retryFailed;
  const onRetryMobile = useCallback(() => mobileRefreshRef.current?.(), []);
  const detailRetry = useMemo(
    () => ({ iot: onRetryIot, mobile: onRetryMobile, rewards: onRetryRewards }),
    [onRetryIot, onRetryMobile, onRetryRewards],
  );

  // ── Agent tools (WebMCP): refs keep them reading the wallet on screen ──
  const walletRef = useRef(null);
  walletRef.current = activeWallet;
  const iotStateRef = useRef(null);
  const mobileStateRef = useRef(null);
  const listStateRef = useRef(null);
  useWebMcpTools(
    () =>
      makeWalletDashboardTools(
        // A Hotspot the agent opens takes focus like one the viewer opens.
        (to, opts) => {
          const hotspot = typeof to === "string" ? new URLSearchParams(to.split("?")[1] ?? "").get("hotspot") : null;
          if (hotspot) agentOpenRef.current = hotspot;
          navigate(to, opts);
        },
        () => walletRef.current,
        () => iotStateRef.current,
        () => mobileStateRef.current,
        () => listStateRef.current,
      ),
    [],
  );
  // Only once the fleet on screen belongs to this wallet: right after a
  // wallet switch, the previous wallet's state lingers for a render.
  iotStateRef.current =
    valid && fleetLoaded ? { wallet, hotspots: walletHotspots, iotStatus: iotStatusAgg, done: iotStatusDone } : null;
  // A failed fleet is published too, so the agent tool needn't wait for
  // Mobile state that never comes.
  mobileStateRef.current = !valid
    ? null
    : fleetFailed
      ? { wallet, fleetError: fleetFailed }
      : fleetLoaded && mobileActivity.wallet === wallet
        ? { wallet, hotspots: walletHotspots, activity: mobileActivity, mobile: mobileAgg }
        : null;
  listStateRef.current =
    valid && fleetLoaded
      ? { wallet, list: hotspotList, settled: hotspotList.settled, onboardFailed: onboardedState.failed, onboardRetrying: onboardedState.retrying }
      : null;

  // The detail element, memoized so HotspotsSection (which renders it beside
  // the list) skips flushes that don't touch the open Hotspot.
  const prices = summary?.prices;
  const walletWeekHnt = money.earned.weekHnt;
  const veHntPending = money.unclaimed.veHnt;
  const detail = useMemo(
    () =>
      selectedRow ? (
        <HotspotDetail
          row={selectedRow}
          list={hotspotList}
          mobile={mobileAgg}
          freshness={freshness}
          prices={prices}
          walletWeekHnt={walletWeekHnt}
          veHntPending={veHntPending}
          wallet={wallet}
          nav={detailNav}
          mode={detailMode}
          headingRef={detailHeadingRef}
          regionRef={detailRegionRef}
          onClose={onCloseDetail}
          onNavigate={onNavigate}
          onShowOnMap={onShowOnMap}
          onRetry={detailRetry}
        />
      ) : null,
    [
      selectedRow,
      hotspotList,
      mobileAgg,
      freshness,
      prices,
      walletWeekHnt,
      veHntPending,
      wallet,
      detailNav,
      detailMode,
      onCloseDetail,
      onNavigate,
      onShowOnMap,
      detailRetry,
    ],
  );

  // "{BMJiAP…Cc84Hd} · Wallet Dashboard · Helium Tools" while a wallet is shown.
  useEffect(() => {
    if (!valid) return undefined;
    const previous = document.title;
    document.title = `${shortAddress(wallet)} · Wallet Dashboard · Helium Tools`;
    return () => {
      document.title = previous;
    };
  }, [wallet, valid]);

  if (!valid) {
    return (
      <div className="wd-root">
        <AppBar wallet={null} onSubmit={goToWallet} />
        <LookupPage value={wallet} invalid={Boolean(wallet)} onSubmit={goToWallet} />
      </div>
    );
  }

  // Fleet sections only for a wallet with Hotspots: while the fleet loads,
  // unless /summary already says it has none; after a failure, unless it does.
  const fleetCount = summary?.fleet?.count;
  const hasFleet = fleetFailed || walletHotspots === undefined ? fleetCount !== 0 : walletHotspots.length > 0;

  const inList = detailMode === "aside" || detailMode === "inline";

  return (
    <div className="wd-root" data-wd-settled={hotspotList.settled.all ? "true" : "false"}>
      <AppBar wallet={wallet} onSubmit={goToWallet} />
      <main
        id="wd-main"
        tabIndex={-1}
        className="mx-auto flex max-w-[1440px] scroll-mt-[var(--wd-appbar-h)] flex-col gap-8 px-4 pb-14 pt-4 outline-none md:gap-11 md:px-10 md:pb-[72px] md:pt-7"
      >
        <Zone i={0}>
          <SummarySection
            wallet={wallet}
            summary={summaryState}
            fleetState={fleetState}
            money={money}
            places={places}
            list={hotspotList}
            freshness={freshness}
            onboarding={onboarding}
            iotStatus={iotStatusAgg}
            iotDone={iotStatusDone}
            utilizationIndex={utilizationIndex}
            activity={mobileActivity}
            governance={govState}
            transactions={txState}
            onRetryRewards={onRetryRewards}
            onRetryIot={onRetryIot}
            onRetryMobile={onRetryMobile}
            onShowStatus={onShowStatus}
            onOpenHotspot={onOpenHotspot}
          />
        </Zone>
        <Zone i={1}>
          <EarningsSection
            wallet={wallet}
            money={money}
            list={hotspotList}
            mobile={mobileAgg}
            activity={mobileActivity}
            freshness={freshness}
            prices={summary?.prices}
            governance={govState}
            fleetState={fleetState}
            onRetryRewards={onRetryRewards}
            onRetryMobile={onRetryMobile}
          />
        </Zone>
        <Zone i={2}>
          <HotspotsSection
            wallet={wallet}
            list={hotspotList}
            filter={filter}
            order={order}
            url={url}
            setUrl={setUrl}
            fleetState={fleetState}
            iotStatus={iotStatusAgg}
            mobile={mobileAgg}
            activity={mobileActivity}
            freshness={freshness}
            detailMode={detailMode}
            detail={inList ? detail : null}
            selectedKey={selectedRow?.key ?? null}
            onOpenDetail={onOpenDetail}
            listRegionRef={listRegionRef}
            listApiRef={listApiRef}
            onRetryIot={onRetryIot}
            onRetryRewards={onRetryRewards}
            onRetryMobile={onRetryMobile}
            veHntPending={veHntPending}
          />
        </Zone>
        {hasFleet && (
          <Zone i={3}>
            <HealthSection
              wallet={wallet}
              list={hotspotList}
              iotStatus={iotStatusAgg}
              iotDone={iotStatusDone}
              onRetryIot={onRetryIot}
              utilizationIndex={utilizationIndex}
              mobile={mobileAgg}
              activity={mobileActivity}
              freshness={freshness}
              onRetryMobile={onRetryMobile}
              fleetState={fleetState}
              byNetwork={summary?.fleet?.byNetwork}
              onShowStatus={onShowStatus}
              onOpenHotspot={onOpenHotspot}
            />
          </Zone>
        )}
        {hasFleet && (
          <Zone i={4}>
            <MapSection
              wallet={wallet}
              list={hotspotList}
              places={places}
              iotStatus={iotStatusAgg}
              mobile={mobileAgg}
              activity={mobileActivity}
              freshness={freshness}
              heartbeatsLive={heartbeatsLive}
              fleetState={fleetState}
              filter={filter}
              onClearFilter={onClearFilter}
              detailKey={url.hotspot}
              mapSelect={mapSelect}
              onOpenDetail={onOpenHotspot}
              onPlace={onPlace}
              onShowStatus={onShowStatus}
            />
          </Zone>
        )}
        <Zone i={5}>
          <WalletSection wallet={wallet} summary={summaryState} governance={govState} transactions={txState} money={money} />
        </Zone>
        {hasFleet && (
          <Zone i={6}>
            <AboutSection
              wallet={wallet}
              list={hotspotList}
              places={places}
              onboarding={onboarding}
              summary={summaryState}
              fleetState={fleetState}
              onFilter={onFilter}
              onOpenHotspot={onOpenHotspot}
            />
          </Zone>
        )}
      </main>
      {!inList && (
        <DetailDialog open={Boolean(selectedRow)} mode={detailMode} regionRef={detailRegionRef} onClose={onCloseDetail}>
          {detail}
        </DetailDialog>
      )}
    </div>
  );
}
