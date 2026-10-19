import { memo, useCallback, useEffect, useRef } from "react";
import IotTrafficDetail from "../IotTrafficDetail.jsx";
import { IOT_CONNECTIVITY_NOTE, fmtDataDay, livenessDay } from "../format.js";
import { STATES } from "../statusRegistry.js";
import { NetChip } from "../ui/Chip.jsx";
import DetailEarnings from "./DetailEarnings.jsx";
import DetailFacts from "./DetailFacts.jsx";
import DetailHeader from "./DetailHeader.jsx";
import { DetailBar, DetailBottomNav } from "./DetailNav.jsx";
import DetailStatus from "./DetailStatus.jsx";
import LocationSection from "./LocationSection.jsx";
import MobileHealth from "./MobileHealth.jsx";
import { DSection, FINE, StateLine } from "./parts.jsx";

/** The nearest ancestor (or the element) that scrolls on its own. */
function scrollerOf(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const { overflowY } = getComputedStyle(n);
    if (overflowY === "auto" || overflowY === "scroll") return n;
  }
  return null;
}

/** The IoT connectivity line: the verdict for its day, with what Active means. */
function connectivity(row, ctx) {
  const iot = row.iot;
  const dayOf = () => {
    const day = iot.anchor ? livenessDay(iot.anchor) : ctx.iotDay;
    return day ? `${fmtDataDay(day)} (UTC)` : "the latest reported day";
  };
  switch (iot.status) {
    case "pending":
      return { tier: "checking", label: "Checking IoT status…", sub: IOT_CONNECTIVITY_NOTE };
    case "unknown":
      return iot.lookupFailed
        ? { tier: "unknown", mark: "x", label: "Couldn't check · IoT status", sub: IOT_CONNECTIVITY_NOTE }
        : { tier: "unknown", label: "Unknown · No status for this Hotspot", sub: IOT_CONNECTIVITY_NOTE };
    case "settingUp": {
      const day = ctx.iotDayLabel ?? "the latest reported day";
      return {
        tier: "info",
        label: "Setting up",
        sub: `Onboarded after the latest reported day, ${day}. Status appears after its first reported day.`,
      };
    }
    case "active":
      return { tier: "ok", label: `Active on ${dayOf()}`, sub: IOT_CONNECTIVITY_NOTE };
    default: {
      // Inactive takes the tier of its IoT state (Serious when it had traffic).
      const key = iot.health ?? "inactive";
      return { tier: STATES[key]?.tier ?? "check", label: `Inactive on ${dayOf()}`, sub: IOT_CONNECTIVITY_NOTE };
    }
  }
}

/** The IoT section: connectivity, then the messages it delivered. */
const IotSection = memo(function IotSection({ row, ctx, onRetry }) {
  const c = connectivity(row, ctx);
  return (
    <DSection id="iot" title="IoT" right={<NetChip net="iot" />}>
      <StateLine tier={c.tier} mark={c.mark} label={c.label} sub={c.sub} />
      <IotTrafficDetail
        entityKey={row.key}
        traffic={row.iot.traffic}
        lookupFailed={row.iot.lookupFailed}
        onRetry={onRetry}
        through={ctx.trafficThrough}
      />
    </DSection>
  );
});

/**
 * One Hotspot's detail, the same view whether it opens beside the list
 * ("aside", ≥ 1280 px), in a modal drawer ("drawer", 768 to 1279) or full
 * screen ("fullscreen", below 768), or is the Hotspots section's body for a
 * one-Hotspot wallet ("inline"). Sections render only where they apply:
 * header (with the ban block and any Mobile data note), Status, Earnings,
 * IoT, Mobile WiFi health or data-only, Location, Details, then Previous /
 * Next through the list's filtered order.
 *
 * Previous / Next keep this instance (and its one mini map) mounted; the
 * day selections, coverage toggle and Legacy disclosure reset per Hotspot,
 * and a scrolled detail returns to its top. In "aside" mode it's the card
 * inside the list's sticky, scrolling column; its bar sticks to that column.
 *
 * Props: row (HotspotRow), list (for its status windows and count), mobile,
 * freshness, prices (summary prices), walletWeekHnt, veHntPending, wallet,
 * nav ({ index, total, sortLabel, prev, next }), mode, headingRef (the h2,
 * focused on open), regionRef (the detail root, for the list's focus checks;
 * a dialog owns it in drawer and full-screen modes), onClose, onNavigate,
 * onShowOnMap(key), onRetry ({ iot, mobile, rewards? }).
 */
