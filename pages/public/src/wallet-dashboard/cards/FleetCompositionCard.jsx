import { memo } from "react";
import { Card, DistroBar, Skeleton } from "./primitives.jsx";
import { NETWORK_LABEL, NETWORK_COLOR, deviceLabel, plural } from "../format.js";

/** One count tile in the rewards pair. */
function StatTile({ value, label, tone }) {
  const styles =
    tone === "ok"
      ? {
          box: "bg-emerald-50 dark:bg-emerald-950/30",
          value: "text-emerald-700 dark:text-emerald-300",
          label: "text-emerald-700/70 dark:text-emerald-300/70",
        }
      : { box: "bg-surface-inset", value: "text-content-secondary", label: "text-content-tertiary" };
  return (
    <div className={`flex-1 rounded-lg px-3 py-2 ${styles.box}`}>
      <div className={`text-lg font-semibold tabular-nums ${styles.value}`}>{value}</div>
      <div className={`text-xs ${styles.label}`}>{label}</div>
    </div>
  );
}

// memo: the dashboard shell re-renders on every rewards/IoT-status scan flush;
// this card's props are referentially stable across the IoT ones, so skip them.
export default memo(function FleetCompositionCard({ stats, rewards, rewardsDone }) {
  if (!stats) {
    return (
      <Card title="Fleet composition">
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  const total = stats.total || 0;
  const networks = Object.entries(stats.byNetwork || {}).sort((a, b) => b[1] - a[1]);
  const devices = Object.entries(stats.byDeviceType || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const earning = rewards?.earning ?? null;
  const idle = rewards?.idle ?? null;

  return (
    <Card title="Fleet composition" subtitle={plural(total, "Hotspot")}>
      <div className="space-y-2.5">
        {networks.map(([n, c]) => (
          <DistroBar key={n} label={NETWORK_LABEL[n] || n} count={c} total={total} color={NETWORK_COLOR[n]} />
        ))}
      </div>

      {devices.length > 0 && (
        <div className="mt-4 space-y-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-tertiary">By device type</div>
          {devices.map(([d, c]) => (
            <DistroBar key={d} label={deviceLabel(d)} count={c} total={total} />
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
          Rewards {!rewardsDone && <span className="normal-case text-content-tertiary">(scanning…)</span>}
        </div>
        <div className="flex gap-2">
          <StatTile value={earning ?? "…"} label="Ever rewarded" tone="ok" />
          <StatTile value={idle ?? "…"} label="Never rewarded" />
        </div>
      </div>
    </Card>
  );
});
