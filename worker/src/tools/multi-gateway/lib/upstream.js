import { REGIONS } from "../regions.js";
import { getHost } from "./host.js";

async function fetchUpstream(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, data: { error: "Upstream returned non-JSON response" } };
  }
}

/**
 * GET `path` on every region's instance: the parsed bodies of the regions that
 * answered ok, in REGIONS order. A region that fails or times out contributes
 * nothing, so the result can cover part of the fleet, or none of it.
 */
export async function fetchRegions(env, path) {
  const host = getHost(env);
  const headers = { "X-API-Key": env.MULTI_GATEWAY_API_KEY };
  const results = await Promise.allSettled(
    REGIONS.map(({ port }) => fetchUpstream(`http://${host}:${port}${path}`, headers)),
  );
  return results.flatMap((r) =>
    r.status === "fulfilled" && r.value.ok ? [r.value.data] : [],
  );
}

/** Every reachable region's gateway list, concatenated. */
export async function fetchAllGateways(env) {
  const regions = await fetchRegions(env, "/gateways");
  return regions.flatMap((data) => data?.gateways || []);
}
