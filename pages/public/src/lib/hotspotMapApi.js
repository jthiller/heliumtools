import { parseJson } from "./api.js";
import { dedupeAsync } from "./requestDedupe.js";
import { withTimeout } from "./abort.js";

export const API_BASE = import.meta.env?.DEV
  ? "/api/hotspot-map"
  : "https://api.heliumtools.org/hotspot-map";

/**
 * POST /resolve — batch resolve entity keys to on-chain locations.
 */
export async function resolveLocations(entityKeys, { signal } = {}) {
  signal?.throwIfAborted();
  const res = await fetch(`${API_BASE}/resolve`, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityKeys }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(data?.error || "Failed to resolve hotspot locations");
  }
  return data;
}

/**
 * GET /onboarded — one Hotspot's on-chain onboard date per network (`networks`
 * a comma-separated subset of "iot,mobile"). Hotspots from before Helium's
 * April 2023 move to Solana carry their migration date. Returns
 * { iot?: iso | null, mobile?: iso | null }, or null if the lookup failed.
 *
 * A session cache that also shares in-flight requests: the detail card mounts
 * twice per selection (desktop sidebar + mobile sheet), and a cold lookup costs
 * the worker RPC calls. Failures aren't kept, so a later view retries.
 */
export const fetchOnboardDates = dedupeAsync(
  async (entityKey, networks, { signal } = {}) => {
    signal?.throwIfAborted();
    const query = new URLSearchParams({ entityKey, networks });
    const res = await fetch(`${API_BASE}/onboarded?${query.toString()}`, { signal: withTimeout(signal, 30_000) });
    const data = await parseJson(res);
    return res.ok && data?.onboarded ? data.onboarded : null;
  },
  Infinity,
  { max: 500, signalIndex: 2, keep: (onboarded) => onboarded != null },
);

/**
 * GET /wallet — fetch entity keys for a wallet address.
 */
export async function fetchWalletHotspots(address, { signal } = {}) {
  signal?.throwIfAborted();
  const query = new URLSearchParams({ address });
  const res = await fetch(`${API_BASE}/wallet?${query.toString()}`, { signal });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(data?.error || "Failed to look up wallet");
  }
  return data;
}
