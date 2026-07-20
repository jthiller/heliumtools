import { Card, DistroBar, Skeleton } from "./primitives.jsx";
import { NETWORK_LABEL, NETWORK_COLOR, deviceLabel, plural, fmtDate } from "../format.js";

/** One count tile in the connectivity/activity pairs. */
function StatTile({ value, label, tone }) {
  const styles =
    tone === "ok"
      ? {
          box: "bg-emerald-50 dark:bg-emerald-950/30",
          value: "text-emerald-700 dark:text-emerald-300",
          label: "text-emerald-700/70 dark:text-emerald-300/70",
        }
      : tone === "warn"
        ? {
            box: "bg-rose-50 dark:bg-rose-950/30",
            value: "text-rose-700 dark:text-rose-300",
            label: "text-rose-700/70 dark:text-rose-300/70",
          }
        : { box: "bg-surface-inset", value: "text-content-secondary", label: "text-content-tertiary" };
  return (
    <div className={`flex-1 rounded-lg px-3 py-2 ${styles.box}`}>
      <div className={`text-lg font-semibold tabular-nums ${styles.value}`}>{value}</div>
      <div className={`text-xs ${styles.label}`}>{label}</div>
    </div>
  );
}

export default function FleetCompositionCard({
  stats,
  rewards,
  rewardsDone,
  iotStatus,
  iotStatusDone,
  iotDataThrough,
}) {
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
  // Show live counts once the first flush lands; "…" only before any data.
  const iotSettled = iotStatusDone || (iotStatus?.counted || 0) > 0;
  const iotFootnote = [
    iotStatus?.settingUp > 0 && `${iotStatus.settingUp} setting up`,
    iotStatus?.unknown > 0 && `${iotStatus.unknown} unknown`,
    iotDataThrough && `as of ${fmtDate(iotDataThrough)}`,
  ]
    .filter(Boolean)
    .join(" · ");

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

      {(iotStatus?.iotTotal || 0) > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
            IoT connectivity{" "}
            {!iotStatusDone && <span className="normal-case text-content-tertiary">(scanning…)</span>}
          </div>
          <div className="flex gap-2">
            <StatTile value={iotSettled ? iotStatus.active : "…"} label="Active" tone="ok" />
            <StatTile value={iotSettled ? iotStatus.inactive : "…"} label="Inactive" tone="warn" />
          </div>
          {iotFootnote && <div className="mt-1.5 text-[11px] text-content-tertiary">{iotFootnote}</div>}
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
          Activity {!rewardsDone && <span className="normal-case text-content-tertiary">(scanning…)</span>}
        </div>
        <div className="flex gap-2">
          <StatTile value={earning ?? "…"} label="Earning" tone="ok" />
          <StatTile value={idle ?? "…"} label="Idle" />
        </div>
      </div>
    </Card>
  );
}
