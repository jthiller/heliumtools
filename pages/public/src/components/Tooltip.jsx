import { useId } from "react";

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
 * ReactNode for structured content. When `content` is empty/null the tooltip
 * is skipped entirely so callers can pass conditional content without
 * defensive wrappers.
 *
 * Accessibility: callers should ensure the trigger has an accessible name
 * (visible text, `aria-label`, etc.); this component doesn't replace that.
 *
 * Limitation: the wrapper is `position: relative`, so an absolutely-positioned
 * child will anchor to the Tooltip instead of the intended ancestor. In that
 * case, keep the native `title` attribute.
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

  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-xs -translate-x-1/2 whitespace-pre-line rounded-md border border-border-muted bg-surface-raised px-2.5 py-1.5 text-xs leading-relaxed text-content opacity-0 shadow-soft transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${positionClasses} ${className}`}
      >
        {content}
      </span>
    </span>
  );
}
