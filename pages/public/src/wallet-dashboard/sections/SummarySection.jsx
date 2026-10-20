import { memo, useMemo, useRef } from "react";
import { Btn2, Card, Disclosure, StatusMark } from "../ui/index.js";
import { fmtCount, plural } from "../format.js";
import IdentityRow from "../summary/IdentityRow.jsx";
import MoneyBand from "../summary/MoneyBand.jsx";
import FleetStatusLine from "../summary/FleetStatusLine.jsx";
import { deriveDataStatus } from "../summary/dataStatus.js";

// What still shows when /summary fails, by what the wallet holds. Without
// Hotspot figures (none, or the list failed) it names only the sources that
// didn't fail too, and says nothing when none is left.
function stillShown(fleetState, list, money, governance, transactions) {
  const noHotspots = fleetState.state === "failed" || (fleetState.state === "ready" && list.counts.total === 0);
  if (!noHotspots) {
    return money.earned.kind === "iot" ? "Rewards and IoT activity are still shown." : "Rewards and earnings are still shown.";
  }
  const ve = !governance?.error;
  const tx = !transactions?.error;
  if (ve && tx) return "veHNT rewards and activity are still shown.";
  if (ve) return "veHNT rewards are still shown.";
  if (tx) return "Activity is still shown.";
  return "";
}

/**
 * Summary (WdSummary): the page's h1 and identity row with Data status, the
 * money band (Wallet value, Unclaimed, Earned or IoT activity, Lifetime
 * earned) and the fleet status line ("5 of 10 Hotspots need a look" with
 * its reasons). A failed /summary shows an alert with Retry while the rest
 * keeps loading; a failed Hotspot list settles every fleet figure with the
 * shared Retry. Announces, politely, when a long rewards scan finishes.
 *
 * Props: wallet, summary ({ data, loading, error, retry }), fleetState
 * ({ state, error, retry }), money (deriveMoney), places (deriveFleetPlaces),
 * list (aggregateHotspotList), freshness (mobileFreshness), onboarding
 * ({ stats, done, progress }), iotStatus, iotDone, utilizationIndex,
 * activity, governance ({ data, loading, error, retry }), transactions
 * (useWalletTransactions state), onRetryRewards,
 * onRetryIot, onRetryMobile, onShowStatus(key), onOpenHotspot(param, el).
 */
export default memo(function SummarySection({
  wallet,
  summary,
  fleetState,
  money,
  places,
  list,
  freshness,
  onboarding,
  iotStatus,
  iotDone,
  utilizationIndex,
  activity,
  governance,
  transactions,
  onRetryRewards,
  onRetryIot,
  onRetryMobile,
  onShowStatus,
  onOpenHotspot,
}) {
  const status = useMemo(
    () =>
      deriveDataStatus({
        summary,
        fleetState,
        list,
        money,
        onboarding,
        iotStatus,
        iotDone,
        utilizationIndex,
        freshness,
        activity,
        governance,
        transactions,
      }),
    [summary, fleetState, list, money, onboarding, iotStatus, iotDone, utilizationIndex, freshness, activity, governance, transactions],
  );

  // "Rewards checked for 1,659 Hotspots." once a scan that showed partial
  // figures finishes (a short scan never reads as partial, so it stays quiet),
  // and once a Retry of the failed batches finishes (the viewer asked for it),
  // including one that failed again (the alert beside it doesn't change, so
  // it wouldn't be read again).
  const scanRef = useRef(null);
  if (scanRef.current?.wallet !== wallet) scanRef.current = { wallet, scanning: false, message: "" };
  const hs = money.unclaimed.hotspotsState;
  if (hs === "scanning" || money.unclaimed.retrying) scanRef.current = { wallet, scanning: true, message: "" };
  else if (scanRef.current.scanning && hs === "failed" && fleetState.state !== "failed") {
    const total = money.unclaimed.total || list.counts.total;
    scanRef.current = { wallet, scanning: false, message: `Rewards couldn't be checked for ${plural(total, "Hotspot")}.` };
  } else if (scanRef.current.scanning && hs === "ready") {
    // Says what it covered: batches that failed aren't "checked".
    const total = money.unclaimed.total;
    let failed = 0;
    for (const r of list.rows) if (r.unclaimed.state === "failed") failed++;
    const message = failed
      ? `Rewards checked for ${fmtCount(total - failed)} of ${plural(total, "Hotspot")}. ${fmtCount(failed)} couldn't be checked.`
      : `Rewards checked for ${plural(total, "Hotspot")}.`;
    scanRef.current = { wallet, scanning: false, message };
  }

  const summaryFailed = Boolean(summary.error) && !summary.data;
  return (
    <section id="summary" aria-labelledby="summary-title" data-wd-section="summary" className="min-w-0">
      <IdentityRow
        wallet={wallet}
        places={places}
        summary={summary}
        fleetState={fleetState}
        onboarding={onboarding}
        governance={governance}
        status={status}
      />
      <p role="status" className="sr-only">
        {scanRef.current.message}
      </p>

      {summaryFailed && (
        <div
          role="alert"
          className="mb-4 grid grid-cols-[12px_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 rounded-xl bg-wd-critical-surface px-3.5 py-3 text-[13px] leading-5 text-wd-ink md:grid-cols-[12px_minmax(0,1fr)_auto] md:gap-y-1 md:px-4"
        >
          <StatusMark tier="serious" sr={false} className="mt-1" />
          <div className="min-w-0 pt-px">
            <span className="font-semibold text-wd-critical-text">Couldn&apos;t load this wallet.</span> Wallet value and USD at
            today&apos;s price are unavailable. {stillShown(fleetState, list, money, governance, transactions)}
          </div>
          <Btn2
            onClick={summary.retry}
            aria-label="Retry loading this wallet"
            className="col-start-2 justify-self-start md:col-start-3 md:row-start-1"
          >
            Retry
          </Btn2>
          <Disclosure summary="Details" className="col-start-2 text-wd-cap md:row-start-2">
            <span className="block pt-1">{String(summary.error)}</span>
          </Disclosure>
        </div>
      )}

      <Card pad={false}>
        <MoneyBand
          wallet={wallet}
          summary={summary}
          money={money}
          list={list}
          fleetState={fleetState}
          freshness={freshness}
          activity={activity}
          iotStatus={iotStatus}
          iotDone={iotDone}
          onRetryRewards={onRetryRewards}
          onRetryIot={onRetryIot}
          onRetryMobile={onRetryMobile}
        />
        <FleetStatusLine
          list={list}
          money={money}
          freshness={freshness}
          fleetState={fleetState}
          iotStatus={iotStatus}
          activity={activity}
          onShowStatus={onShowStatus}
          onOpenHotspot={onOpenHotspot}
        />
      </Card>
    </section>
  );
});
