import { Card, DistroBar, Skeleton } from "./primitives.jsx";
import { NETWORK_LABEL, NETWORK_COLOR, deviceLabel, plural } from "../format.js";

export default function FleetCompositionCard({ stats, rewards, rewardsDone }) {
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
          Activity {!rewardsDone && <span className="normal-case text-content-tertiary">(scanning…)</span>}
        </div>
        <div className="flex gap-2">
          <div className="flex-1 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
            <div className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
              {earning ?? "…"}
            </div>
            <div className="text-xs text-emerald-700/70 dark:text-emerald-300/70">Earning</div>
          </div>
          <div className="flex-1 rounded-lg bg-surface-inset px-3 py-2">
            <div className="text-lg font-semibold tabular-nums text-content-secondary">{idle ?? "…"}</div>
            <div className="text-xs text-content-tertiary">Idle</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
