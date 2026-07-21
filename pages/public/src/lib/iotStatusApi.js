import { parseJson, throwIfApiError } from "./api.js";

// Client for api-iot.heliumtools.org (helium-iot-service) — per-Hotspot IoT
// connectivity status. Keyless and CORS-open by design, so the browser calls it
// directly (no worker proxy); the service edge-caches REST responses ~5 min and
// was built to absorb one-request-per-row dashboard bursts.
//
// Semantics (see the service's docs/API.md): `status: 0` = active = "connected
// to the Helium Packet Router during the most recent reported day". Liveness
// lands once per UTC day and is anchored to `dataThrough` (the feed's newest
// event timestamp), never wall-clock — it is NOT an "online right now" flag.
const IOT_STATUS_API_BASE = "https://api-iot.heliumtools.org";

// Resolved lookups (found or not-found) cached per address so remounts within
// the upstream edge-cache window — e.g. wallet A → B → back to A — cost zero
// requests. In-flight promises are cached too, so concurrent callers (React
// StrictMode double-effects, rapid wallet switching) share one request instead
// of racing duplicates. Failures are never cached. Bounded FIFO like the
// sibling hotspotMapApi cache; sized for a couple of large fleets.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map(); // address -> { promise } | { entry, ts }

async function requestGatewayStatus(address) {
  const res = await fetch(`${IOT_STATUS_API_BASE}/v1/gateways/${encodeURIComponent(address)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return { notFound: true };
  const data = await parseJson(res);
  throwIfApiError(res, data);
  if (typeof data?.status !== "number") throw new Error("Malformed status response");
  return { status: data.status, dataThrough: data.dataThrough ?? null };
}

/**
 * Look up one IoT Hotspot's liveness record by its Helium public key (the
 * fleet row's entityKey). Returns:
 *   - { status: 0|1, dataThrough: string|null } on 200
 *   - { notFound: true } on 404 (unknown to the service's inventory)
 * and throws on transport errors / other statuses so callers can mark the
 * Hotspot "unknown" rather than mislabeling it inactive.
 */
export async function fetchGatewayStatus(address) {
  const hit = cache.get(address);
  if (hit) {
    if (hit.promise) return hit.promise;
    if (Date.now() - hit.ts < CACHE_TTL_MS) return hit.entry;
    cache.delete(address);
  }

  const promise = requestGatewayStatus(address);
  cache.set(address, { promise });
  try {
    const entry = await promise;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(address, { entry, ts: Date.now() });
    return entry;
  } catch (err) {
    cache.delete(address);
    throw err;
  }
}
