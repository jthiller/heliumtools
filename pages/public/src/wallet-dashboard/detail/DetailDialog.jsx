import { useCallback, useEffect, useRef, useState } from "react";
import { PortalTarget } from "../ui/PortalTarget.jsx";

/**
 * The detail as a native modal <dialog> (`showModal`): "drawer" (768 to
 * 1279, 440 px from the right) or "fullscreen" (below 768). The dialog's
 * `cancel` (Escape) calls `onClose`. Its body is a PortalTarget, so InfoTip
 * bubbles render inside the modal (the top layer would hide them on <body>).
 * STUB (U0a): the final props; U3 replaces it.
 *
 * Props: open, mode ("drawer"|"fullscreen"), regionRef (the dialog), onClose,
 * children (the HotspotDetail).
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
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={setRef}
      className={mode === "fullscreen" ? "wd-full" : "wd-drawer"}
      aria-label="Hotspot details"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <PortalTarget node={node}>{open ? children : null}</PortalTarget>
    </dialog>
  );
}
