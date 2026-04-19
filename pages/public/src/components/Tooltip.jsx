import { Children, cloneElement, isValidElement, useId } from "react";

/**
 * Hover/focus tooltip styled to match the app. Drop-in replacement for the
 * native `title` attribute when you need multi-line content, consistent
 * styling, or anything a browser tooltip can't render.
 *
 * Usage:
 *   <Tooltip content="Copy to clipboard">
 *     <button>...</button>
 *   </Tooltip>
 *
 *   <Tooltip content={`Line 1\nLine 2`} placement="bottom">
 *     <span>hover me</span>
 *   </Tooltip>
 *
 * Strings render with `\n`-preserving layout (`whitespace-pre-line`). Pass a
 * ReactNode for structured content. Empty/null content makes this a no-op so
 * callers can pass conditional content without defensive wrappers.
 *
 * Accessibility: when the child is a single React element the tooltip
 * injects `aria-describedby` on it, and — for string content — falls back
 * to `aria-label` if the trigger doesn't already have one. This matches
 * the accessible-name role the native `title` attribute used to play for
 * icon-only triggers.
 *
 * Limitation: the wrapper is `position: relative`, so an absolutely-
 * positioned child will anchor to the Tooltip instead of the intended
 * ancestor. In that case keep the native `title` attribute.
 */
export default function Tooltip({
  content,
  placement = "top",
  className = "",
  children,
}) {
  const id = useId();
  if (content == null || content === "") return children;

  const positionClasses =
    placement === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5";

  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const trigger =
    only && isValidElement(only)
      ? cloneElement(only, {
          "aria-describedby": id,
          ...(typeof content === "string" && only.props["aria-label"] == null
            ? { "aria-label": content }
            : null),
        })
      : children;

  return (
    <span className="group/tooltip relative inline-flex">
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-[min(20rem,90vw)] -translate-x-1/2 whitespace-pre-line rounded-md border border-border-muted bg-surface-raised px-2.5 py-1.5 text-xs leading-relaxed text-content opacity-0 shadow-soft transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${positionClasses} ${className}`}
      >
        {content}
      </span>
    </span>
  );
}
