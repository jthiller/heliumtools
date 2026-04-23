import {
  REGISTRAR_CACHE_TTL,
  DAO_CACHE_TTL,
  PAST_EPOCH_CACHE_TTL,
} from "../config.js";
import { fetchMultipleAccounts } from "../../hotspot-claimer/services/common.js";

/**
 * KV read-through cache for an Anchor account. Returns a Buffer or null.
 *
 * Values are stored as base64. Callers decode.
 */
export async function cachedAccount(env, key, fetcher, ttlSeconds) {
  if (env.KV) {
    const cached = await env.KV.get(key);
    if (cached) {
      try {
        return Buffer.from(cached, "base64");
      } catch {
        // fallthrough — refetch
      }
    }
  }
  const buf = await fetcher();
  if (buf && env.KV) {
    await env.KV.put(key, buf.toString("base64"), {
      expirationTtl: ttlSeconds,
    });
  }
  return buf;
}

export const RegistrarCache = (env, fetcher) =>
  cachedAccount(env, "ve-hnt:registrar", fetcher, REGISTRAR_CACHE_TTL);

export const DaoCache = (env, fetcher) =>
  cachedAccount(env, "ve-hnt:dao", fetcher, DAO_CACHE_TTL);

/**
 * Past-epoch cache: DAO epoch info for epochs < currentEpoch is immutable
 * once done_issuing_rewards = true. We key on the epoch number.
 */
export const DaoEpochInfoCache = (env, epoch, fetcher) =>
  cachedAccount(env, `ve-hnt:daoEpoch:${epoch}`, fetcher, PAST_EPOCH_CACHE_TTL);

/**
 * Batched read-through for many accounts at once. Avoids the per-account
 * fetchAccount fan-out: for cache misses we fall through to a single
 * getMultipleAccounts call (chunked internally at 100). Essential for
 * per-epoch fetches spanning 100+ epochs on a cold cache.
 */
export async function batchCachedAccounts(env, specs, ttlSeconds) {
  const results = new Array(specs.length).fill(null);

  if (env.KV) {
    const cached = await Promise.all(specs.map((s) => env.KV.get(s.kvKey)));
    for (let i = 0; i < cached.length; i++) {
      if (!cached[i]) continue;
      try {
        results[i] = Buffer.from(cached[i], "base64");
      } catch {
        // fallthrough
      }
    }
  }

  const missIndices = [];
  const missPubkeys = [];
  for (let i = 0; i < specs.length; i++) {
    if (!results[i]) {
      missIndices.push(i);
      missPubkeys.push(specs[i].pubkey);
    }
  }

  if (missIndices.length === 0) return results;

  const fetched = await fetchMultipleAccounts(env, missPubkeys);
  const puts = [];
  for (let j = 0; j < missIndices.length; j++) {
    const buf = fetched[j];
    if (!buf) continue;
    const i = missIndices[j];
    results[i] = buf;
    if (env.KV) {
      puts.push(env.KV.put(specs[i].kvKey, buf.toString("base64"), {
        expirationTtl: ttlSeconds,
      }));
    }
  }
  await Promise.all(puts);
  return results;
}

export const DAO_EPOCH_TTL = PAST_EPOCH_CACHE_TTL;
