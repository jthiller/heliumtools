// Client for api-iot.heliumtools.org (helium-iot-service) — per-Hotspot IoT
// connectivity status. Keyless and CORS-open by design, so the browser calls it
// directly (no worker proxy); the service edge-caches REST responses ~5 min and
// was built to absorb one-request-per-row dashboard bursts.
//
// Semantics (see the service's docs/API.md): `status: 0` = active = "connected
// to the Helium Packet Router during the most recent reported day". Liveness
// lands once per UTC day and is anchored to `dataThrough` (the feed's newest
// event timestamp), never wall-clock — it is NOT an "online right now" flag.
export const IOT_STATUS_API_BASE = "https://api-iot.heliumtools.org";

/**
 * Look up one IoT Hotspot's liveness record by its Helium public key (the
 * fleet row's entityKey). Returns:
 *   - { status: 0|1, dataThrough: string|null } on 200
 *   - { notFound: true } on 404 (unknown to the service's inventory)
 * and throws on transport errors / other statuses so callers can mark the
 * Hotspot "unknown" rather than mislabeling it inactive.
 */
export async function fetchGatewayStatus(address) {
  const res = await fetch(`${IOT_STATUS_API_BASE}/v1/gateways/${encodeURIComponent(address)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`IoT status API returned ${res.status}`);
  const data = await res.json();
  return { status: data?.status, dataThrough: data?.dataThrough ?? null };
}
