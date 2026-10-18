import { fmtClock } from "../mobileFormat.js";
import { InfoTip } from "./InfoTip.jsx";
import { Pending } from "./Pending.jsx";

// Space Grotesk, proportional figures (standalone stats aren't columns).
const SIZE = {
  xl: "text-wd-xl-sm font-bold md:text-wd-xl",
  l: "text-wd-l font-semibold",
  m: "text-wd-m font-semibold",
  s: "text-wd-s font-semibold tracking-[-0.02em]",
};

// "As of 3:42 PM": a ms time is worded like every other clock on the page
// (fmtClock); text is either the whole phrase (mobileFreshness().asOf) or the time.
function asOfLine(asOf) {
  if (asOf == null || asOf === "") return null;
  if (typeof asOf === "number") return `As of ${fmtClock(asOf)}`;
  return /^as of\b/i.test(asOf) ? asOf : `As of ${asOf}`;
}

/**
 * One figure: `value` (a string or node, e.g. a CountUp) in Space Grotesk at
 * `size` xl (52, the money band's lead) / l (32) / m (24) / s (18), with its
 * `unit` at half size ("HNT"). `sofar` adds the dashed "so far" tag while a
 * scan is partial; `asOf` adds "As of 3:42 PM" when the figure is the saved
 * paint (pass `freshness.asOf` as is, a ms time, or a time string). Optional
 * `label` (eyebrow) with an InfoTip (`tip`, named by `tipLabel`), and `sub`
 * (the window line under it). `pending` shows the spoken "…" in place of the
 * value.
 */
export function Stat({ value, unit, size = "m", sofar, asOf, label, tip, tipLabel, sub, pending, className = "" }) {
  const asOfText = asOfLine(asOf);
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      {label && (
        <div className="flex min-h-6 items-center gap-1.5">
          <span className="font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-3">{label}</span>
          {tip && <InfoTip label={tipLabel ?? label}>{tip}</InfoTip>}
        </div>
      )}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={`whitespace-nowrap font-display text-wd-ink ${SIZE[size] ?? SIZE.m}`}>
          {pending ? <Pending className="text-wd-ink-3" /> : value}
          {unit && !pending && (
            <span className="ml-[0.22em] text-[0.5em] font-semibold tracking-normal text-wd-ink-3">{unit}</span>
          )}
        </span>
        {sofar && (
          <span className="whitespace-nowrap rounded border border-dashed border-wd-control px-1.5 font-mono text-[11px] font-medium leading-[18px] tracking-[0.04em] text-wd-ink-2">
            so far
          </span>
        )}
        {asOfText && <span className="whitespace-nowrap text-wd-cap text-wd-ink-2">{asOfText}</span>}
      </div>
      {sub != null && <div className="text-wd-sm text-wd-ink-2">{sub}</div>}
    </div>
  );
}

export default Stat;
