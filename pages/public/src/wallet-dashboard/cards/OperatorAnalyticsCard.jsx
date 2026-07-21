import { useMemo } from "react";
import { Card, Skeleton } from "./primitives.jsx";
import {
  fmtCount,
  fmtUsd,
  fmtDate,
  fmtDateUtc,
  isEarning,
  hasIotStatus,
  iotInactiveHotspots,
  hotspotLifetimeUsd,
  DC_PER_USD,
} from "../format.js";

/** Callout listing the first few Hotspot names with an "and N more" overflow. */
function NameCallout({ title, names, tone }) {
  const styles =
    tone === "warn"
      ? {
          box: "bg-rose-50 dark:bg-rose-950/30",
          head: "text-rose-700/80 dark:text-rose-300/80",
          text: "text-rose-700 dark:text-rose-300",
        }
      : { box: "bg-surface-inset", head: "text-content-tertiary", text: "text-content-secondary" };
  return (
    <div className={`mt-3 rounded-lg p-3 ${styles.box}`}>
      <div className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${styles.head}`}>
        {title}
      </div>
      <div className={`text-xs ${styles.text}`}>
        {names.slice(0, 4).join(", ")}
        {names.length > 4 && ` and ${names.length - 4} more`}
      </div>
    </div>
  );
}

function InsightRow({ label, value, tone }) {
  const valueClass =
    tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "ok"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-content";
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-content-secondary">{label}</span>
      <span className={`shrink-0 font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function OperatorAnalyticsCard({
  hotspots,
  rewardsByKey,
  rewardsDone,
  iotStatusByKey,
  iotStatusDone,
  iotDataThrough,
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
        let ageDays = null;
        if (h?.createdAt) {
          ageDays = Math.max(1, (Date.now() - new Date(h.createdAt).getTime()) / 86_400_000);
        }
        perf.push({ name: h?.name || key, perDay: ageDays ? usd / ageDays : null });
      }
    }
    const lowest = perf
      .filter((p) => p.perDay != null)
      .sort((a, b) => a.perDay - b.perDay)
      .slice(0, 3);
    return { idleNames, lowest };
  }, [hotspots, byKey, rewardsByKey, prices]);

  // IoT Hotspots the liveness feed marked inactive — didn't connect to the
  // Packet Router during the most recent reported day. The most actionable
  // signal here: an earning Hotspot that recently dropped offline shows up in
  // this list long before its rewards flatline.
  const inactiveIotNames = useMemo(
    () => iotInactiveHotspots(hotspots, iotStatusByKey, iotDataThrough).map((h) => h.name || h.entityKey),
    [hotspots, iotStatusByKey, iotDataThrough],
  );
  // Whether the fleet has any IoT Hotspots at all — mobile-only fleets get no
  // IoT connectivity row (matching how every other surface gates on iotTotal).
  const hasIotFleet = useMemo(() => (hotspots || []).some(hasIotStatus), [hotspots]);

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
      subtitle={!rewardsDone || !iotStatusDone ? "Fleet scan in progress…" : "Actionable fleet health"}
    >
      <div className="divide-y divide-border">
        {hasIotFleet && (
          <InsightRow
            label={`Inactive IoT Hotspots${iotDataThrough ? ` (as of ${fmtDateUtc(iotDataThrough)})` : ""}`}
            value={fmtCount(inactiveIotNames.length)}
            tone={inactiveIotNames.length > 0 ? "warn" : "ok"}
          />
        )}
        <InsightRow
          label="Idle Hotspots (no rewards)"
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
        <InsightRow label="Oldest deployment" value={fmtDate(stats.oldestCreatedAt)} />
        <InsightRow label="Newest deployment" value={fmtDate(stats.newestCreatedAt)} />
      </div>

      {inactiveIotNames.length > 0 && (
        <NameCallout title="Inactive IoT Hotspots" names={inactiveIotNames} tone="warn" />
      )}

      {analysis.idleNames.length > 0 && <NameCallout title="Idle Hotspots" names={analysis.idleNames} />}

      {analysis.lowest.length > 0 && (
        <NameCallout title="Lowest earners (per day)" names={analysis.lowest.map((p) => p.name)} />
      )}
    </Card>
  );
}
