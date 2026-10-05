import { CACHE_TTL } from "../config.js";
import { kvGetJson, kvPutJson } from "../utils.js";
import { hotspotInfoCreatedAt } from "../../../lib/helium-solana.js";

/**
 * On-chain onboard dates for a wallet's Hotspots.
 *
 * Each info account's creation time comes from `hotspotInfoCreatedAt`
 * (lib/helium-solana.js — what the date means, the L1-migration caveat, and why
 * not the Entity API's `created_at`). For a Hotspot on both networks, the
 * earlier one wins.
 *
 * Cost: one RPC subrequest per info account, so callers pass
 * ≤ ONBOARDED_BATCH_SIZE Hotspots and the result is KV-cached per Hotspot —
 * once resolved, the date never changes.
 */

// In-flight RPC lookups per request — bounds one batch's burst against the
// shared Helius RPS budget (the client runs two batches at a time).
const LOOKUP_CONCURRENCY = 8;

// Keyed by entity key (not info account) so a cache-first read needs nothing
// but the request. Wallet-independent: the date survives a Hotspot transfer.
const cacheKey = (entityKey) => `wd:onb:${entityKey}`;

/**
 * Read cached dates. Returns { [entityKey]: iso | null } for hits only; a
 * missing key is a miss. (Cached as { at } so a cached null — "history
 * doesn't settle it" — is distinguishable from a miss.)
 */
export async function readCachedOnboardDates(env, entityKeys) {
  const entries = await Promise.all(entityKeys.map((k) => kvGetJson(env, cacheKey(k))));
  const hits = {};
  entityKeys.forEach((k, i) => {
    if (entries[i] && "at" in entries[i]) hits[k] = entries[i].at;
  });
  return hits;
}

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
 * Resolve onboard dates for `entityKeys` (cache misses) from chain, using the
 * info-account addresses in the wallet's fleet. Returns { [entityKey]: iso | null }.
 *
 * Only keys in this wallet's fleet are looked up — the info addresses come
 * from the Entity API, never the client, so the endpoint can't be pointed at
 * arbitrary accounts. A key outside the fleet resolves null and is NOT cached
 * (that would poison the per-Hotspot entry for its real owner). A lookup that
 * fails resolves null uncached, so the next load retries it.
 */
export async function resolveOnboardDates(env, fleet, entityKeys) {
  const infoAccounts = fleet?.infoAccounts || {};
  const lookups = entityKeys.flatMap((entityKey) =>
    (infoAccounts[entityKey] || []).map((address) => ({ entityKey, address })),
  );

  const outcomes = await mapWithConcurrency(lookups, LOOKUP_CONCURRENCY, async ({ address }) => {
    try {
      return { ok: true, t: await hotspotInfoCreatedAt(env, address) };
    } catch {
      return { ok: false };
    }
  });

  const byKey = {};
  lookups.forEach(({ entityKey }, i) => (byKey[entityKey] ||= []).push(outcomes[i]));

  const results = {};
  const writes = [];
  for (const entityKey of entityKeys) {
    const found = byKey[entityKey];
    // Not in this wallet's fleet, or a lookup failed: unknown for now, uncached.
    if (!found || found.some((o) => !o.ok)) {
      results[entityKey] = null;
      continue;
    }
    const times = found.map((o) => o.t).filter((t) => t != null);
    const at = times.length ? new Date(Math.min(...times) * 1000).toISOString() : null;
    results[entityKey] = at;
    writes.push(kvPutJson(env, cacheKey(entityKey), { at }, at ? CACHE_TTL.onboarded : CACHE_TTL.onboardedUnknown));
  }
  await Promise.all(writes);
  return results;
}
