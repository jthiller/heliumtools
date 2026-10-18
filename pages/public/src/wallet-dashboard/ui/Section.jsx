import { forwardRef } from "react";

/**
 * A page section: `<section id aria-labelledby>` with its h2 (`title`), a
 * scope caption beside it (the window its numbers cover) and a right-aligned
 * slot (`right`, e.g. "Open full map"). `busy` sets `aria-busy` while the
 * section's data loads. `anchor` makes the h2 a focus target below the sticky
 * app bar (`tabIndex -1` + `data-wd-anchor`, for "View in list" and the skip
 * link); `headingRef` reaches it. Other props (e.g. `data-wd-section`) land on
 * the section.
 */
export const Section = forwardRef(function Section(
  { id, title, caption, right, busy, anchor, headingRef, className = "", children, ...rest },
  ref,
) {
  const headingId = `${id}-title`;
  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={headingId}
      aria-busy={busy ? true : undefined}
      className={`min-w-0 ${className}`}
      {...rest}
    >
      <div className="mb-3.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
        <h2
          ref={headingRef}
          id={headingId}
          tabIndex={anchor ? -1 : undefined}
          data-wd-anchor={anchor ? "" : undefined}
          className="m-0 font-display text-wd-h2-sm font-semibold text-wd-ink md:text-wd-h2"
        >
          {title}
        </h2>
        {caption && <p className="m-0 text-wd-cap text-wd-ink-2">{caption}</p>}
        {right && <div className="ml-auto flex items-baseline gap-3">{right}</div>}
      </div>
      {children}
    </section>
  );
});

export default Section;
