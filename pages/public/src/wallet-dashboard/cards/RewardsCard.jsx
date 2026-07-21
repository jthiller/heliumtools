import { memo } from "react";
import { Card, ProgressBar } from "./primitives.jsx";
import { fmtToken, fmtUsd, govPendingHnt, unclaimedTotalUsd } from "../format.js";

// Hotspots earn HNT now (post-HIP-138); IOT/MOBILE are legacy subDAO tokens and
// are only shown when a wallet still holds unclaimed legacy amounts.
const TOKENS = ["hnt", "iot", "mobile"];

// memo: the dashboard shell re-renders on every rewards/IoT-status scan flush;
// this card's props are referentially stable across those, so skip the churn.
export default memo(function RewardsCard({ rewards, progress, done, unavailable, prices, governance, govLoading, wallet }) {
  // Headline folds veHNT delegation pending into the fleet pending total, so a
  // wallet with veHNT rewards but no (or idle) Hotspots doesn't read $0.00.
  const govPending = govPendingHnt(governance);
  const totalPendingUsd = unclaimedTotalUsd(rewards, governance, prices);
  // Pending > claimable means some rewards aren't claimable right now. Per the
  // oracle service that's a missing associated token account on the receiving
  // wallet (owner or custom claim destination), but a failed ATA existence
  // check is reported the same way, so the note hedges with "typically" and
  // defers specifics to the claimer.
  const hasUnclaimable =
    rewards && TOKENS.some((t) => (rewards.pendingUi[t] || 0) > (rewards.claimableUi[t] || 0));
  const scanning = !done && progress?.total > 0;
  // Show "…" only while something is still in flight AND we have nothing yet;
  // once either source reports a value we render the running total. Both fleet
  // rewards and veHNT load independently, so gate on both finishing.
  const showEllipsis = (!done || govLoading) && totalPendingUsd === 0;
  const claimHref = wallet
    ? `/hotspot-claimer?mode=wallet&wallet=${encodeURIComponent(wallet)}`
    : "/hotspot-claimer";

  return (
    <Card
      title="Unclaimed rewards"
      subtitle={
        unavailable
          ? "Rewards temporarily unavailable"
          : scanning
            ? `Scanning ${progress.done}/${progress.total} Hotspots…`
            : "Pending rewards"
      }
      action={
        <a href={claimHref} className="text-xs font-medium text-accent-text hover:underline">
          Claim →
        </a>
      }
    >
      <div className="font-display text-3xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
        {unavailable ? "—" : showEllipsis ? "…" : fmtUsd(totalPendingUsd)}
      </div>
      {hasUnclaimable && (
        <p className="mt-1 text-xs text-content-tertiary">
          Some pending rewards can&apos;t be claimed yet, typically because the receiving
          wallet needs a token account for them.
        </p>
      )}

      {scanning && (
        <div className="mt-3">
          <ProgressBar done={progress.done} total={progress.total} />
        </div>
      )}

      <div className="mt-4 space-y-1.5 text-sm">
        {TOKENS.filter(
          (t) => t === "hnt" || (rewards?.pendingUi[t] || 0) > 0 || (rewards?.lifetimeUi[t] || 0) > 0,
        ).map((t) => (
          <div key={t} className="flex items-center justify-between">
            <span className="text-content-secondary">{t.toUpperCase()} pending</span>
            <span className="tabular-nums text-content">
              {rewards ? fmtToken(rewards.pendingUi[t], { max: 2 }) : "…"}
            </span>
          </div>
        ))}
      </div>

      {rewards && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
            Lifetime earned
          </div>
          <div className="space-y-1 text-sm">
            {TOKENS.map((t) => {
              const v = rewards.lifetimeUi[t];
              if (!v) return null;
              return (
                <div key={t} className="flex items-center justify-between">
                  <span className="text-content-secondary">{t.toUpperCase()}</span>
                  <span className="tabular-nums text-content-tertiary">{fmtToken(v, { max: 2 })}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {govPending > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-content-secondary">veHNT pending</span>
          <span className="tabular-nums text-content">{fmtToken(govPending, { max: 2 })} HNT</span>
        </div>
      )}
    </Card>
  );
});
