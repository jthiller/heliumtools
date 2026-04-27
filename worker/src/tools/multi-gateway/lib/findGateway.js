import { REGIONS } from "../regions.js";
import { getHost } from "./host.js";

/**
 * Find a gateway across all region instances in parallel.
 * Returns { port, data } for the first region that has the gateway, or null.
 */
export async function findGateway(mac, env) {
  const host = getHost(env);
  const apiKey = env.MULTI_GATEWAY_API_KEY;

  const probes = await Promise.allSettled(
    REGIONS.map(({ port }) =>
      fetch(`http://${host}:${port}/gateways/${mac}`, { headers: { "X-API-Key": apiKey } })
        .then(async (res) => res.ok ? { port, data: await res.json() } : null)
    )
  );

  return probes.find(r => r.status === "fulfilled" && r.value)?.value || null;
}
