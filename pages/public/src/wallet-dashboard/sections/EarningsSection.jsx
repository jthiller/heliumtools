import { memo, useRef } from "react";
import { Section } from "../ui/index.js";
import { plural } from "../format.js";
import { hntWhere, noDailyNote } from "../copy.js";
import DailyHntCard from "../earnings/DailyHntCard.jsx";
import EarningsFacts from "../earnings/EarningsFacts.jsx";
import UnclaimedCard from "../earnings/UnclaimedCard.jsx";
import LifetimeCard from "../earnings/LifetimeCard.jsx";

// The latest live arrival that brought new rows to each table (0: none since
// this wallet's baseline): count-up and bar-growth triggers. The first load
// and a saved paint never move `arrivals.seq`. Resets per wallet.
function useArrivalKeys(arrivals, wallet) {
  const ref = useRef(null);
  const seq = arrivals?.seq ?? 0;
  if (ref.current === null || ref.current.wallet !== wallet) ref.current = { wallet, seen: seq, keys: { rewards: 0, usage: 0 } };
  const r = ref.current;
  if (seq > r.seen) {
    const by = arrivals.byTable || {};
    if (by.rewards || by.usage) {
      r.keys = { rewards: by.rewards ? seq : r.keys.rewards, usage: by.usage ? seq : r.keys.usage };
    }
  }
  r.seen = seq;
  return r.keys;
}

/**
 * Earnings (WdEarnings): for a wallet with Mobile Hotspots, "HNT per day"
 * (the fleet's HNT from Mobile data transfer per UTC day, 7 days) beside its
 * facts (Rewarded data, Users served, Hotspots rewarded); for an IoT-only or
 * empty wallet a note that there is no per-day chart. Then Unclaimed and
 * Lifetime earned (Lifetime only with Hotspots). The selected day, count-up
 * baselines and bar growth reset per wallet.
 *
 * Props: wallet, money, list, mobile, activity, freshness, prices,
 * governance ({ data, loading, error, retry }), onRetryRewards, onRetryMobile,
 * fleetState (optional: its Retry when the Hotspot list failed).
 */
export default memo(function EarningsSection({
  wallet,
  money,
  list,
  mobile,
  activity,
  freshness,
  prices,
  governance,
  onRetryRewards,
  onRetryMobile,
  fleetState,
}) {
  const e = money.earned;
  const days = e.days;
  const arrivals = useArrivalKeys(activity?.arrivals, wallet);

  const fleetLoaded = fleetState ? fleetState.state !== "loading" : list.rows.length > 0 || money.unclaimed.hotspotsState !== "loading";
  const total = list.counts.total;
  // While neither the list nor /summary has said which networks the wallet
  // has, the chart's place is reserved (as Summary reserves its Earned
  // column), so it never pushes the cards below down when it arrives.
  const networksUnknown = !fleetLoaded && money.walletValue.state !== "ready";
  const hasChart = e.kind === "mobile" || (e.kind === "none" && (money.unclaimed.fleetFailed || networksUnknown));
  const hasIot = list.counts.iot > 0;
  const empty = fleetLoaded && total === 0 && !money.unclaimed.fleetFailed && e.kind === "none";
  const scope = empty
    ? "Unclaimed veHNT rewards. This wallet has no Hotspots."
    : !fleetLoaded && e.kind === "none"
      ? null
      : !hasChart
        ? total === 1
          ? "Unclaimed and lifetime HNT for this wallet's 1 Hotspot."
          : total > 1
            ? `Unclaimed and lifetime HNT for all ${plural(total, "Hotspot")}.`
            : "Unclaimed and lifetime HNT for this wallet's Hotspots."
        : hasIot
          ? `HNT from Mobile data transfer, by UTC day. ${hntWhere("IoT Hotspots")}`
          : "HNT from Mobile data transfer, by UTC day.";
  const note = `${noDailyNote(hasIot ? "IoT Hotspots" : "These Hotspots")} This wallet has no per-day chart.`;
  // Nothing to chart: the earnings check failed with no days in, or the
  // Hotspot list did (its Retry then reloads the list).
  const fleetFailed = money.unclaimed.fleetFailed;
  const chartFailed = fleetFailed ? "fleet" : !days.length && (mobile.failed?.rewards || activity?.phase === "error") ? "mobile" : false;
  const onRetryChart = fleetFailed ? (fleetState?.retry ?? null) : onRetryMobile;
  const onRetryUnclaimed = fleetFailed ? (fleetState?.retry ?? null) : onRetryRewards;
  // Lifetime is the Hotspots' (and reserved while the fleet loads).
  const showLifetime = !empty;

  return (
    <Section id="earnings" title="Earnings" caption={scope} data-wd-section="earnings">
      <div className="flex flex-col gap-4">
        {hasChart ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* Keyed by wallet: the day being read goes back to its default. */}
            <DailyHntCard
              key={wallet}
              loading={!fleetLoaded}
              money={money}
              mobile={mobile}
              activity={activity}
              freshness={freshness}
              growKey={arrivals.rewards}
              failed={chartFailed}
              onRetry={onRetryChart}
              onRetryMobile={onRetryMobile}
            />
            <EarningsFacts
              wallet={wallet}
              loading={!fleetLoaded}
              money={money}
              mobile={mobile}
              activity={activity}
              flashes={arrivals}
              showData={!chartFailed}
              failed={fleetFailed}
            />
          </div>
        ) : (
          // An empty wallet: the caption already says it has no Hotspots.
          fleetLoaded && !empty && <p className="m-0 rounded-lg bg-wd-well px-4 py-3 text-[13px] leading-[18px] text-wd-ink-2">{note}</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <UnclaimedCard wallet={wallet} money={money} list={list} governance={governance} onRetry={onRetryUnclaimed} />
          {showLifetime && <LifetimeCard money={money} list={list} prices={prices} />}
        </div>
      </div>
    </Section>
  );
});
