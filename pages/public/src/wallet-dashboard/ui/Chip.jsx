import { fmtCount } from "../format.js";
import { NetDot } from "./NetDot.jsx";
import { StatusMark } from "./StatusMark.jsx";
import { TimeAgo } from "./TimeAgo.jsx";

const CHIP = "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-wd-cap font-medium";
const TONE = {
  plain: "border-wd-control bg-surface-raised text-wd-ink-2",
  on: "border-wd-accent-line bg-accent-surface text-accent-text",
  caution: "border-transparent bg-wd-caution-surface text-wd-caution-text",
  critical: "border-transparent bg-wd-critical-surface text-wd-critical-text",
  pending: "border-dashed border-wd-control bg-surface-raised text-wd-ink-3",
};
// A 40 px tall hit area around a 28 px chip, without moving the layout.
const HIT = "relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";

/**
 * A 28 px pill. As a filter (`onClick`) it is a toggle button
 * (`aria-pressed={on}`); give it `ariaLabel` "{label}, {n} Hotspots" so the
 * count is spoken with its noun (a static chip with `ariaLabel` reads that
 * text in place of what it shows). Tones: `on` (selected, accent), `caution`,
 * `critical` (status only, never money); `pending` is the dashed placeholder
 * that reserves a chip's place while its data is checked (hidden from
 * assistive tech: the list's busy state speaks for it). `tier` adds the
 * status mark before the label; `count` follows it (numbers get thousands
 * separators).
 */
export function Chip({ on, pending, caution, critical, count, onClick, ariaLabel, tier, className = "", children }) {
  if (pending) {
    return (
      <span aria-hidden="true" className={`${CHIP} ${TONE.pending} ${className}`}>
        <StatusMark tier="checking" sr={false} />
        {children}
      </span>
    );
  }
  const tone = on ? TONE.on : critical ? TONE.critical : caution ? TONE.caution : TONE.plain;
  const countText = count == null ? null : typeof count === "number" ? fmtCount(count) : count;
  // Without an ariaLabel, a text label and its count are read as "Banned, 2"
  // (flex items would otherwise run together or split oddly).
  const name = ariaLabel ?? (countText != null && typeof children === "string" ? `${children}, ${countText}` : undefined);
  const body = (
    <>
      {tier && <StatusMark tier={tier} sr={false} />}
      {children}
      {countText != null && <b className="font-normal tabular-nums opacity-85">{countText}</b>}
    </>
  );
  if (!onClick) {
    // A plain span can't carry a name (aria-label on it is ignored), so the
    // name is sr-only text and the visible chip is hidden from readers.
    return (
      <span className={`${CHIP} ${tone} ${className}`}>
        {name ? (
          <>
            <span className="sr-only">{name}</span>
            <span aria-hidden="true" className="inline-flex items-center gap-1.5">
              {body}
            </span>
          </>
        ) : (
          body
        )}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={Boolean(on)}
      aria-label={name}
      onClick={onClick}
      className={`${CHIP} ${HIT} ${tone} transition-colors ${on ? "" : "hover:border-wd-ink-2"} ${className}`}
    >
      {body}
    </button>
  );
}

const NET = {
  iot: { label: "IoT", cls: "bg-wd-iot-soft text-wd-iot-text" },
  mobile: { label: "Mobile", cls: "bg-wd-mobile-soft text-wd-mobile-text" },
};

/** A network's name chip ("● IoT", "● Mobile"): network identity color only. */
export function NetChip({ net, className = "", children }) {
  const n = NET[net];
  if (!n) return null;
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-2 text-[11px] font-semibold leading-5 ${n.cls} ${className}`}
    >
      <NetDot net={net} />
      {children ?? n.label}
    </span>
  );
}

// States whose dot pulses while a check runs.
const PULSING = new Set(["checking", "saved", "updating"]);

/**
 * The Mobile freshness chip, read from `mobileFreshness()` (never re-derived):
 * a live dot (`.wd-live` + its `dotClass`: accent when live, amber pulsing
 * while checking or updating, gray while paused, rose when a check failed)
 * and its words: "Live · checked 1m ago", "Updating · checked 1m ago",
 * "Paused while hidden · checked 1m ago" (`showChecked`: the time ticks via
 * TimeAgo and is visually hidden on phones, kept for screen readers), else
 * its `line` ("Checking", "Saved from 3:42 PM, checking", "Couldn't check ·
 * data from 7:42 PM"). Nothing for a fleet without Mobile Hotspots. `ping`
 * (an arrival seq) replays a one-shot ping on the dot; none under reduced
 * motion.
 */
export function LiveChip({ freshness, ping = 0, className = "" }) {
  if (!freshness || freshness.state === "none" || !freshness.word) return null;
  const { state, word, line, showChecked, checkedAt, dotClass } = freshness;
  return (
    <span className={`${CHIP} ${TONE.plain} ${className}`}>
      {/* Re-keyed per arrival so `.ping` replays once (motion-safe in the CSS). */}
      <span
        key={ping}
        aria-hidden="true"
        className={`wd-live ${dotClass ?? ""} ${PULSING.has(state) ? "pulse" : ""} ${ping > 0 ? "ping" : ""}`}
      />
      {showChecked && checkedAt ? (
        <span>
          {word}
          <span className="sr-only md:not-sr-only">
            {" "}
            · checked <TimeAgo at={checkedAt} fallback="Unknown" />
          </span>
        </span>
      ) : (
        <span>{line ?? word}</span>
      )}
    </span>
  );
}

/** A small mono tag ("legacy", "2 spellings", "+2 more"); `caution` for a warning tag. */
export function Tag({ caution, className = "", children }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-[5px] font-mono text-[10px] font-medium leading-4 tracking-[0.06em] ${
        caution ? "border-wd-caution text-wd-caution-text" : "border-wd-control text-wd-ink-2"
      } ${className}`}
    >
      {children}
    </span>
  );
}

export default Chip;
