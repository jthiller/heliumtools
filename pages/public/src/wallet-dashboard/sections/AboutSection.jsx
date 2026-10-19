import { memo, useCallback, useMemo, useState } from "react";
import { Card, FleetError, Section, Skeleton } from "../ui/index.js";
import { fmtCount, fmtUtcDate, plural, ONBOARDED_NOTE } from "../format.js";
import { FLEET_UNAVAILABLE } from "../copy.js";
import { compositionOf, feesOf, placesOf } from "../about/aboutModel.js";
import Composition from "../about/Composition.jsx";
import Places from "../about/Places.jsx";
import OnboardingTimeline from "../about/OnboardingTimeline.jsx";
import OnboardingFees from "../about/OnboardingFees.jsx";

const CLEAR = { q: null, net: null, device: null, status: null, month: null };

/** The quiet one-line About for a wallet with one Hotspot (or none). */
function Line({ children, note }) {
  return (
    <div className="rounded-xl bg-wd-well px-[18px] py-3.5 text-wd-sm leading-5 text-wd-ink-2 max-md:px-3.5 max-md:py-3">
      <p className="m-0">{children}</p>
      {note && <p className="m-0 mt-1 text-wd-cap">{note}</p>}
    </div>
  );
}

function OneHotspot({ row, fees }) {
  const at = row.onboarded.at;
  return (
    <Line note={ONBOARDED_NOTE}>
      <span className="font-semibold text-wd-ink">{row.name || "Unnamed Hotspot"}</span>
      {` · ${row.deviceLabel} · ${row.place.full ?? row.placeText} · `}
      {at === undefined ? (
        <>
          <span aria-hidden="true">Onboarded …</span>
          <span className="sr-only">Onboard date: waiting on onboard dates</span>
        </>
      ) : at ? (
        `Onboarded ${fmtUtcDate(at)} (UTC)`
      ) : (
        "Onboard date unknown"
      )}
      {fees.anyFee ? ` · Onboarding fee ${fees.dcText} DC (${fees.usd})` : " · No onboarding fee on record"}
    </Line>
  );
}

// The four cards in their final shape while the Hotspot list loads.
function LoadingCards() {
  const card = (cls, h) => (
    <Card className={`flex flex-col gap-4 ${cls}`}>
      <Skeleton w={140} h={18} />
      <Skeleton w="100%" h={10} />
      <Skeleton w="70%" h={14} />
      <Skeleton w="100%" h={h} />
    </Card>
  );
  return (
    <>
      <p role="status" className="sr-only">
        Loading fleet facts
      </p>
      <div aria-hidden="true" className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-12">
        {card("lg:col-span-6", 180)}
        {card("lg:col-span-6", 180)}
        {card("lg:col-span-12 xl:col-span-8", 160)}
        {card("lg:col-span-12 xl:col-span-4", 160)}
      </div>
    </>
  );
}

/**
 * About this fleet: Composition, Places, Onboarding over time and Onboarding
 * fees (12 columns from 1024 px: 6 and 6, then 8 and 4 from 1280 px; one
 * column on phones). A wallet with one Hotspot gets one quiet line (its
 * detail is the Hotspots section); the shell doesn't render About for a
 * wallet with none. Every count is a row set the Hotspot list can show:
 * devices, cities, never rewarded, unasserted and onboard months filter it
 * (each clears the other filters, so the list's result line equals the
 * count here; a city's search can also match its other spellings, and the
 * row's name says how many it shows). A failed Hotspot list reads one line
 * with the shared Retry.
 *
 * Props: wallet, list, places, onboarding ({ stats, done, progress, byKey }),
 * summary ({ data, loading, error, retry }), fleetState ({ state, error,
 * retry }), onFilter(patch), onOpenHotspot(param, el).
 */
export default memo(function AboutSection({ wallet, list, places, onboarding, summary, fleetState, onFilter, onOpenHotspot }) {
  // "Show all cities" closes again on any wallet switch (the last wallet is
  // kept in state, so the reset survives StrictMode's double render).
  const [cities, setCities] = useState({ wallet, all: false });
  if (cities.wallet !== wallet) setCities({ wallet, all: false });
  const allCities = cities.wallet === wallet && cities.all;
  const onShow = useCallback((patch) => onFilter({ ...CLEAR, ...patch }), [onFilter]);
  const onToggleAll = useCallback(() => setCities((c) => ({ wallet: c.wallet, all: !c.all })), []);

  const ready = fleetState.state === "ready";
  const total = list.counts.total;
  const full = ready && total > 1;
  const composition = useMemo(() => (full ? compositionOf(list) : null), [full, list]);
  const placesModel = useMemo(() => (full ? placesOf(list, places, { expanded: allCities }) : null), [full, list, places, allCities]);
  const fees = useMemo(() => (ready && total > 0 ? feesOf(list) : null), [ready, total, list]);
  const single = onboarding.done && (onboarding.stats?.timeline?.length ?? 0) === 1;

  const count = ready ? total : summary.data?.fleet?.count;
  const unlisted = ready ? list.counts.unlisted : 0;
  const caption =
    fleetState.state === "failed" || count == null || count === 0
      ? null
      : `${plural(count, "Hotspot")}${unlisted > 0 ? ` · ${fmtCount(unlisted)} couldn't be listed` : ""}`;

  let body;
  if (fleetState.state === "failed") {
    body = (
      <FleetError fleetState={fleetState} line={FLEET_UNAVAILABLE.about} />
    );
  } else if (!ready) {
    body = <LoadingCards />;
  } else if (total === 0) {
    body = <Line>No Hotspots in this wallet.</Line>;
  } else if (total === 1) {
    body = <OneHotspot row={list.rows[0]} fees={fees} />;
  } else {
    body = (
      <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-12">
        <Composition model={composition} onShow={onShow} className="lg:col-span-6" />
        <Places
          model={placesModel}
          onShow={onShow}
          onOpenHotspot={onOpenHotspot}
          onToggleAll={onToggleAll}
          className="lg:col-span-6"
        />
        <OnboardingTimeline
          wallet={wallet}
          onboarding={onboarding}
          list={list}
          onShow={onShow}
          onOpenHotspot={onOpenHotspot}
          className="lg:col-span-12 xl:col-span-8"
        />
        <OnboardingFees
          model={fees}
          onboarding={onboarding}
          list={list}
          showDates={!single}
          onOpenHotspot={onOpenHotspot}
          className="lg:col-span-12 xl:col-span-4"
        />
      </div>
    );
  }

  return (
    <Section id="about" title="About this fleet" caption={caption} busy={!ready && fleetState.state !== "failed"} data-wd-section="about">
      {body}
    </Section>
  );
});
