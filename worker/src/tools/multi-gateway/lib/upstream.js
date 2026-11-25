import { REGIONS } from "../regions.js";
import { getHost } from "./host.js";

export async function fetchUpstream(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, data: { error: "Upstream returned non-JSON response" } };
  }
}

/**
 * Every region's gateway list, concatenated. A region that fails or times out
 * contributes nothing, so the result can be a partial fleet (or empty).
 */
export async function fetchAllGateways(env) {
  const host = getHost(env);
  const headers = { "X-API-Key": env.MULTI_GATEWAY_API_KEY };
  const results = await Promise.allSettled(
    REGIONS.map(({ port }) =>
      fetchUpstream(`http://${host}:${port}/gateways`, headers),
    ),
  );

  let gateways = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.ok) {
      gateways = gateways.concat(result.value.data.gateways || []);
    }
  }
  return gateways;
}
