/**
 * A native `<details>` with the design's chevron (right when closed, down
 * when open) in place of the browser marker: "Legacy tokens", "Details",
 * the map legend on phones. `summary` is the always-visible line; the
 * summary is 24 px tall, 44 px on phones. Uncontrolled unless `open` and
 * `onToggle` are passed; re-key it to reset (e.g. per Hotspot).
 */
export function Disclosure({ summary, open, onToggle, className = "", summaryClassName = "", children }) {
  return (
    <details
      open={open}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
      className={`group/disclosure text-wd-sm text-wd-ink-2 ${className}`}
    >
      <summary
        className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-wd-ink-2 md:min-h-6 [&::-webkit-details-marker]:hidden ${summaryClassName}`}
      >
        <span
          aria-hidden="true"
          className="h-[5px] w-[5px] shrink-0 -rotate-45 border-b-[1.5px] border-r-[1.5px] border-current motion-safe:transition-transform group-open/disclosure:rotate-45"
        />
        {summary}
      </summary>
      {children}
    </details>
  );
}

export default Disclosure;
