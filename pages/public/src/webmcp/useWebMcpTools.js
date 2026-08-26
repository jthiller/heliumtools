import { useEffect } from "react";
import { registerWebMcpTools } from "./webmcp.js";

/**
 * Register WebMCP tools for the lifetime of a component. Tools appear when
 * the page mounts and are unregistered on unmount (the browser fires a
 * `toolchange` event either way, so agents track SPA navigation naturally).
 *
 * `factory` returns an array of tool descriptors (see registerWebMcpTools).
 * It runs inside the effect, so it may close over props/state — but pass
 * `deps` accordingly, or (better) keep `deps` `[]` and read live values
 * inside `execute` via refs so tools aren't churned on every render.
 * StrictMode's double-mount is safe: cleanup fully unregisters.
 */
export function useWebMcpTools(factory, deps = []) {
  useEffect(() => {
    return registerWebMcpTools(factory() || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
