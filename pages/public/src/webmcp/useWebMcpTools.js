import { useEffect } from "react";

/**
 * Register WebMCP tools for the lifetime of a component. Tools appear when
 * the page mounts and are unregistered on unmount (the browser fires a
 * `toolchange` event either way, so agents track SPA navigation naturally).
 *
 * The registration/validation core is dynamically imported here, and only
 * when the browser actually exposes WebMCP — human visitors pay nothing
 * for it on first paint. Late registration is fine: agents discover tools
 * via `toolchange`.
 *
 * `factory` returns an array of tool descriptors (see registerWebMcpTools
 * in webmcp.js) or a Promise of one — so a factory may itself dynamically
 * import its tool module. It runs inside the effect and may close over
 * props/state; keep `deps` `[]` and read live values inside `execute` via
 * refs so tools aren't churned on every render. StrictMode's double-mount
 * is safe: cleanup fully unregisters.
 */
export function useWebMcpTools(factory, deps = []) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (!document.modelContext && !navigator.modelContext) return undefined;
    let cancelled = false;
    let cleanup;
    Promise.all([import("./webmcp.js"), factory()])
      .then(([core, tools]) => {
        if (!cancelled) cleanup = core.registerWebMcpTools(tools || []);
      })
      .catch((err) => console.warn("[webmcp] registration failed:", err));
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
