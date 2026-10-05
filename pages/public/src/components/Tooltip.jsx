import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

// Closest a tooltip may sit to the viewport's left/right edge.
const VIEWPORT_MARGIN = 8;

/**
 * Hover/focus tooltip styled to match the app. Drop-in replacement for the
 * native `title` attribute when you need multi-line content, consistent
 * styling, or anything a browser tooltip can't render.
 *
 * The tooltip body is portaled to document.body on show, so it escapes
 * ancestor `overflow: hidden` / `overflow: auto` clipping (e.g., inside a
 * rounded card or a horizontally-scrolling table). Position is computed
 * from the trigger's viewport rect at show time and re-tracked on scroll
 * and resize while visible. It centers on the trigger, shifted sideways just
 * enough to stay inside the viewport when the trigger is near an edge.
 *
 * Usage:
 *   <Tooltip content="Copy to clipboard"><button>...</button></Tooltip>
 *   <Tooltip content={`Line 1\nLine 2`} placement="bottom"><span>hover me</span></Tooltip>
 *
 * Empty/null content makes this a no-op so callers can pass conditional
 * content without defensive wrappers.
 *
 * `wrapperClassName` replaces the default `inline-flex` on the trigger
 * wrapper. Override it when the trigger needs to fill its parent (e.g.,
 * wrapping a `<MiddleEllipsis>` that needs a measurable width to truncate
 * against, where `block min-w-0` or `flex-1 min-w-0` is appropriate).
 */
export default function Tooltip({
  content,
  placement = "top",
  className = "",
  wrapperClassName = "inline-flex",
  children,
}) {
  const id = useId();
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState(null);
  // Horizontal correction (px) that keeps the centered tooltip on screen.
  const [shift, setShift] = useState(0);

  const computeCoords = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({
      cx: rect.left + rect.width / 2,
      top: rect.top,
      bottom: rect.bottom,
    });
  }, []);

  const show = useCallback(() => {
    computeCoords();
    setVisible(true);
  }, [computeCoords]);
  const hide = useCallback(() => setVisible(false), []);

  useLayoutEffect(() => {
    if (!visible) return;
    computeCoords();
    const onScroll = () => computeCoords();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [visible, computeCoords]);

  // Measure after layout, before paint. offsetWidth ignores transforms, so the
  // shift depends only on the trigger's center and the tooltip's width.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!visible || !coords || !el) return;
    const width = el.offsetWidth;
    const natural = coords.cx - width / 2;
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - width);
    const clamped = Math.min(Math.max(natural, VIEWPORT_MARGIN), maxLeft);
    setShift(clamped - natural);
  }, [visible, coords, content]);

  if (content == null || content === "") return children;

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

  const positionStyle =
    visible && coords
      ? placement === "bottom"
        ? { left: coords.cx, top: coords.bottom + 6, transform: `translateX(calc(-50% + ${shift}px))` }
        : { left: coords.cx, top: coords.top - 6, transform: `translate(calc(-50% + ${shift}px), -100%)` }
      : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={wrapperClassName}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {trigger}
      </span>
      {visible && coords &&
        createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            id={id}
            style={{ position: "fixed", ...positionStyle }}
            className={`pointer-events-none z-[1000] w-max max-w-[min(20rem,90vw)] whitespace-pre-line rounded-md bg-surface-raised px-2.5 py-1.5 text-xs leading-relaxed text-content shadow-soft ${className}`}
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  );
}
