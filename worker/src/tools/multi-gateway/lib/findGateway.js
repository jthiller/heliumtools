import { REGIONS } from "../regions.js";

/**
 * Find a gateway across all region instances in parallel.
 * Returns { port, data } for the first region that has the gateway, or null.
 */
export async function findGateway(mac, env) {
  const host = env.MULTI_GATEWAY_HOST || "hotspot.heliumtools.org";
  const apiKey = env.MULTI_GATEWAY_API_KEY;

  const probes = await Promise.allSettled(
    REGIONS.map(({ port }) =>
      fetch(`http://${host}:${port}/gateways/${mac}`, { headers: { "X-API-Key": apiKey } })
        .then(async (res) => res.ok ? { port, data: await res.json() } : null)
    )
  );

  return probes.find(r => r.status === "fulfilled" && r.value)?.value || null;
}
