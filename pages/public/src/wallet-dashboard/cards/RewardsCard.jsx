import { Card, ProgressBar } from "./primitives.jsx";
import { fmtToken, fmtUsd, rewardUsd } from "../format.js";

// Hotspots earn HNT now (post-HIP-138); IOT/MOBILE are legacy subDAO tokens and
// are only shown when a wallet still holds unclaimed legacy amounts.
const TOKENS = ["hnt", "iot", "mobile"];

export default function RewardsCard({ rewards, progress, done, unavailable, prices, governance, wallet }) {
  const pendingUsd = rewards ? rewardUsd(rewards.pendingUi, prices) : null;
  // Pending rewards the wallet can't receive yet (missing associated token
  // account) — the claimer flags these and creating the ATA unblocks them.
  const needsAta =
    rewards && TOKENS.some((t) => (rewards.pendingUi[t] || 0) > (rewards.claimableUi[t] || 0));
  const scanning = !done && progress?.total > 0;
  const pending = (rewards?.counted ?? 0) === 0 && !done;
  const claimHref = wallet
    ? `/hotspot-claimer?mode=wallet&wallet=${encodeURIComponent(wallet)}`
    : "/hotspot-claimer";
  const gov = governance?.totals;
  const govPending = gov && Number(gov.positionCount) > 0 ? Number(gov.pendingRewardsHnt || 0) : 0;

  return (
    <Card
      title="Unclaimed rewards"
      subtitle={
        unavailable
          ? "Rewards temporarily unavailable"
          : scanning
            ? `Scanning ${progress.done}/${progress.total} Hotspots…`
            : "Pending across your fleet"
      }
      action={
        <a href={claimHref} className="text-xs font-medium text-accent-text hover:underline">
          Claim →
        </a>
      }
    >
      <div className="font-display text-3xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
        {unavailable ? "—" : pending ? "…" : fmtUsd(pendingUsd)}
      </div>
      {needsAta && (
        <p className="mt-1 text-xs text-content-tertiary">
          Some rewards need a token account in this wallet before they can be claimed.
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
}
