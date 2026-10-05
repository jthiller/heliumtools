import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { classNames } from "../../lib/utils.js";

/** Small outlined action button (table actions, Retry). */
export const ACTION_BTN =
  "inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-content-secondary transition hover:border-content-tertiary";

/** Shared class for the icon-prefixed search / address inputs. */
export const SEARCH_INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface-inset py-2 pl-9 pr-3 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

/** Bento tile shell: rounded card with an optional title row and action slot. */
export function Card({ title, subtitle, action, className = "", bodyClassName = "", children }) {
  return (
    <section
      className={classNames(
        "flex flex-col rounded-2xl bg-surface-raised shadow-soft overflow-hidden",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && (
              <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-content">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-content-tertiary">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={classNames("flex-1 px-5 pb-5", !title && "pt-5", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** A labeled stat: caption + large value + optional sub-line. */
export function Stat({ label, value, sub, valueClass = "text-content" }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </div>
      <div className={classNames("mt-1 font-display text-2xl font-semibold tabular-nums", valueClass)}>
        {value}
      </div>
      {sub != null && <div className="mt-0.5 text-xs text-content-tertiary">{sub}</div>}
    </div>
  );
}

/** Shimmer placeholder. */
export function Skeleton({ className = "" }) {
  return <div className={classNames("animate-pulse rounded-md bg-surface-inset", className)} />;
}

/** A labeled horizontal distribution bar. */
export function DistroBar({ label, count, total, color, suffix }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="truncate text-content-secondary">{label}</span>
        <span className="ml-2 shrink-0 tabular-nums text-content-tertiary">
          {count}
          {suffix}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-inset">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color || "rgb(var(--color-accent))" }}
        />
      </div>
    </div>
  );
}

/** Indeterminate-friendly progress bar (done / total). */
export function ProgressBar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
      <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Small colored dot (network/token legend). */
export function Dot({ color, className = "" }) {
  return (
    <span
      className={classNames("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ background: color }}
    />
  );
}

/** Pill badge. */
export function Badge({ children, tone = "default" }) {
  const tones = {
    default: "border-border text-content-secondary",
    accent: "border-accent/30 bg-accent-surface text-accent-text",
    warn: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300",
    ok: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone] || tones.default,
      )}
    >
      {children}
    </span>
  );
}


const CALLOUT_TONES = {
  warn: {
    box: "bg-rose-50 dark:bg-rose-950/30",
    head: "text-rose-700 dark:text-rose-300/80",
    text: "text-rose-700 dark:text-rose-300",
  },
  caution: {
    box: "bg-amber-50 dark:bg-amber-950/30",
    head: "text-amber-700 dark:text-amber-300/80",
    text: "text-amber-700 dark:text-amber-300",
  },
  default: { box: "bg-surface-inset", head: "text-content-tertiary", text: "text-content-secondary" },
};

/** Callout listing the first few Hotspot names with an "and N more" overflow.
 * `tone`: "warn" (rose) | "caution" (amber) | default (neutral). `total` (when
 * `names` is already just the first few) sizes the overflow. */
export function NameCallout({ title, names, tone, total = names.length }) {
  const styles = CALLOUT_TONES[tone] || CALLOUT_TONES.default;
  return (
    <div className={classNames("mt-3 rounded-lg p-3", styles.box)}>
      <div className={classNames("mb-1 text-[11px] font-medium uppercase tracking-wide", styles.head)}>
        {title}
      </div>
      <div className={classNames("text-xs", styles.text)}>
        {names.slice(0, 4).join(", ")}
        {total > 4 && ` and ${total - 4} more`}
      </div>
    </div>
  );
}

/**
 * Info glyph that explains the label beside it. A real button, so the text is
 * reachable by every input: hover or keyboard focus shows it, and a click/tap
 * toggles it (iOS doesn't focus a tapped button, so focus alone isn't enough).
 * Closes on blur, Escape, or a tap elsewhere. The bubble is portaled to <body>
 * so card/table overflow can't clip it; screen readers get the text as the
 * button's description.
 */
// Viewport px an InfoTip needs above its glyph (a few lines of bubble plus a
// sticky page header) before it opens below instead.
const TIP_ROOM_ABOVE = 180;

export function InfoTip({ text, label = "More info" }) {
  const id = useId();
  const ref = useRef(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);
  const open = hover || pinned;

  const place = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const half = Math.min(160, window.innerWidth / 2 - 8); // ≤ 20rem bubble
    // Above the glyph, unless that would run under a sticky page header or
    // off the top: then below it.
    const below = r.top < TIP_ROOM_ABOVE;
    setPos({
      x: Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8),
      y: below ? r.bottom + 6 : r.top - 6,
      below,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!pinned) return;
    const away = (e) => !ref.current?.contains(e.target) && setPinned(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setPinned((p) => !p)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => {
          setHover(false);
          setPinned(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setHover(false);
            setPinned(false);
          }
        }}
        className="inline-flex shrink-0 rounded-full align-[-2px] text-content-tertiary transition hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
      >
        <InformationCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {/* Always in the DOM (hidden when closed) so aria-describedby resolves. */}
      {open && pos ? (
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform: pos.below ? "translateX(-50%)" : "translate(-50%, -100%)",
            }}
            className="pointer-events-none z-[1000] w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-md bg-surface-raised px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-content shadow-soft-lg"
          >
            {text}
          </span>,
          document.body,
        )
      ) : (
        <span id={id} hidden>
          {text}
        </span>
      )}
    </>
  );
}

/** Centered empty/placeholder text for a card body. */
export function CardEmpty({ children }) {
  return (
    <div className="flex h-full min-h-[80px] items-center justify-center text-center text-sm text-content-tertiary">
      {children}
    </div>
  );
}
