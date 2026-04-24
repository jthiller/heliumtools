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

/**
 * Hover/focus tooltip styled to match the app. Drop-in replacement for the
 * native `title` attribute when you need multi-line content, consistent
 * styling, or anything a browser tooltip can't render.
 *
 * The tooltip body is portaled to document.body on show, so it escapes
 * ancestor `overflow: hidden` / `overflow: auto` clipping (e.g., inside a
 * rounded card or a horizontally-scrolling table). Position is computed
 * from the trigger's viewport rect at show time and re-tracked on scroll
 * and resize while visible.
 *
 * Usage:
 *   <Tooltip content="Copy to clipboard"><button>...</button></Tooltip>
 *   <Tooltip content={`Line 1\nLine 2`} placement="bottom"><span>hover me</span></Tooltip>
 *
 * Empty/null content makes this a no-op so callers can pass conditional
 * content without defensive wrappers.
 */
export default function Tooltip({
  content,
  placement = "top",
  className = "",
  children,
}) {
  const id = useId();
  const triggerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState(null);

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
        ? { left: coords.cx, top: coords.bottom + 6, transform: "translateX(-50%)" }
        : { left: coords.cx, top: coords.top - 6, transform: "translate(-50%, -100%)" }
      : null;

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
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
            role="tooltip"
            id={id}
            style={{ position: "fixed", ...positionStyle }}
            className={`pointer-events-none z-[1000] w-max max-w-[min(20rem,90vw)] whitespace-pre-line rounded-md border border-border-muted bg-surface-raised px-2.5 py-1.5 text-xs leading-relaxed text-content shadow-soft ${className}`}
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  );
}
