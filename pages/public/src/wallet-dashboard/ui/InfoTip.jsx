import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePortalNode } from "./PortalTarget.jsx";

// Viewport px kept clear above a bubble: the sticky app bar plus a margin. A
// bubble that won't fit above its glyph opens below it.
const TOP_CLEAR = 72;
const EDGE = 8;
const GAP = 6;
// Grace for the pointer to cross the gap from the glyph onto the bubble.
const LEAVE_MS = 150;

/**
 * The 16 px "i" ring that explains the label beside it. A real button named
 * "About {label}" (pass the subject, or a full "About …" name), with the text
 * (`children`) as its description, so every input reaches it: mouse hover or
 * keyboard focus shows it, a click or tap pins it (iOS doesn't focus a tapped
 * button) and a second one closes it, and blur, Escape or a tap elsewhere
 * closes it. The pointer can move onto the bubble without closing it, and
 * Escape closes it however it opened; Escape is consumed while it's open, so
 * an enclosing dialog stays open. The bubble portals to the nearest
 * PortalTarget (an open `<dialog>`), else <body>, so neither card overflow
 * nor the top layer hides it; it opens above the glyph, or below when the app
 * bar would cover it, clamped to the viewport. The hit area is 24 px, 44 px
 * on phones.
 */
export function InfoTip({ label, children, text, className = "" }) {
  const content = children ?? text;
  const name = !label ? "More info" : /^about\b/i.test(label) ? label : `About ${label}`;
  const id = useId();
  const btnRef = useRef(null);
  const bubbleRef = useRef(null);
  const leaveTimer = useRef(0);
  const inBubble = useRef(false); // a press in the bubble blurs the glyph but keeps a pinned tip
  const portalNode = usePortalNode();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);
  const open = hovered || focused || pinned;

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    const b = bubbleRef.current;
    if (!r || !b) return;
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    // Clamp to the viewport, and to the dialog the bubble lives in (a
    // transformed dialog clips what it contains).
    let minX = EDGE;
    let maxX = window.innerWidth - EDGE;
    if (portalNode && portalNode !== document.body) {
      const box = portalNode.getBoundingClientRect();
      minX = Math.max(minX, box.left + EDGE);
      maxX = Math.min(maxX, box.right - EDGE);
    }
    const x = Math.min(Math.max(r.left + r.width / 2 - bw / 2, minX), Math.max(minX, maxX - bw));
    const below = r.top - GAP - bh < TOP_CLEAR;
    const y = below ? r.bottom + GAP : r.top - GAP - bh;
    // `position: fixed` is relative to the viewport unless an ancestor (a
    // dialog mid-transform) is the containing block: measure the offset.
    const now = b.getBoundingClientRect();
    const offX = now.left - (parseFloat(b.style.left) || 0);
    const offY = now.top - (parseFloat(b.style.top) || 0);
    setPos({ left: Math.round(x - offX), top: Math.round(y - offY) });
  }, [portalNode]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!pinned) return undefined;
    const away = (e) => {
      if (btnRef.current?.contains(e.target) || bubbleRef.current?.contains(e.target)) return;
      setPinned(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);

  const close = useCallback(() => {
    clearTimeout(leaveTimer.current);
    setHovered(false);
    setFocused(false);
    setPinned(false);
  }, []);

  // Escape dismisses an open tip wherever focus is (it may be open from a
  // hover alone), before anything else hears the key.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const enter = (e) => {
    if (e.pointerType !== "mouse") return; // touch opens by tap (click) only
    clearTimeout(leaveTimer.current);
    setHovered(true);
  };
  const leave = (e) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setHovered(false), LEAVE_MS);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={name}
        aria-describedby={id}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation(); // a tip inside a clickable row never opens the row
          if (pinned) close();
          else setPinned(true);
        }}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // A pointer resting on the glyph or bubble keeps it (hover rules),
          // and a press inside the bubble keeps it pinned.
          setFocused(false);
          if (!inBubble.current) setPinned(false);
        }}
        className={`relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.3px] p-0 align-[-3px] text-[10px] font-semibold not-italic leading-[13px] transition-colors before:absolute before:-inset-1 before:content-[''] max-md:before:-inset-3.5 ${
          open ? "border-accent-text text-accent-text" : "border-wd-ink-3 text-wd-ink-3 hover:border-wd-ink-2 hover:text-wd-ink-2"
        } ${className}`}
      >
        <span aria-hidden="true">i</span>
      </button>
      {/* The description always exists (hidden when closed) so aria-describedby resolves. */}
      {open && portalNode ? (
        createPortal(
          <span
            ref={bubbleRef}
            id={id}
            role="tooltip"
            onPointerEnter={enter}
            onPointerLeave={leave}
            onPointerDown={() => {
              // The glyph's blur runs in this same input task; clear after it.
              inBubble.current = true;
              setTimeout(() => {
                inBubble.current = false;
              }, 0);
            }}
            // Portaled, but React still bubbles its events to the tip's
            // ancestors: a click in the bubble never opens a clickable row.
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="z-[1000] block w-max max-w-[min(280px,calc(100vw-16px))] whitespace-normal rounded-lg bg-surface-raised px-3 py-2.5 text-left text-xs font-normal normal-case leading-[17px] tracking-normal text-wd-ink-2 shadow-soft-lg"
          >
            {content}
          </span>,
          portalNode,
        )
      ) : (
        <span id={id} hidden>
          {content}
        </span>
      )}
    </>
  );
}

export default InfoTip;
