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
 *
 * `ttlFromSettle`: share a call for as long as it runs, and start `ttlMs`
 * when it resolves rather than when it started (for slow, bounded work such
 * as a check that can outlast the TTL). Only for fetchers that always settle.
 */
export function dedupeAsync(fn, ttlMs = 3_000, { max = 100, keep, ttlFromSettle = false } = {}) {
  const entries = new Map(); // JSON args key -> { at, promise, pending }
  return (...args) => {
    const key = JSON.stringify(args);
    const hit = entries.get(key);
    if (hit && (hit.pending || Date.now() - hit.at < ttlMs)) return hit.promise;
    if (hit) entries.delete(key); // expired: re-inserted below as the newest
    if (entries.size >= max) entries.delete(entries.keys().next().value);
    const promise = Promise.resolve().then(() => fn(...args));
    const entry = { at: Date.now(), promise, pending: ttlFromSettle };
    entries.set(key, entry);
    // Failures aren't cached; callers still see the rejection on the
    // promise they were handed. Only evict our own entry — a slow, expired
    // call rejecting late must not delete a newer entry under the same key.
    const evict = () => {
      if (entries.get(key)?.promise === promise) entries.delete(key);
    };
    promise.then((value) => {
      if (keep && !keep(value)) evict();
      else if (ttlFromSettle) {
        entry.pending = false;
        entry.at = Date.now();
      }
    }, evict);
    return promise;
  };
}
