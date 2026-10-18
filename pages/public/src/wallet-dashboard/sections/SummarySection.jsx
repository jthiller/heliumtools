import { memo } from "react";
import { fmtHnt, fmtUsd, shortAddress } from "../format.js";
import { needsLine } from "../copy.js";

/**
 * Summary: identity row (the page h1), Data status, money band, fleet status
 * line. STUB (U0a): the final props, a placeholder body; U1 replaces it.
 *
 * Props: wallet, summary ({ data, loading, error, retry }), fleetState
 * ({ state, error, retry }), money (deriveMoney), places (deriveFleetPlaces),
 * list (aggregateHotspotList), freshness (mobileFreshness), onboarding
 * ({ stats, done, progress }), iotStatus, iotDone, utilizationIndex,
 * activity, governance ({ data, loading, error, retry }), transactions
 * (useWalletTransactions state), rewardsProgress, onRetryRewards,
 * onRetryIot, onRetryMobile, onShowStatus(key), onOpenHotspot(param, el).
 */
export default memo(function SummarySection({ wallet, money, places, list }) {
  const v = money.walletValue;
  return (
    <section id="summary" aria-labelledby="summary-title" data-wd-section="summary">
      <h1 id="summary-title" className="m-0 font-display text-wd-h1-sm font-semibold md:text-wd-h1">
        {shortAddress(wallet)}
        <span className="sr-only">, wallet {wallet}</span>
      </h1>
      <p className="mt-1 text-wd-cap text-wd-ink-2">{places ? places.caption() : "Loading Hotspots…"}</p>
      <p className="mt-3 text-wd-sm text-wd-ink-2">
        Wallet value {v.state === "ready" ? fmtUsd(v.usd) : v.state === "failed" ? "couldn't load" : "…"} · Unclaimed{" "}
        {money.unclaimed.hnt == null ? "…" : `${fmtHnt(money.unclaimed.hnt, "stat")} HNT`} · Lifetime earned{" "}
        {money.lifetime.hnt == null ? "…" : `${fmtHnt(money.lifetime.hnt, "stat")} HNT`} ·{" "}
        {list.counts.needs == null ? "Checking Hotspots…" : needsLine(list.counts.needs, list.counts.total)}
      </p>
    </section>
  );
});
