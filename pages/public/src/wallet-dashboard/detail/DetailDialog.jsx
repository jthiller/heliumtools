import { useCallback, useEffect, useRef, useState } from "react";
import { PortalTarget } from "../ui/PortalTarget.jsx";
import { DETAIL_TITLE_ID } from "./parts.jsx";

/**
 * The detail as a native modal <dialog> (`showModal`): "drawer" (768 to
 * 1279, 440 px from the right, over a scrim) or "fullscreen" (below 768; the
 * page behind it is locked by the stylesheet). Escape (the dialog's
 * `cancel`) and a click on the drawer's scrim call `onClose`; the shell then
 * closes it through history and returns focus to the row. On open, focus
 * goes to the detail's heading. Its body is a PortalTarget, so InfoTip
 * bubbles render inside the modal (the top layer would hide them on <body>).
 * The detail inside is mounted only while it's open, so its mini map's
 * WebGL context is released on close.
 *
 * Props: open, mode ("drawer"|"fullscreen"), regionRef (the dialog: focus
 * inside it counts as inside the detail), onClose, children (the
 * HotspotDetail).
 */
export default function DetailDialog({ open, mode, regionRef, onClose, children }) {
  const ref = useRef(null);
  const [node, setNode] = useState(null);
  const setRef = useCallback(
    (el) => {
      ref.current = el;
      if (regionRef) regionRef.current = el;
      setNode(el);
    },
    [regionRef],
  );

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal focuses the first control (Close); start on the heading.
      d.querySelector("[data-wd-detail-heading]")?.focus({ preventScroll: true });
    } else if (!open && d.open) d.close();
  }, [open]);

  // Never leave a modal open behind an unmounted detail.
  useEffect(
    () => () => {
      if (ref.current?.open) ref.current.close();
    },
    [],
  );

  return (
    <dialog
      ref={setRef}
      className={mode === "fullscreen" ? "wd-full" : "wd-drawer"}
      aria-labelledby={DETAIL_TITLE_ID}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the drawer's scrim lands on the dialog itself.
        if (mode === "drawer" && e.target === e.currentTarget) onClose();
      }}
    >
      <PortalTarget node={node}>{open ? children : null}</PortalTarget>
    </dialog>
  );
}