export default memo(function HotspotDetail({
  row,
  list,
  mobile,
  freshness,
  prices,
  walletWeekHnt,
  veHntPending,
  wallet,
  nav,
  mode,
  headingRef,
  regionRef,
  onClose,
  onNavigate,
  onShowOnMap,
  onRetry,
}) {
  const rootRef = useRef(null);
  const inDialog = mode === "drawer" || mode === "fullscreen";
  const setRoot = useCallback(
    (el) => {
      rootRef.current = el;
      if (regionRef && !inDialog) regionRef.current = el;
    },
    [regionRef, inDialog],
  );

  // A new Hotspot starts at its top: the aside column and the dialogs
  // scroll on their own (the inline detail is in the page's flow).
  useEffect(() => {
    if (mode === "inline") return;
    const scroller = scrollerOf(rootRef.current);
    if (scroller && scroller.scrollTop > 0) scroller.scrollTop = 0;
  }, [row.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = list.ctx;
  const withBar = mode !== "inline";
  const card = mode === "aside" || mode === "inline";
  // Busy while any of this Hotspot's own sources is still loading.
  const busy = row.checking || row.unclaimed.state === "loading" ? "true" : undefined;

  const body = (
    <>
      {withBar && (
        <DetailBar
          name={row.name}
          nav={nav}
          fullscreen={mode === "fullscreen"}
          card={card}
          onClose={onClose}
          onNavigate={onNavigate}
        />
      )}
      <DetailHeader
        row={row}
        freshness={freshness}
        windows={mobile?.windows}
        headingRef={headingRef}
        onShowOnMap={onShowOnMap}
        onRetryMobile={onRetry?.mobile}
      />
      <DetailStatus row={row} ctx={ctx} mobile={mobile} />
      <DetailEarnings
        row={row}
        ctx={ctx}
        mobile={mobile}
        freshness={freshness}
        prices={prices}
        wallet={wallet}
        walletWeekHnt={walletWeekHnt}
        veHntPending={veHntPending}
        single={list.counts.total === 1}
        onRetry={onRetry}
      />
      {row.iot && <IotSection row={row} ctx={ctx} onRetry={onRetry?.iot} />}
      <MobileHealth row={row} mobile={mobile} onRetry={onRetry?.mobile} />
      <LocationSection row={row} mobile={mobile} />
      <DetailFacts row={row} />
      {withBar && <DetailBottomNav nav={nav} onNavigate={onNavigate} />}
    </>
  );

  // Escape closes the aside (a dialog hears it as `cancel`). InfoTips and the
  // day charts consume it first.
  const onKeyDown =
    mode === "aside"
      ? (e) => {
          if (e.key !== "Escape" || e.defaultPrevented) return;
          e.preventDefault();
          onClose();
        }
      : undefined;

  if (mode === "aside") {
    // The list's 440 px column (HotspotsSection) is the sticky, scrolling
    // landmark; this is the card inside it, its bar sticking to the column.
    return (
      <div
        ref={setRoot}
        data-wd-detail={mode}
        aria-busy={busy}
        onKeyDown={onKeyDown}
        className="wd-detail min-w-0 rounded-2xl bg-surface-raised shadow-soft"
      >
        {body}
      </div>
    );
  }
  if (mode === "inline") {
    return (
      <div
        ref={setRoot}
        data-wd-detail={mode}
        aria-busy={busy}
        className={`wd-detail w-full min-w-0 rounded-2xl bg-surface-raised shadow-soft max-md:rounded-none max-md:shadow-none md:max-w-[440px] ${FINE}`}
      >
        {body}
      </div>
    );
  }
  return (
    <div ref={setRoot} data-wd-detail={mode} aria-busy={busy} className="wd-detail min-h-full min-w-0 bg-surface-raised">
      {body}
    </div>
  );
});
