// Best-effort JSON helpers over the KV binding. Swallow errors so a transient
// cache failure never fails a request whose underlying data succeeded.

export async function kvGetJson(env, key) {
  if (!env.KV) return null;
  try {
    return await env.KV.get(key, "json");
  } catch {
    return null;
  }
}

export async function kvPutJson(env, key, value, ttlSeconds) {
  if (!env.KV) return;
  try {
    await env.KV.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch {
    // best-effort
  }
}
