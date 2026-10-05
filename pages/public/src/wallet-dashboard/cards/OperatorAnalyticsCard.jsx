import { memo, useMemo } from "react";
import { Card, Skeleton, NameCallout } from "./primitives.jsx";
import { fmtCount, fmtUsd, fmtDate, isEarning, hotspotLifetimeUsd, onboardedAtOf, DC_PER_USD, ONBOARDED_NOTE } from "../format.js";

function InsightRow({ label, value, tone, title }) {
  const valueClass =
    tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "ok"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-content";
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm" title={title}>
      <span className="text-content-secondary">{label}</span>
      <span className={`shrink-0 font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

// memo: the dashboard shell re-renders on every rewards/IoT-status scan flush;
// this card's props only change on rewards and onboard-date flushes.
// `onboarding` is the shell's onboardingStats, null until every date is in.
export default memo(function OperatorAnalyticsCard({
  hotspots,
  rewardsByKey,
  rewardsDone,
  onboardedByKey,
  onboarding,
  prices,
  stats,
}) {
  // Stable index — built once per fleet, not rebuilt on every reward batch.
  const byKey = useMemo(
    () => new Map((hotspots || []).map((h) => [h.entityKey, h])),
    [hotspots],
  );
  const analysis = useMemo(() => {
    if (!hotspots) return null;
    const idleNames = [];
    const perf = [];
    for (const [key, rewards] of Object.entries(rewardsByKey || {})) {
      const earning = isEarning(rewards);
      const h = byKey.get(key);
      if (earning === false) {
        idleNames.push(h?.name || key);
      } else if (earning === true) {
        const usd = hotspotLifetimeUsd(rewards, prices) || 0;
        // Age on Solana. Lifetime is the Solana reward oracles' running total,
        // so an L1-era Hotspot's migration date is a fitting start here too.
        const onboardedAt = onboardedAtOf(onboardedByKey?.[key]);
        let ageDays = null;
        if (onboardedAt) {
          ageDays = Math.max(1, (Date.now() - new Date(onboardedAt).getTime()) / 86_400_000);
        }
        perf.push({ name: h?.name || key, perDay: ageDays ? usd / ageDays : null });
      }
    }
    const lowest = perf
      .filter((p) => p.perDay != null)
      .sort((a, b) => a.perDay - b.perDay)
      .slice(0, 3);
    return { idleNames, lowest };
  }, [hotspots, byKey, rewardsByKey, onboardedByKey, prices]);

  if (!stats || !analysis) {
    return (
      <Card title="Operator insights">
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  const onboardingDc = stats.onboardingDcTotal || 0;

  return (
    <Card
      title="Operator insights"
      subtitle={rewardsDone && onboarding ? "Actionable fleet health" : "Fleet scan in progress…"}
    >
      <div className="divide-y divide-border">
        <InsightRow
          label="Never rewarded"
          value={fmtCount(analysis.idleNames.length)}
          tone={analysis.idleNames.length > 0 ? "warn" : "ok"}
        />
        <InsightRow
          label="Without asserted location"
          value={fmtCount(stats.unasserted)}
          tone={stats.unasserted > 0 ? "warn" : "ok"}
        />
        <InsightRow
          label="DC invested in onboarding"
          value={`${fmtCount(onboardingDc)} DC · ${fmtUsd(onboardingDc / DC_PER_USD)}`}
        />
        <InsightRow
          label="First onboarded"
          value={onboarding ? fmtDate(onboarding.oldest) : "…"}
          title={ONBOARDED_NOTE}
        />
        <InsightRow
          label="Latest onboarded"
          value={onboarding ? fmtDate(onboarding.newest) : "…"}
          title={ONBOARDED_NOTE}
        />
      </div>

      {analysis.idleNames.length > 0 && <NameCallout title="Never rewarded" names={analysis.idleNames} />}

      {analysis.lowest.length > 0 && (
        <NameCallout title="Lowest earners (per day)" names={analysis.lowest.map((p) => p.name)} />
      )}
    </Card>
  );
});
