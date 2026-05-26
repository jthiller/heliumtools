// Asset-caching Service Worker for heliumtools.org.
//
// Navigations are network-first so a fresh deploy is picked up immediately
// and users never get a stale index.html pointing at chunk hashes that no
// longer exist. The cache fallback also covers transient 5xx during deploys.
// Hashed static assets are stale-while-revalidate. /api/* passes through.

const CACHE_VERSION = "v2";
const CACHE_NAME = `heliumtools-static-${CACHE_VERSION}`;

self.addEventListener("install", (event) => {
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

function classify(request) {
  if (request.method !== "GET") return "skip";
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return "skip";
  if (url.pathname.startsWith("/api/")) return "skip";
  if (request.mode === "navigate" || request.destination === "document") return "navigation";
  return "asset";
}

// Skip 206 partials, opaque redirects, and CORS responses.
function isStorable(res) {
  return res && res.status === 200 && res.type === "basic";
}

function cachePut(event, cache, request, res) {
  if (!isStorable(res)) return;
  event.waitUntil(cache.put(request, res.clone()).catch(() => {}));
}

async function networkFirst(event, cache) {
  const { request } = event;
  try {
    const res = await fetch(request);
    if (res.ok) {
      cachePut(event, cache, request, res);
      return res;
    }
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
  }
  const cached = await cache.match(request, { ignoreSearch: true });
  return cached || Response.error();
}

async function staleWhileRevalidate(event, cache) {
  const { request } = event;
  const cached = await cache.match(request);
  const networkPromise = (async () => {
    try {
      const res = await fetch(request);
      cachePut(event, cache, request, res);
      return res;
    } catch {
      return null;
    }
  })();
  event.waitUntil(networkPromise);
  return cached || (await networkPromise) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const kind = classify(event.request);
  if (kind === "skip") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return kind === "navigation"
      ? networkFirst(event, cache)
      : staleWhileRevalidate(event, cache);
  })());
});
