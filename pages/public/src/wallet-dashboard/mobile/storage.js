// Browser storage and downloads for the Mobile activity engine. Two storage
// layers, both best-effort: every call is bounded by a timeout and falls back
// to memory or the network, so a broken store (Safari private mode, a full
// quota, the Safari IndexedDB-in-a-worker stall, see
// multi-gateway/packetCache.js) can slow a check down but never break it.
//
//   Bytes    — whole files by URL: in-memory LRU → Cache Storage → network.
//              Every file the engine reads is immutable (UUID-named Parquet,
//              snapshot-named Avro), so a cached copy never goes stale; it only
//              stops being useful. Evicted by usefulness, then LRU, under a
//              byte budget.
//   Extracts — IndexedDB: one wallet's normalized rows per data file, so a
//              reload re-reads nothing it already extracted.
//
// Downloads share the link, so they're scheduled by size: a file of
// LARGE_FILE_BYTES or more downloads on its own (on a slow link each one
// finishes, and is cached, before the next starts) beside up to
// MAX_DOWNLOADS - 1 small ones. A download is abandoned only when no bytes
// arrive for STALL_MS; one cut short keeps its bytes and resumes with a Range
// request on the next try.

const CACHE_NAME = "wd-iceberg-v1";
// A Cache Storage key needs an http(s) URL; this one never hits the network.
const INDEX_KEY = "https://wd-iceberg.invalid/index.json";
const BUDGET_MAX_BYTES = 250_000_000;
const BUDGET_QUOTA_SHARE = 0.1;
// When the quota can't be read.
const BUDGET_FALLBACK_BYTES = 100_000_000;
const MEMORY_BUDGET_BYTES = 32_000_000;
const MEMORY_ITEM_MAX_BYTES = 12_000_000;
const CACHE_OP_TIMEOUT_MS = 3000;
const IDB_TIMEOUT_MS = 1000;
// A store whose reads (or writes) fail this many times in a row, with no
// success of that kind in between, is skipped for the session.
const MAX_STORE_FAILURES = 3;
// Bytes not tied to a time window (manifests, the bans table) stay this long
// past their last use.
export const IDLE_RETAIN_MS = 2 * 86_400_000;

const LARGE_FILE_BYTES = 2_000_000;
const MAX_DOWNLOADS = 5;
const STALL_MS = 20_000;
// A download still trickling in after this long is abandoned anyway.
const DOWNLOAD_CEILING_MS = 10 * 60_000;
// Downloads cut short, kept in memory to resume (oldest dropped first).
const PARTIAL_MAX_BYTES = 24_000_000;

