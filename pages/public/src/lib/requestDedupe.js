/**
 * Share identical in-flight GETs and reuse fresh results for a few
 * seconds. WebMCP tools drive the page UI and return data in one call, so
 * the page's own debounced effect often repeats the identical request
 * moments later; this collapses the pair without making any endpoint
 * meaningfully stale (page debounces are 400-800ms, well inside the TTL).
 * Read-only fetchers only — never wrap mutations or reads that must
 * reflect a mutation immediately (e.g. the claimer's rewards refresh).
 *
 * Also a plain read cache with a longer `ttlMs` (Infinity = per session):
 * `max` bounds the entry count (oldest entry evicted first), and `keep(value)`
 * returning false drops a resolved value once in-flight callers have it, so
 * a transient answer is never served from cache.
 */
export function dedupeAsync(fn, ttlMs = 3_000, { max = 100, keep, signalIndex } = {}) {
  if (Number.isInteger(signalIndex)) return dedupeCancellable(fn, ttlMs, { max, keep, signalIndex });
  const entries = new Map(); // JSON args key -> { at, promise }
  return (...args) => {
    const key = JSON.stringify(args);
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
    if (hit) entries.delete(key); // expired: re-inserted below as the newest
    if (entries.size >= max) entries.delete(entries.keys().next().value);
    const promise = Promise.resolve().then(() => fn(...args));
    entries.set(key, { at: Date.now(), promise });
    // Failures aren't cached; callers still see the rejection on the
    // promise they were handed. Only evict our own entry — a slow, expired
    // call rejecting late must not delete a newer entry under the same key.
    const evict = () => {
      if (entries.get(key)?.promise === promise) entries.delete(key);
    };
    promise.then((value) => keep && !keep(value) && evict(), evict);
    return promise;
  };
}

/**
 * Signal-aware callers still share a request with the page. `signalIndex`
 * identifies the optional `{ signal, ...options }` argument. The signal
 * isn't part of the cache key; every other option is. Cancelling one caller
 * releases only its subscription, and cancelling the last caller aborts
 * the underlying request and removes it from the cache.
 */
function dedupeCancellable(fn, ttlMs, { max, keep, signalIndex }) {
  const entries = new Map();
  let sweptAt = Date.now();
  return (...args) => {
    const options = args[signalIndex] || {};
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(signal.reason);

    const keyArgs = [...args];
    const { signal: ignoredSignal, ...keyOptions } = options;
    keyArgs[signalIndex] = Object.keys(keyOptions).length ? keyOptions : undefined;
    // Not .at(-1): this runs synchronously in every page read, and a throw
    // here (no Array.prototype.at before Safari 15.4) escapes callers' .catch.
    while (keyArgs.length && keyArgs[keyArgs.length - 1] === undefined) keyArgs.pop();
    const key = JSON.stringify(keyArgs);
    let entry = entries.get(key);
    if (entry && entry.settled && Date.now() - entry.at >= ttlMs) {
      entries.delete(key);
      entry = null;
    }
    if (!entry) {
      // Drop expired results (at most once per TTL), so a long-lived page
      // keeps only what it could still serve, not every key it ever read,
      // and a live entry isn't evicted for room an expired one is holding.
      const now = Date.now();
      if (now - sweptAt >= ttlMs) {
        sweptAt = now;
        for (const [k, e] of entries) if (e.settled && now - e.at >= ttlMs) entries.delete(k);
      }
      if (entries.size >= max) entries.delete(entries.keys().next().value);
      entry = { controller: new AbortController(), consumers: new Set(), settled: false, at: 0 };
      const ownedEntry = entry;
      const requestArgs = [...args];
      requestArgs[signalIndex] = { ...options, signal: entry.controller.signal };
      entry.promise = Promise.resolve().then(() => {
        ownedEntry.controller.signal.throwIfAborted();
        return fn(...requestArgs);
      });
      entry.evict = () => {
        if (entries.get(key) === ownedEntry) entries.delete(key);
      };
      entry.promise.then((value) => {
        ownedEntry.settled = true;
        ownedEntry.at = Date.now();
        if (keep && !keep(value)) ownedEntry.evict();
      }, () => {
        ownedEntry.settled = true;
        ownedEntry.evict();
      });
      entries.set(key, entry);
    }

    return new Promise((resolve, reject) => {
      const consumer = {};
      entry.consumers.add(consumer);
      const release = () => {
        signal?.removeEventListener("abort", abort);
        entry.consumers.delete(consumer);
      };
      const abort = () => {
        release();
        if (!entry.settled && entry.consumers.size === 0) {
          entry.evict();
          entry.controller.abort(signal.reason);
        }
        reject(signal.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      entry.promise.then((value) => { release(); resolve(value); }, (error) => { release(); reject(error); });
    });
  };
}
