import { forwardRef } from "react";

/**
 * A raised box: `rounded-2xl bg-surface-raised shadow-soft`, never a border,
 * and never `overflow-hidden` (a sticky table header inside must stick).
 * `pad` (default true) gives the design's 20/24/22 px padding, 16 px on
 * phones; `pad={false}` for cards that lay out their own edges (tables).
 * `as` picks the element, `busy` sets `aria-busy` while it loads, and
 * `wdCard` sets the `data-wd-card` hook the landing capture finds cards by.
 */
export const Card = forwardRef(function Card(
  { as: As = "div", pad = true, busy, wdCard, className = "", children, ...rest },
  ref,
) {
  return (
    <As
      ref={ref}
      aria-busy={busy ? true : undefined}
      data-wd-card={wdCard}
      className={`min-w-0 rounded-2xl bg-surface-raised shadow-soft ${pad ? "p-4 md:px-6 md:pb-[22px] md:pt-5" : ""} ${className}`}
      {...rest}
    >
      {children}
    </As>
  );
});

/**
 * A card's header row: an h3 title (Space Grotesk 15/22) on the left, its
 * window or an action (`right`) on the right, wrapping on narrow cards.
 * `as` changes the heading level; `id` names it for `aria-labelledby`.
 */
export function CardHead({ title, right, as: As = "h3", id, className = "" }) {
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 ${className}`}>
      <As id={id} className="m-0 font-display text-wd-title font-semibold text-wd-ink">
        {title}
      </As>
      {right != null && <div className="text-wd-cap text-wd-ink-2">{right}</div>}
    </div>
  );
}

/**
 * The one empty pattern: what is empty and why, in words (`children`), plus
 * an optional `action` (a Btn2 such as "Clear filters" or Retry).
 */
export function Empty({ action, className = "", children }) {
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-10 text-center ${className}`}>
      <p className="m-0 text-sm text-wd-ink">{children}</p>
      {action}
    </div>
  );
}

export default Card;