function withTimeout(promise, ms, label) {
  let id;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

/** An HTTP failure, with the status for retry decisions. */
export class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/** The abort reason for a request that took too long (`describeError` reads its name). */
export const timeoutError = (message) => new DOMException(message, "TimeoutError");

/** The abort reason for a check that was cancelled (wallet switch, stop). */
export const cancelledError = () => new DOMException("The check was cancelled.", "AbortError");

/** A signal that aborts with the first of `signals` to abort (absent ones skipped). */
export function anySignal(...signals) {
  const list = signals.filter(Boolean);
  if (list.length <= 1) return list[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);
  const ctl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

// Download slots: at most MAX_DOWNLOADS at once, at most one of them large.
// Waiters are served in arrival order; a small one passes a large one that
// is waiting only for the large slot.
function createGate() {
  let active = 0;
  let large = false;
  const queue = [];
  const fits = (isLarge) => active < MAX_DOWNLOADS && !(isLarge && large);

  function take(isLarge) {
    active++;
    if (isLarge) large = true;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      active--;
      if (isLarge) large = false;
      pump();
    };
  }

  function pump() {
    for (let i = 0; i < queue.length; ) {
      const w = queue[i];
      if (!fits(w.isLarge)) {
        i++;
        continue;
      }
      queue.splice(i, 1);
      w.signal?.removeEventListener("abort", w.onAbort);
      w.resolve(take(w.isLarge));
    }
  }

  /** Resolves a release function once a slot is free. */
  function acquire(isLarge, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (fits(isLarge)) return Promise.resolve(take(isLarge));
    return new Promise((resolve, reject) => {
      const w = { isLarge, signal, resolve };
      w.onAbort = () => {
        const i = queue.indexOf(w);
        if (i >= 0) queue.splice(i, 1);
        reject(signal.reason);
      };
      signal?.addEventListener("abort", w.onAbort, { once: true });
      queue.push(w);
    });
  }

  return { acquire };
}

/** `Content-Range: bytes 100-1888/1889` → { start: 100, total: 1889 }. */
function contentRange(res) {
  const m = /^bytes (\d+)-\d+\/(\d+)$/.exec(res.headers.get("content-range") || "");
  return m ? { start: Number(m[1]), total: Number(m[2]) } : null;
}

function concat(chunks, length) {
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

/**
 * Whole-file byte cache. `get(url, opts)` resolves an ArrayBuffer:
 *   opts.table     index label (eviction stats)
 *   opts.persist   write to Cache Storage on a network read (default true)
 *   opts.expireAt  ms after which the file is no longer useful (default:
 *                  IDLE_RETAIN_MS past last use)
 *   opts.size      expected bytes (schedules the download as large or small)
 *   opts.signal    the caller stops waiting when it aborts; a download stops
 *                  only once no caller is waiting for it
 * `flush(now, keep)` evicts and persists the index; call it after a check.
 * `idle()` settles once pending Cache Storage writes have.
 * `stats` counts network/memory/Cache Storage reads for diagnostics.
 */
export function createByteCache({ fetchImpl = (...a) => fetch(...a), memoryBudgetBytes = MEMORY_BUDGET_BYTES } = {}) {
  const memory = new Map(); // url → ArrayBuffer, oldest first
  let memoryBytes = 0;
  const inflight = new Map(); // url → download job shared by its callers
  const partials = new Map(); // url → { buf: Uint8Array, received }, oldest first
  let partialBytes = 0;
  const gate = createGate();
  const pendingStores = new Set();
  const stats = {
    netRequests: 0,
    netBytes: 0,
    resumed: 0,
    memoryHits: 0,
    cacheHits: 0,
    cacheBytes: 0,
    cacheErrors: 0,
  };

  // Cache Storage + its index (url → { url, bytes, table, expireAt, lastUsed }).
  let readFailures = 0;
  let writeFailures = 0;
  let cachePromise = null;
  let index = new Map();
  let indexDirty = false;
  let budgetPromise = null;

  const hasCaches = () => typeof caches !== "undefined";
  const readable = () => hasCaches() && readFailures < MAX_STORE_FAILURES;
  const writable = () => hasCaches() && writeFailures < MAX_STORE_FAILURES;

  function noteFailure(kind) {
    if (kind === "read") readFailures++;
    else writeFailures++;
    stats.cacheErrors++;
  }

  function openCache() {
    if (!readable() && !writable()) return Promise.resolve(null);
    if (!cachePromise) {
      cachePromise = withTimeout(caches.open(CACHE_NAME), CACHE_OP_TIMEOUT_MS, "caches.open")
        .then(async (cache) => {
          await loadIndex(cache).catch(() => noteFailure("read"));
          return cache;
        })
        .catch(() => {
          noteFailure("read");
          noteFailure("write");
          cachePromise = null;
          return null;
        });
    }
    return cachePromise;
  }

  // The index travels with the cache it describes.
  async function loadIndex(cache) {
    const res = await withTimeout(cache.match(INDEX_KEY), CACHE_OP_TIMEOUT_MS, "index read");
    const saved = res ? await withTimeout(res.json(), CACHE_OP_TIMEOUT_MS, "index parse") : [];
    index = new Map();
    for (const e of Array.isArray(saved) ? saved : []) if (e?.url) index.set(e.url, e);
    await syncIndex(cache);
    readFailures = 0;
  }

  // Entries whose bytes are gone are dropped. Bytes the index doesn't list
  // (another tab's or worker's index write won, or a write was cut off) are
  // adopted as least recently used, with the table and expiry stored beside
  // them.
  async function syncIndex(cache) {
    const keys = await withTimeout(cache.keys(), CACHE_OP_TIMEOUT_MS, "cache.keys");
    const present = new Set(keys.map((r) => r.url).filter((u) => u !== INDEX_KEY));
    for (const url of index.keys()) {
      if (present.has(url)) continue;
      index.delete(url);
      indexDirty = true;
    }
    for (const url of present) {
      if (index.has(url)) continue;
      const hit = await withTimeout(cache.match(url), CACHE_OP_TIMEOUT_MS, "cache.match");
      if (!hit) continue;
      index.set(url, {
        url,
        bytes: Number(hit.headers.get("content-length")) || 0,
        table: hit.headers.get("x-wd-table") || "?",
        expireAt: Number(hit.headers.get("x-wd-expire-at")) || Date.now() + IDLE_RETAIN_MS,
        lastUsed: 0,
      });
      indexDirty = true;
    }
  }

  function budget() {
    budgetPromise ??= (async () => {
      try {
        const est = await withTimeout(navigator.storage.estimate(), CACHE_OP_TIMEOUT_MS, "storage.estimate");
        if (est?.quota > 0) return Math.min(BUDGET_MAX_BYTES, est.quota * BUDGET_QUOTA_SHARE);
      } catch {
        // fall through
      }
      return BUDGET_FALLBACK_BYTES;
    })();
    return budgetPromise;
  }

  function remember(url, buf) {
    if (buf.byteLength > MEMORY_ITEM_MAX_BYTES) return;
    if (memory.has(url)) return;
    memory.set(url, buf);
    memoryBytes += buf.byteLength;
    for (const [u, b] of memory) {
      if (memoryBytes <= memoryBudgetBytes) break;
      memory.delete(u);
      memoryBytes -= b.byteLength;
    }
  }

  const expiryOf = (opts, now) => opts.expireAt ?? now + IDLE_RETAIN_MS;

  function touch(url, bytes, opts, now = Date.now()) {
    const prev = index.get(url);
    index.set(url, {
      url,
      bytes,
      table: opts.table ?? prev?.table ?? "?",
      expireAt: expiryOf(opts, now),
      lastUsed: now,
    });
    indexDirty = true;
  }

  async function fromCacheStorage(url, opts) {
    const cache = await openCache();
    if (!cache || !readable()) return null;
    try {
      const res = await withTimeout(cache.match(url, { ignoreVary: true }), CACHE_OP_TIMEOUT_MS, "cache.match");
      readFailures = 0; // a clean miss is a working store too
      if (!res) return null;
      const buf = await withTimeout(res.arrayBuffer(), CACHE_OP_TIMEOUT_MS, "cache read");
      stats.cacheHits++;
      stats.cacheBytes += buf.byteLength;
      touch(url, buf.byteLength, opts);
      return buf;
    } catch {
      noteFailure("read");
      return null;
    }
  }

  function stashPartial(url, buf, received) {
    if (received <= 0 || received >= buf.byteLength) return;
    takePartial(url);
    partials.set(url, { buf, received });
    partialBytes += buf.byteLength;
    for (const [u, p] of partials) {
      if (partialBytes <= PARTIAL_MAX_BYTES) break;
      partials.delete(u);
      partialBytes -= p.buf.byteLength;
    }
  }

  function takePartial(url) {
    const p = partials.get(url);
    if (p) {
      partials.delete(url);
      partialBytes -= p.buf.byteLength;
    }
    return p ?? null;
  }

  // One GET, read as a stream: the stall timer restarts on every chunk, so a
  // slow link finishes and a dead one fails in STALL_MS. Aborts (stall,
  // ceiling, or `signal`: nobody wants the file any more) reject with their
  // reason; the bytes so far are kept for a Range resume.
  async function fromNetwork(url, opts, signal) {
    const release = await gate.acquire((opts.size ?? 0) >= LARGE_FILE_BYTES, signal);
    const ctl = new AbortController();
    const onCancel = () => ctl.abort(signal.reason);
    signal?.addEventListener("abort", onCancel, { once: true });
    let stall = null;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => ctl.abort(timeoutError(`No data received for ${STALL_MS / 1000} s.`)), STALL_MS);
    };
    const ceiling = setTimeout(() => ctl.abort(timeoutError("The download took too long.")), DOWNLOAD_CEILING_MS);
    let partial = takePartial(url);
    let buf = null; // preallocated from the length, when known
    let chunks = null;
    let received = 0;
    try {
      arm();
      const persist = opts.persist !== false && writable();
      const res = await fetchImpl(url, {
        // Cache Storage keeps the copy; the HTTP cache would only duplicate it.
        cache: persist ? "no-store" : "default",
        headers: partial ? { range: `bytes=${partial.received}-` } : undefined,
        signal: ctl.signal,
      });
      stats.netRequests++;
      if (!res.ok) {
        res.body?.cancel?.().catch?.(() => {});
        throw new HttpError(res.status);
      }
      const range = res.status === 206 ? contentRange(res) : null;
      if (partial && range && range.start === partial.received && range.total === partial.buf.byteLength) {
        ({ buf, received } = partial);
        stats.resumed++;
      } else if (res.status === 206) {
        partial = null; // not resumable: the next try starts over
        res.body?.cancel?.().catch?.(() => {});
        throw new Error("Unexpected partial response.");
      } else {
        const length = Number(res.headers.get("content-length")) || 0;
        if (length > 0) buf = new Uint8Array(length);
        else chunks = [];
      }
      partial = null;
      if (!res.body) {
        // No stream to read: the whole body at once, under the same timers.
        const all = new Uint8Array(await res.arrayBuffer());
        stats.netBytes += all.byteLength;
        if (received === 0) return persistAndReturn(url, all.buffer, opts, persist);
        if (received + all.byteLength !== buf.byteLength) {
          buf = null; // not resumable: the next try starts over
          throw new Error("Unexpected partial response.");
        }
        buf.set(all, received);
        received += all.byteLength;
      } else {
        const reader = res.body.getReader();
        for (;;) {
          arm();
          const { done, value } = await reader.read();
          if (done) break;
          if (buf && received + value.byteLength > buf.byteLength) {
            // Longer than announced: collect instead.
            chunks = [buf.slice(0, received)];
            buf = null;
          }
          if (buf) buf.set(value, received);
          else chunks.push(value);
          received += value.byteLength;
          stats.netBytes += value.byteLength;
        }
      }
      if (buf && received < buf.byteLength) throw new TypeError("The download ended early.");
      return persistAndReturn(url, buf ? buf.buffer : concat(chunks, received), opts, persist);
    } catch (err) {
      // Failed before the resume began (no answer, an HTTP error): keep the old bytes.
      if (partial) stashPartial(url, partial.buf, partial.received);
      else if (buf) stashPartial(url, buf, received);
      throw ctl.signal.aborted ? ctl.signal.reason : err;
    } finally {
      clearTimeout(stall);
      clearTimeout(ceiling);
      signal?.removeEventListener("abort", onCancel);
      release();
    }
  }

  function persistAndReturn(url, buf, opts, persist) {
    if (persist) store(url, buf, opts);
    return buf;
  }

  // Fire-and-forget (tracked for `idle()` / `flush()`): a failed write only
  // means the next read goes to the network. The table and expiry ride along
  // as headers, so a file whose index entry is lost is adopted correctly.
  function store(url, buf, opts) {
    const p = openCache().then(async (cache) => {
      if (!cache || !writable()) return;
      const max = await budget();
      if (buf.byteLength > max / 4) return;
      try {
        // The body is copied (Fetch "extract a body"), so `buf` stays usable.
        const res = new Response(buf, {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(buf.byteLength),
            "x-wd-table": opts.table ?? "?",
            "x-wd-expire-at": String(expiryOf(opts, Date.now())),
          },
        });
        await withTimeout(cache.put(url, res), CACHE_OP_TIMEOUT_MS * 2, "cache.put");
        writeFailures = 0;
        touch(url, buf.byteLength, opts);
      } catch {
        noteFailure("write");
      }
    });
    pendingStores.add(p);
    p.finally(() => pendingStores.delete(p));
  }

  function startJob(url, opts) {
    const job = { url, ctl: new AbortController(), waiters: 0, settled: false, promise: null };
    job.promise = (async () => {
      const buf = (await fromCacheStorage(url, opts)) ?? (await fromNetwork(url, opts, job.ctl.signal));
      remember(url, buf);
      return buf;
    })();
    const done = () => {
      job.settled = true;
      if (inflight.get(url) === job) inflight.delete(url);
    };
    job.promise.then(done, done);
    inflight.set(url, job);
    return job;
  }

  // Callers share one download per URL (a retry joins its first attempt's).
  // A caller whose signal aborts stops waiting at once; the download stops
  // when no caller is left.
  function join(job, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    job.waiters++;
    return new Promise((resolve, reject) => {
      let waiting = true;
      const leave = () => {
        if (!waiting) return false;
        waiting = false;
        job.waiters--;
        signal?.removeEventListener("abort", onAbort);
        return true;
      };
      const onAbort = () => {
        if (!leave()) return;
        if (job.waiters === 0 && !job.settled) {
          if (inflight.get(job.url) === job) inflight.delete(job.url);
          job.ctl.abort(signal.reason);
        }
        reject(signal.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      job.promise.then(
        (v) => leave() && resolve(v),
        (e) => leave() && reject(e),
      );
    });
  }

  function get(url, opts = {}) {
    const hit = memory.get(url);
    if (hit) {
      memory.delete(url);
      memory.set(url, hit);
      stats.memoryHits++;
      if (index.has(url)) touch(url, hit.byteLength, opts);
      return Promise.resolve(hit);
    }
    return join(inflight.get(url) ?? startJob(url, opts), opts.signal);
  }

  /**
   * Evict files no longer useful (past their expiry, unless `keep` — URLs a
   * current plan still shows — has them), then least recently used, under the
   * budget; save the index.
   */
  async function flush(now = Date.now(), keep = null) {
    await Promise.allSettled([...pendingStores]);
    const cache = await openCache();
    if (!cache || !writable()) return;
    const max = await budget();
    if (readable()) {
      try {
        await syncIndex(cache);
      } catch {
        noteFailure("read");
      }
    }
    try {
      const entries = [...index.values()].sort((a, b) => a.lastUsed - b.lastUsed);
      let total = entries.reduce((n, e) => n + e.bytes, 0);
      const evict = new Set();
      for (const e of entries) {
        if (e.expireAt >= now || keep?.has(e.url)) continue;
        evict.add(e.url);
        total -= e.bytes;
      }
      for (const e of entries) {
        if (total <= max) break;
        if (evict.has(e.url)) continue;
        evict.add(e.url);
        total -= e.bytes;
      }
      for (const url of evict) {
        await withTimeout(cache.delete(url), CACHE_OP_TIMEOUT_MS, "cache.delete");
        index.delete(url);
        indexDirty = true;
      }
      if (indexDirty) {
        // Cleared before the write: a touch landing during it keeps it dirty.
        indexDirty = false;
        const body = JSON.stringify([...index.values()]);
        await withTimeout(
          cache.put(INDEX_KEY, new Response(body, { headers: { "content-type": "application/json" } })),
          CACHE_OP_TIMEOUT_MS,
          "index write",
        );
      }
      writeFailures = 0;
    } catch {
      indexDirty = true;
      noteFailure("write");
    }
  }

  const idle = () => Promise.allSettled([...pendingStores]);

  /** Cache Storage use, for diagnostics. */
  function usage() {
    let bytes = 0;
    for (const e of index.values()) bytes += e.bytes;
    return {
      files: index.size,
      bytes,
      memoryFiles: memory.size,
      memoryBytes,
      partialFiles: partials.size,
      available: readable() && writable(),
    };
  }

  return { get, flush, idle, stats, usage };
}

// ── Extracts (IndexedDB) ─────────────────────────────────────────────────────

const DB_NAME = "wd-iceberg";
const DB_VERSION = 1;
const STORE = "extracts";

/**
 * Per-wallet extraction cache: key `[cacheKey, fileUrl]` → the wallet's
 * normalized rows from that file plus per-file meta. Tiny next to the file.
 * `cacheKey` is the engine's: wallet keys hash, table and the table's extract
 * `format`, so a format change misses instead of serving old-shaped rows.
 * Every record carries `expireAt` (the file's usefulness, like the byte
 * cache) and `purge()` drops expired ones, for every wallet.
 */
export function createExtractCache() {
  let failures = 0;
  let dbPromise = null;
  const stats = { hits: 0, writes: 0, errors: 0 };

  const usable = () => typeof indexedDB !== "undefined" && failures < MAX_STORE_FAILURES;

  function fail() {
    failures++;
    stats.errors++;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = withTimeout(
      new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: "id" });
            store.createIndex("expireAt", "expireAt");
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          // Let a newer build's upgrade through instead of blocking it.
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("indexedDB blocked"));
      }),
      IDB_TIMEOUT_MS,
      "indexedDB open",
    );
    // Retry on the next call instead of holding a rejected promise.
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  async function run(label, mode, body) {
    if (!usable()) return null;
    try {
      const result = await withTimeout(
        (async () => {
          const db = await openDb();
          return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const out = body(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(out);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
        })(),
        IDB_TIMEOUT_MS,
        `indexedDB ${label}`,
      );
      failures = 0;
      return result;
    } catch {
      fail();
      return null;
    }
  }

  /** Map fileUrl → { rows, meta } for the URLs already extracted under `key`. */
  async function getMany(key, urls) {
    const found = new Map();
    if (!urls.length) return found;
    await run("read", "readonly", (store) => {
      for (const url of urls) {
        const req = store.get([key, url]);
        req.onsuccess = () => {
          const v = req.result;
          if (v) found.set(url, { rows: v.rows, meta: v.meta });
        };
      }
    });
    stats.hits += found.size;
    return found;
  }

  function put(key, url, value, expireAt) {
    stats.writes++;
    return run("write", "readwrite", (store) => {
      store.put({ id: [key, url], rows: value.rows, meta: value.meta, expireAt });
    });
  }

  function remove(key, urls) {
    if (!urls.length) return Promise.resolve(null);
    return run("delete", "readwrite", (store) => {
      for (const url of urls) store.delete([key, url]);
    });
  }

  /** Drop every wallet's records past their usefulness, except files in `keep` (still shown). */
  function purge(now = Date.now(), keep = null) {
    return run("purge", "readwrite", (store) => {
      const req = store.index("expireAt").openCursor(IDBKeyRange.upperBound(now));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (!keep?.has(cursor.value.id[1])) cursor.delete();
        cursor.continue();
      };
    });
  }

  return { getMany, put, remove, purge, stats };
}
