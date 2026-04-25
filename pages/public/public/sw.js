// Asset-caching Service Worker for heliumtools.org. Stale-while-revalidate
// for same-origin static assets (HTML, JS, CSS, fonts, images) so repeat
// loads are instant and the app keeps working through brief network blips.
//
// Anything that isn't a same-origin GET — API requests, SSE, third-party
// CDNs — passes through to network unchanged. The multi-gateway tool's
// live data path stays untouched.
//
// Cache name is versioned via build hash so a deploy invalidates the
// previous cache cleanly.

const CACHE_VERSION = "v1";
const CACHE_NAME = `heliumtools-static-${CACHE_VERSION}`;

self.addEventListener("install", (event) => {
  // skipWaiting so a new SW takes over the page on next reload, not several
  // minutes later when the previous tab finally closes.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith("heliumtools-static-") && n !== CACHE_NAME)
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

function shouldHandle(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  // Skip API + SSE — they're live data, never cache them.
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/multi-gateway/events")) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  if (!shouldHandle(event.request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    const networkPromise = fetch(event.request)
      .then((res) => {
        // Don't cache opaque or error responses.
        if (res && res.ok && res.type === "basic") {
          cache.put(event.request, res.clone()).catch(() => {});
        }
        return res;
      })
      .catch(() => null);
    // Stale-while-revalidate: return the cached copy immediately if we have
    // one, refresh in the background. If no cache, wait on network.
    return cached || (await networkPromise) || new Response("offline", { status: 503 });
  })());
});
