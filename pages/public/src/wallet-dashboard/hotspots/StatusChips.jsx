import { plural } from "../format.js";
import { statusFilterLabel, tierOfFilter } from "../statusRegistry.js";
import { Chip } from "../ui/Chip.jsx";
import { markOf } from "./StatusCell.jsx";

// The chips in the row, in order (JUDGE 7): Needs a look and the problem
// states by tier and state order, then No issues; Quiet, Info and Unknown
// states after a gap. A chip shows when its count is above 0, or while it's
// the active filter (so it can be cleared, even at 0).
const MAIN = [
  "needs",
  "banned",
  "inactiveTraffic",
  "noRewardedData",
  "activeQuiet",
  "inactiveQuiet",
  "inactive",
  "noHeartbeat",
  "lowTrust",
  "lowSpeedtest",
  "rejectedHeartbeats",
  "ok",
];
// OK-tier verdicts reached from Health or Summary (a URL): shown only while active.
const ACTIVE_ONLY = ["activeTraffic", "active", "heartbeatOk", "rewardedDays", "mobileOk", "checking"];
const AFTER_GAP = ["neverRewarded", "noLocation", "settingUp", "iotUnknown", "noStatus", "iotFailed", "mobileFailed"];

/** Whether a chip's count can be shown yet: "Needs a look" and "No issues"
 * once every source has settled, the rewards-derived states once theirs. */
function countReady(key, settled) {
  if (key === "needs" || key === "ok") return Boolean(settled?.verdicts);
  if (key === "noRewardedData") return Boolean(settled?.rewards && settled?.mobile);
  if (key === "neverRewarded") return Boolean(settled?.rewards);
  return true;
}

/**
 * The status filter options for a list: `{ key, tier, label, count, gap, on }`
 * (faceted counts: over search, network, device and month), plus the dashed
 * placeholders for sources still being checked (`pending`). Shared by the
 * chip row, the phone filter sheet and the phone "Needs a look" chip.
 */
export function statusOptions({ list, facets, status, loading }) {
  const ctx = list?.ctx ?? {};
  const settled = list?.settled ?? {};
  const counts = facets?.status ?? {};
  const out = [];
  const push = (key, gap) => {
    const on = status === key;
    if (loading && !on) return;
    if (!on && !countReady(key, settled)) return;
    const count = counts[key] ?? 0;
    if (!on && count === 0) return;
    out.push({ key, tier: tierOfFilter(key), label: statusFilterLabel(key, ctx), count, gap: false, on, after: gap });
  };
  for (const k of MAIN) push(k, false);
  for (const k of ACTIVE_ONLY) if (status === k) push(k, false);
  for (const k of AFTER_GAP) push(k, true);
  const firstAfter = out.find((o) => o.after);
  if (firstAfter) firstAfter.gap = true;

  const pending = [];
  if (loading) pending.push("Checking rewards…");
  else if (list) {
    if (!settled.iot && list.counts.iot > 0) pending.push("Checking IoT…");
    if (!settled.mobile && list.counts.wifi > 0) pending.push("Checking heartbeats…");
    else if (!settled.mobile && list.counts.mobileTables > 0) pending.push("Checking Mobile…");
    if (!settled.rewards) pending.push("Checking rewards…");
  }
  return { options: out, pending, all: counts.all ?? null };
}

const CHIP = "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-wd-cap font-medium max-md:h-8";

/** An applied filter as a removable chip ("Onboarded Apr 2025 (UTC) ×"):
 * a button named "Remove filter: …". */
export function RemoveChip({ label, onRemove }) {
  return (
    <button
      type="button"
      aria-label={`Remove filter: ${label}`}
      onClick={onRemove}
      className={`${CHIP} relative border-wd-accent-line bg-accent-surface text-accent-text before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']`}
    >
      {label}
      <span aria-hidden="true">×</span>
    </button>
  );
}

/**
 * The status chip row (desktop and tablet): one wrapping row of
 * single-select chips, each with its tier mark, label and count and named
 * "{label}, {n} Hotspots"; "All" first. A click on the active chip clears
 * it. Placeholders hold the row's place while sources are checked, so the
 * list never shifts. `month` (an onboard month filter from About) shows as a
 * removable chip.
 */
export default function StatusChips({ model, status, onStatus, monthLabel, onClearMonth }) {
  const { options, pending, all } = model;
  return (
    <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-2">
      <Chip
        on={status === "all"}
        count={all ?? undefined}
        ariaLabel={all == null ? "All" : `All, ${plural(all, "Hotspot")}`}
        onClick={() => onStatus("all")}
      >
        All
      </Chip>
      {options.map((o) => (
        <Chip
          key={o.key}
          on={o.on}
          tier={o.tier}
          mark={markOf(o.key)}
          count={o.count}
          ariaLabel={`${o.label}, ${plural(o.count, "Hotspot")}`}
          onClick={() => onStatus(o.on ? "all" : o.key)}
          className={o.gap ? "ml-3.5" : ""}
        >
          {o.label}
        </Chip>
      ))}
      {pending.map((p) => (
        <Chip key={p} pending>
          {p}
        </Chip>
      ))}
      {monthLabel && <RemoveChip label={monthLabel} onRemove={onClearMonth} />}
    </div>
  );
}

