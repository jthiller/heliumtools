import { HOTSPOT_NETWORKS, hotspotInfoKey, resolveOnboardedAt } from "../../../lib/helium-solana.js";

/**
 * On-chain onboard dates for a batch of Hotspots, earliest across each
 * Hotspot's networks. Dates come from the shared per-info-account cache
 * (`readCachedOnboardedAt` / `resolveOnboardedAt` in lib/helium-solana.js,
 * which also documents what the date means and why it isn't the Entity API's
 * `created_at`).
 */

// In-flight RPC lookups per request — bounds one batch's burst against the
// shared Helius RPS budget (the client runs two batches at a time).
const LOOKUP_CONCURRENCY = 4;

/** Map `items` through async `fn` with at most `limit` in flight. */
async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

/**
 * Each Hotspot's info-account addresses, derived from its entity key — never
 * taken from the client, so a request can't point the RPC at arbitrary
 * accounts, and a cached date is right whoever asks. Networks outside
 * HOTSPOT_NETWORKS are ignored; a key that won't derive gets none.
 * Returns [{ entityKey, addresses }].
 */
export function infoAccountsOf(hotspots) {
  return hotspots.map(({ entityKey, networks }) => {
    const nets = [...new Set(networks)].filter((n) => HOTSPOT_NETWORKS.includes(n));
    try {
      return { entityKey, addresses: nets.map((n) => hotspotInfoKey(n, entityKey).toBase58()) };
    } catch {
      return { entityKey, addresses: [] };
    }
  });
}

/**
 * Resolve uncached addresses from chain (cached as they land). Returns
 * { [address]: iso | null }; an address whose lookup failed is left out.
 */
export async function resolveMissing(env, addresses) {
  const dates = await mapWithConcurrency(addresses, LOOKUP_CONCURRENCY, (a) =>
    resolveOnboardedAt(env, a).catch(() => undefined),
  );
  const out = {};
  addresses.forEach((a, i) => {
    if (dates[i] !== undefined) out[a] = dates[i];
  });
  return out;
}

/**
 * { [entityKey]: iso | null } — the earliest date across a Hotspot's
 * accounts, or null when it has none, none is dated, or one is unresolved (a
 * failed lookup could be hiding the earlier network).
 */
export function earliestOnboardDates(accounts, dates) {
  const results = {};
  for (const { entityKey, addresses } of accounts) {
    const unresolved = addresses.length === 0 || addresses.some((a) => !(a in dates));
    // ISO timestamps from toISOString sort chronologically as strings.
    results[entityKey] = unresolved ? null : (addresses.map((a) => dates[a]).filter(Boolean).sort()[0] ?? null);
  }
  return results;
}
