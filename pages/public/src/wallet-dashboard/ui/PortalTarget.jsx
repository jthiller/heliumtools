import { createContext, useContext } from "react";

const PortalContext = createContext(null);

/**
 * Where floating bubbles (InfoTip) portal to inside `children`. A modal
 * `<dialog>` sits in the top layer, so a bubble portaled to <body> would
 * render under it: DetailDialog wraps its body with `node` = the dialog
 * element. `node` may be null until the dialog mounts (bubbles then fall back
 * to <body>).
 */
export function PortalTarget({ node, children }) {
  return <PortalContext.Provider value={node}>{children}</PortalContext.Provider>;
}

/** The nearest PortalTarget's node, else <body>. */
export function usePortalNode() {
  const node = useContext(PortalContext);
  return node ?? (typeof document !== "undefined" ? document.body : null);
}

export default PortalTarget;
