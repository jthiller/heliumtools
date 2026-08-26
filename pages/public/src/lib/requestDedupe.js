/**
 * Share identical in-flight GETs and reuse fresh results for a few
 * seconds. WebMCP tools drive the page UI and return data in one call, so
 * the page's own debounced effect often repeats the identical request
 * moments later; this collapses the pair without making any endpoint
 * meaningfully stale (page debounces are 400-800ms, well inside the TTL).
 * Read-only fetchers only — never wrap mutations or reads that must
 * reflect a mutation immediately (e.g. the claimer's rewards refresh).
 */
export function dedupeAsync(fn, ttlMs = 3_000) {
  const entries = new Map(); // JSON args key -> { at, promise }
  return (...args) => {
    const key = JSON.stringify(args);
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
    if (entries.size > 100) entries.clear();
    const promise = Promise.resolve().then(() => fn(...args));
    entries.set(key, { at: Date.now(), promise });
    // Failures aren't cached; callers still see the rejection on the
    // promise they were handed.
    promise.catch(() => entries.delete(key));
    return promise;
  };
}
