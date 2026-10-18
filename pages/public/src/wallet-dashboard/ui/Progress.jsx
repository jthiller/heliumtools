/**
 * A scan's progress bar: `role="progressbar"` named by `label` ("Checking
 * Hotspot rewards"), `now` of `max` done, with `valueText` (e.g. "Checking
 * 150 of 1,659 Hotspots…") read in place of the bare numbers when given. The
 * fill is accent text color (a data mark, legible in dark) and eases only
 * under no-preference motion. `size` is the track height in px (6 or 4).
 */
export function Progress({ label, now, max, valueText, size = 6, className = "" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (now / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
      aria-valuetext={valueText}
      className={`w-full overflow-hidden rounded-full bg-wd-well ${className}`}
      style={{ height: size }}
    >
      <span
        className="block h-full rounded-full bg-accent-text motion-safe:transition-[width] motion-safe:duration-300"
        style={{ width: `${pct.toFixed(1)}%` }}
      />
    </div>
  );
}

export default Progress;
