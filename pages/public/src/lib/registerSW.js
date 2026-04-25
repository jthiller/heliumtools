// Register the asset-caching service worker. Production-only — in dev,
// Vite's HMR pipeline owns the network and the SW would interfere.

export function registerSW() {
  if (import.meta.env.DEV) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // Defer to load so registration can't block first paint.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] registration failed:", err);
    });
  });
}
