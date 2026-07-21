import { memo } from "react";
import { Card, Skeleton, CardEmpty } from "./primitives.jsx";
import { plural } from "../format.js";

function monthLabel(ym) {
  // "2026-05" → "May ’26"
  const [y, m] = ym.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1] || "?"} ’${y.slice(2)}`;
}

// memo: the dashboard shell re-renders on every rewards/IoT-status scan flush;
// this card's props are referentially stable across those, so skip the churn.
export default memo(function DeploymentTimelineCard({ timeline }) {
  if (!timeline) {
    return (
      <Card title="Deployment timeline">
        <Skeleton className="h-28 w-full" />
      </Card>
    );
  }
  if (timeline.length === 0) {
    return (
      <Card title="Deployment timeline">
        <CardEmpty>No deployment dates</CardEmpty>
      </Card>
    );
  }

  const max = Math.max(...timeline.map((b) => b.count), 1);
  const total = timeline.reduce((s, b) => s + b.count, 0);
  const first = timeline[0];
  const last = timeline[timeline.length - 1];

  return (
    <Card title="Deployment timeline" subtitle={`${plural(total, "Hotspot")} added`}>
      <div className="flex h-36 items-end gap-px">
        {timeline.map((b) => (
          <div
            key={b.month}
            role="img"
            aria-label={`${monthLabel(b.month)}: ${plural(b.count, "Hotspot")}`}
            title={`${monthLabel(b.month)}: ${b.count}`}
            className="min-w-[2px] flex-1 rounded-t bg-accent/70 transition-colors hover:bg-accent"
            style={{ height: `${Math.max((b.count / max) * 100, 3)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-content-tertiary">
        <span>{monthLabel(first.month)}</span>
        <span>{monthLabel(last.month)}</span>
      </div>
    </Card>
  );
});
