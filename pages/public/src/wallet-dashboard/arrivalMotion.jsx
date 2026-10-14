// Arrival motion for live Mobile data: what moved at the latest live arrival,
// a count-up for numbers, and a one-shot flash. Only live arrivals animate
// (`arrivals.seq` increments, see mobile/engine.js): the first load, a cached
// paint, a remount and the sliding windows' re-assembles never do. JS motion
// honors reduced motion via useReducedMotion; the CSS flashes use `motion-safe:`.
import { useLayoutEffect, useRef, useState } from "react";
import useReducedMotion from "../lib/useReducedMotion.js";
import { MOBILE_ISSUE_ORDER } from "./mobileFormat.js";

const COUNT_UP_MS = 800;

// The table whose new rows can move each issue.
const ISSUE_TABLE = {
  banned: "bans",
  noHeartbeat: "heartbeats",
  lowTrust: "heartbeats",
  lowSpeedtest: "speedtests",
  rejectedHeartbeats: "invalidHeartbeats",
};

/**
 * What the latest live arrivals touched, as flash keys: each is the
 * `arrivals.seq` that last touched it (absent = nothing since mount), so a
 * keyed element restarts its animation exactly once per arrival.
 *   tables  { [table]: seq } tables that brought new rows
 *   issues  { [issue]: seq } issue rows whose count changed, or that gained a
 *           Hotspot with new rows from the issue's table
 *   any     seq of the latest arrival (0 = none)
 * Arrivals already in place at mount are the baseline, not news. Mount it
 * keyed by wallet: `seq` restarts at 0 for each wallet.
 */
export function useArrivalFlashes(arrivals, mobile) {
  const ref = useRef(null);
  if (ref.current === null) {
    ref.current = { seen: arrivals.seq, counts: mobile.counts, flashes: { tables: {}, issues: {}, any: 0 } };
  }
  const r = ref.current;
  // Idempotent per (seq, counts), so a repeated render is harmless.
  if (arrivals.seq > r.seen) {
    const seq = arrivals.seq;
    const tables = { ...r.flashes.tables };
    for (const t of Object.keys(arrivals.byTable)) tables[t] = seq;
    const issues = { ...r.flashes.issues };
    for (const issue of MOBILE_ISSUE_ORDER) {
      const keys = arrivals.byTable[ISSUE_TABLE[issue]];
      let touched = mobile.counts[issue] !== r.counts[issue];
      if (!touched && keys?.length) {
        const fresh = new Set(keys);
        touched = mobile.groups[issue].some(({ hotspot }) => fresh.has(hotspot.entityKey));
      }
      if (touched) issues[issue] = seq;
    }
    ref.current = { seen: seq, counts: mobile.counts, flashes: { tables, issues, any: seq } };
  } else {
    // Between arrivals, track the counts an arrival will be compared to.
    r.seen = arrivals.seq;
    r.counts = mobile.counts;
  }
  // An issue row that's off screen (count 0) keeps no key: when a window
  // slide brings it back, it mounts still; only an arrival flashes it.
  const f = ref.current.flashes;
  let issues = f.issues;
  for (const k of MOBILE_ISSUE_ORDER) {
    if (issues[k] && !(mobile.counts[k] > 0)) {
      if (issues === f.issues) issues = { ...issues };
      delete issues[k];
    }
  }
  if (issues !== f.issues) ref.current.flashes = { ...f, issues };
  return ref.current.flashes;
}

/**
 * `value`, counting up (or down) from its previous value over ~800 ms when
 * `trigger` changes along with it. Any other change snaps. Null and
 * non-finite values never animate.
 */
export function useCountUp(value, trigger) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(null);
  const prev = useRef({ value, trigger });

  // Layout effect: the first frame paints the old value, never a flash of
  // the new one.
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { value, trigger };
    if (
      reduced ||
      trigger === before.trigger ||
      !Number.isFinite(before.value) ||
      !Number.isFinite(value) ||
      before.value === value
    ) {
      setFrame(null);
      return undefined;
    }
    const from = before.value;
    const start = performance.now();
    let raf = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      if (t >= 1) {
        setFrame(null);
        return;
      }
      setFrame(from + (value - from) * (1 - (1 - t) ** 3));
      raf = requestAnimationFrame(step);
    };
    setFrame(from);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, trigger, reduced]);

  return frame ?? value;
}

/** A number that counts up on arrival; `format` renders each frame. */
export function CountUp({ value, trigger, format }) {
  return format(useCountUp(value, trigger));
}

/**
 * A one-shot accent wash over its `relative` parent, replayed whenever
 * `flashKey` changes (0/absent: none). The parent stays mounted, so focus
 * and hover survive the replay.
 */
export function ArrivalFlash({ flashKey }) {
  if (!flashKey) return null;
  return (
    <span
      key={flashKey}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] motion-safe:animate-pulse-once"
    />
  );
}
