import { TIERS } from "../statusRegistry.js";
import { StatusMark } from "../ui/StatusMark.jsx";
import { TimeAgo } from "../ui/TimeAgo.jsx";
import { ArrivalFlash } from "../ui/ArrivalFlash.jsx";

/** A state's label as a row shows it: "Heartbeat 15m ago" ticks on the
 * shared minute clock; every other state is its registry label. */
export function StateLabel({ state }) {
  if (state.key === "heartbeatOk" && state.label === "Heartbeat") {
    return (
      <>
        Heartbeat <TimeAgo at={state.at} fallback="received" />
      </>
    );
  }
  return state.label;
}

/** The mark's shape for a state: "Couldn't check" is an x ring (JUDGE 5), as
 * the detail and Health draw it; every other state its tier's shape. */
export const markOf = (key) => (key === "iotFailed" || key === "mobileFailed" ? "x" : undefined);

const withWindow = (state) => `${state.label}${state.window ? `, ${state.window}` : ""}`;

/** "Also: No heartbeat, last 60 min" for a row's second state (or several). */
export function alsoText(...states) {
  return `Also: ${states.map(withWindow).join("; ")}`;
}

/**
 * The list's Status cell (JUDGE 5): the top state's mark (shape and color,
 * with its sr-only tier word), label in the tier's tone, a "+N more" tag
 * when three or more states apply; then its window line(s), "Also: {second
 * state}, {window}", a dual-network row's "Mobile: No status reported", and
 * the rest of the states for screen readers. `flashKey` washes the cell once
 * on a live Mobile arrival (motion-safe; the list passes it only for fleets
 * of 200 or fewer).
 */
export default function StatusCell({ row, flashKey }) {
  const [top, second] = row.states;
  const tier = TIERS[top.tier] ?? TIERS.unknown;
  const more = row.states.length > 2 ? row.states.length - 2 : 0;
  return (
    <div className="relative -m-1 rounded-md p-1">
      <ArrivalFlash flashKey={flashKey} />
      <span className="flex items-center gap-1.5 text-wd-sm font-semibold">
        <StatusMark tier={top.tier} mark={markOf(top.key)} className="ml-px" />
        <span className={tier.textClass}>
          <StateLabel state={top} />
        </span>
        {more > 0 && (
          <span
            aria-hidden="true"
            className="whitespace-nowrap rounded-full border border-wd-control px-1.5 text-[11px] font-medium leading-4 text-wd-ink-2"
          >
            +{more} more
          </span>
        )}
      </span>
      {top.window && <span className="ml-[19px] block text-wd-cap text-wd-ink-2">{top.window}</span>}
      {top.window2 && <span className="ml-[19px] block text-wd-cap text-wd-ink-2">{top.window2}</span>}
      {second && (
        <span className="ml-[19px] mt-[3px] block text-wd-cap text-wd-ink-2">
          Also: <StateLabel state={second} />
          {second.window ? `, ${second.window}` : ""}
        </span>
      )}
      {row.netLine && <span className="ml-[19px] mt-[3px] block text-wd-cap text-wd-ink-2">{row.netLine}</span>}
      {more > 0 && <span className="sr-only">{alsoText(...row.states.slice(2))}</span>}
    </div>
  );
}
