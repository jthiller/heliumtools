import { useMemo } from "react";
import { Card, Skeleton } from "./primitives.jsx";
import {
  fmtCount,
  fmtUsd,
  fmtDate,
  isEarning,
  iotStatusOf,
  hotspotLifetimeUsd,
  DC_PER_USD,
} from "../format.js";

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
  const inactiveIotNames = useMemo(() => {
    const names = [];
    for (const h of hotspots || []) {
      if (iotStatusOf(h, iotStatusByKey?.[h.entityKey], iotDataThrough) === "inactive") {
        names.push(h.name || h.entityKey);
      }
    }
    return names;
  }, [hotspots, iotStatusByKey, iotDataThrough]);

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
        <InsightRow
          label={`Inactive IoT Hotspots${iotDataThrough ? ` (as of ${fmtDate(iotDataThrough)})` : ""}`}
          value={fmtCount(inactiveIotNames.length)}
          tone={inactiveIotNames.length > 0 ? "warn" : "ok"}
        />
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
        <div className="mt-3 rounded-lg bg-rose-50 p-3 dark:bg-rose-950/30">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-rose-700/80 dark:text-rose-300/80">
            Inactive IoT Hotspots
          </div>
          <div className="text-xs text-rose-700 dark:text-rose-300">
            {inactiveIotNames.slice(0, 4).join(", ")}
            {inactiveIotNames.length > 4 && ` and ${inactiveIotNames.length - 4} more`}
          </div>
        </div>
      )}

      {analysis.idleNames.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface-inset p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
            Idle Hotspots
          </div>
          <div className="text-xs text-content-secondary">
            {analysis.idleNames.slice(0, 4).join(", ")}
            {analysis.idleNames.length > 4 && ` and ${analysis.idleNames.length - 4} more`}
          </div>
        </div>
      )}

      {analysis.lowest.length > 0 && (
        <div className="mt-2 rounded-lg bg-surface-inset p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
            Lowest earners (per day)
          </div>
          <div className="text-xs text-content-secondary">
            {analysis.lowest.map((p) => p.name).join(", ")}
          </div>
        </div>
      )}
    </Card>
  );
}
