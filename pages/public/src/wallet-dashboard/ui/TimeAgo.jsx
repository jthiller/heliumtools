import { useSyncExternalStore } from "react";
import { fmtAgo } from "../format.js";
import { minuteTick, subscribeMinute } from "./clock.js";

function Ago({ ms, className }) {
  // Subscribing re-renders this element each minute; fmtAgo reads the time.
  useSyncExternalStore(subscribeMinute, minuteTick, minuteTick);
  return (
    <time dateTime={new Date(ms).toISOString()} className={`tabular-nums ${className}`}>
      {fmtAgo(ms)}
    </time>
  );
}

/**
 * "4m ago" for a ms timestamp (`fmtAgo`), re-rendering only itself on the
 * shared minute tick (`clock.js`), so a list of hundreds keeps one interval.
 * `fallback` is required and is a word ("Unknown", "Not reported"), shown when
 * `at` is absent or not a time; never a dash. A fallback doesn't subscribe to
 * the tick.
 */
export function TimeAgo({ at, fallback, className = "" }) {
  const ms = at ? new Date(at).getTime() : NaN;
  if (!Number.isFinite(ms)) return fallback ?? null;
  return <Ago ms={ms} className={className} />;
}

export default TimeAgo;
