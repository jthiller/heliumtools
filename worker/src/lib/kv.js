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

/**
 * Run `fn` behind a best-effort single-flight KV lock.
 *
 * KV has no atomic put-if-absent, so a rare race just means the work runs twice
 * — harmless for the refresh-a-cache jobs this guards. Fails OPEN: without a KV
 * binding, or on any KV error, we run `fn` rather than block it.
 *
 * Returns `{ contended: true }` when someone else holds the lock (the caller
 * decides what to serve instead), otherwise `{ contended: false, result }`.
 */
export async function withKvLock(env, key, ttlSeconds, fn) {
  let held = false;
  if (env.KV) {
    try {
      if (await env.KV.get(key)) return { contended: true };
      // 60 is Cloudflare KV's expirationTtl floor — anything lower is rejected
      // outright, and since this fails open that rejection would silently make
      // the lock inert. The lock is released in the finally below either way,
      // so the TTL only matters when the isolate dies mid-run.
      await env.KV.put(key, "1", { expirationTtl: Math.max(60, ttlSeconds) });
      held = true;
    } catch {
      // fall through and run unlocked
    }
  }

  try {
    return { contended: false, result: await fn() };
  } finally {
    if (held) {
      try {
        await env.KV.delete(key);
      } catch {
        /* lock self-expires via TTL */
      }
    }
  }
}
