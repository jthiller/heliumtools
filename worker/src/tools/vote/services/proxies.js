// Proxy / delegate name registry. Helium governance proxies register their
// profile (name, image, …) in the public `helium/helium-vote-proxies` repo,
// keyed by wallet — there's no on-chain name. We fetch that JSON and build a
// `wallet -> { name }` map so the roster can show a proxy's name instead of a
// bare address. (A proxied VoteMarkerV0's `voter` IS the proxy wallet, so the
// lookup is direct — no ProxyAssignment resolution needed.)

import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import { PROXY_MAP_CACHE_TTL } from "../config.js";

const PROXIES_URL = "https://raw.githubusercontent.com/helium/helium-vote-proxies/master/proxies.json";
const CACHE_KEY = "vote:proxymap";

/** Map of proxy wallet → { name }. Best-effort: {} if the fetch fails. */
export async function getProxyMap(env) {
  const cached = await kvGetJson(env, CACHE_KEY);
  if (cached) return cached;
  try {
    const res = await fetch(PROXIES_URL, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const list = await res.json();
      const map = {};
      if (Array.isArray(list)) {
        for (const p of list) {
          if (p && typeof p.wallet === "string" && typeof p.name === "string") {
            map[p.wallet] = { name: p.name };
          }
        }
      }
      await kvPutJson(env, CACHE_KEY, map, PROXY_MAP_CACHE_TTL);
      return map;
    }
  } catch {
    // Best-effort — names just won't resolve this cycle; don't cache failure.
  }
  return {};
}
