import {
  REGISTRAR_CACHE_TTL,
  DAO_CACHE_TTL,
  PAST_EPOCH_CACHE_TTL,
} from "../config.js";

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
