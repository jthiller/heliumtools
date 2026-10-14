// The Mobile activity engine: keeps one wallet's view of Helium's Mobile
// network tables current. Runs in a Web Worker (mobileWorker.js) and, for
// checks, in Node (no Cache Storage / IndexedDB there: memory only).
//
// Each check, table by table (failures isolated per table, one retry):
//   1. Load the table head. An unchanged snapshot reuses the last plan.
//   2. Otherwise plan the window's data files from the current snapshot.
//   3. File-set diff: extract only files not already extracted, drop extracted
//      files no longer in the plan (aged out of the window, or replaced by the
//      daily compaction). No lineage walk: the plan is the truth.
//   4. Extract: whole file (byte cache), wallet's keys by Set, window filter.
// Then assemble every table's windowed rows into the hook's contract and
// diff them, as multisets of row ids, against the last check's: keys with
// rows that weren't there before are this check's arrivals. A compaction
// rewrites the same rows into a new file, so it never reads as new data.
//
// Each table keeps `checkedAt` (its last check, ok or not) and `okAt` (its
// last successful one). A sliding window ends at now only while its table is
// fresh (FRESH_MS); after a failed or overdue check it stays frozen at `okAt`,
// so it never drains into false "no heartbeat" verdicts. Sections name their
// window's end as `until`.
//
// A wallet switch or `stop()` cancels the running check: it returns at its
// next step and its downloads are aborted (a download another caller still
// waits for carries on; see storage.js).
import { cancelledError, createByteCache, createExtractCache } from "./storage.js";
import { extractFile, fileInWindow, loadTableHead, mapLimit, planTable } from "./iceberg.js";
import { FRESH_MS, REFRESH_STEPS, TABLES, TABLE_NAMES } from "./tables.js";

// Files in progress per table (download, then decode). The byte cache
// schedules the downloads themselves by size.
const EXTRACT_CONCURRENCY = 5;
// A plan this large is a malfunction (a normal window is ≤ ~20 MB).
const TABLE_BYTE_CAP = 80_000_000;
const RETRY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A short, user-facing reason for a failed table check. */
function describeError(err) {
  if (err?.capExceeded) return err.message;
  if (err?.name === "TimeoutError" || /timed out/i.test(err?.message || "")) return "The request timed out.";
  if (err?.status === 429) return "Too many requests. Trying again shortly.";
  if (err?.status >= 500) return `The data service is unavailable (HTTP ${err.status}).`;
  if (err?.status) return `The data service answered HTTP ${err.status}.`;
  if (err instanceof TypeError) return "Network error.";
  return "Couldn't read the data.";
}

// cyrb53 (a fast 53-bit string hash), twice with different seeds: the
// extraction cache's wallet key. Synchronous, and needs no secure context.
function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A stable id for a set of keys (order-insensitive). */
export function hashKeys(keys) {
  const s = [...keys].sort().join("\n");
  return `${cyrb53(s, 1).toString(36)}${cyrb53(s, 2).toString(36)}`;
}

function countIds(spec, rows) {
  const ids = new Map();
  for (const r of rows) {
    const id = spec.rowId(r);
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  return ids;
}

const newTable = () => ({
  status: "loading",
  error: undefined,
  checkedAt: undefined, // last check, ok or not
  okAt: undefined, // last successful check
  plan: null,
  extracts: new Map(),
  prevIds: null,
  // Bumped whenever the plan or the extracted file set changes.
  version: 0,
});

/**
 * @param {object} [opts]
 * @param {ReturnType<typeof createByteCache>} [opts.bytes]
 * @param {ReturnType<typeof createExtractCache>} [opts.extracts]
 * @param {() => number} [opts.now]
 */
export function createEngine({ bytes = createByteCache(), extracts = createExtractCache(), now = () => Date.now() } = {}) {
  // Plans are wallet-independent: kept across wallet switches.
  const plans = new Map();
  // Cache writes and cleanup still in flight (`settle()`).
  const pending = new Set();
  let epoch = 0;
  let run = new AbortController(); // the current wallet's checks
  let wallet = null;
  let keySet = new Set();
  let keysHash = null;
  let tables = new Map();
  let arrivals = { seq: 0, at: 0, byTable: {} };
  let live = false;
  let running = null;
  let lastWindowSig = "";

  function activeNames(wifi) {
    return TABLE_NAMES.filter((name) => wifi || !TABLES[name].wifiOnly);
  }

  function track(p) {
    if (!p) return;
    const done = () => pending.delete(p);
    pending.add(p);
    p.then(done, done);
  }

  // Ends the current wallet's checks: they return at their next step, and
  // their downloads are aborted.
  function cancel() {
    epoch++;
    run.abort(cancelledError());
    run = new AbortController();
  }

  function reset(nextWallet, keys, names) {
    wallet = nextWallet;
    keySet = new Set(keys);
    keysHash = nextWallet ? hashKeys(keySet) : null;
    live = false;
    arrivals = { seq: 0, at: 0, byTable: {} };
    lastWindowSig = "";
    tables = new Map(names.map((name) => [name, newTable()]));
  }

  /**
   * Switch to a wallet. `keys` are its Mobile Hotspots' entity keys; `wifi`
   * whether any is a WiFi indoor/outdoor Hotspot (heartbeats, speedtests).
   */
  function setWallet(nextWallet, keys, { wifi = true } = {}) {
    cancel();
    reset(nextWallet, keys, activeNames(wifi));
  }

  /** No wallet on screen: cancel the running check and forget the wallet. */
  function stop() {
    cancel();
    reset(null, [], []);
  }

  // IndexedDB key for this wallet's extracts of a table, in its row format.
  const extractKey = (name) => `${keysHash}:${name}:v${TABLES[name].format}`;

  async function ensurePlan(name, head, signal) {
    const spec = TABLES[name];
    const prev = plans.get(name);
    if (prev && prev.snapshotId === head.snapshotId) return prev;
    const plan = await planTable(spec, head, bytes, now(), { signal });
    plans.set(name, plan);
    return plan;
  }

  // One attempt at one table. Throws on failure; returns false if superseded.
  // The new file set is staged and swapped in only once complete, so a failed
  // check keeps the last good window (frozen at its okAt).
  async function checkTable(name, head, { backfill }, myEpoch, signal) {
    const spec = TABLES[name];
    const t = tables.get(name);
    const plan = await ensurePlan(name, head, signal);
    if (myEpoch !== epoch) return false;
    const at = now();
    const key = extractKey(name);
    const next = new Map();
    const todo = [];
    for (const f of plan.files.values()) {
      if (!fileInWindow(spec, f, at)) continue;
      const have = t.extracts.get(f.url);
      if (have) next.set(f.url, have);
      else if (backfill || f.priority === 0) todo.push(f);
    }
    todo.sort((a, b) => (b.timeUpper ?? 0) - (a.timeUpper ?? 0));
    const cached = await extracts.getMany(key, todo.map((f) => f.url));
    if (myEpoch !== epoch) return false;
    for (const [url, value] of cached) next.set(url, value);
    const toRead = todo.filter((f) => !cached.has(f.url));
    const total = toRead.reduce((n, f) => n + f.size, 0);
    if (total > TABLE_BYTE_CAP) {
      throw Object.assign(new Error(`Too much data to load for this window (${Math.round(total / 1e6)} MB).`), {
        capExceeded: true,
      });
    }
    // Newest first; each file is cached (bytes and extract) as it finishes,
    // so an attempt that fails partway still leaves its finished files.
    await mapLimit(toRead, EXTRACT_CONCURRENCY, async (f) => {
      if (myEpoch !== epoch) return;
      const value = await extractFile(spec, plan, f, keySet, bytes, now(), { signal });
      if (myEpoch !== epoch) return;
      next.set(f.url, value);
      track(extracts.put(key, f.url, value, f.expireAt ?? now() + spec.retainMs));
    });
    if (myEpoch !== epoch) return false;
    // Dropped: aged out of the window, or replaced by a compaction.
    const dropped = [...t.extracts.keys()].filter((url) => !next.has(url));
    if (dropped.length) track(extracts.remove(key, dropped));
    const added = [...next.keys()].some((url) => !t.extracts.has(url));
    if (plan !== t.plan || added || dropped.length) t.version++;
    t.extracts = next;
    t.plan = plan;
    return true;
  }

  async function refreshTable(name, headResult, step, myEpoch, signal) {
    const t = tables.get(name);
    if (!t) return;
    let head = headResult;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(RETRY_DELAY_MS);
          if (myEpoch !== epoch) return;
          head = await loadTableHead(TABLES[name].ref, { signal });
        }
        if (head instanceof Error) throw head;
        if (!(await checkTable(name, head, step, myEpoch, signal))) return;
        t.status = "ok";
        t.error = undefined;
        t.checkedAt = t.okAt = now();
        return;
      } catch (err) {
        if (myEpoch !== epoch) return;
        if (err?.capExceeded || attempt === 1) {
          console.warn(`[wallet-dashboard] ${TABLES[name].ref}:`, err);
          t.status = "error";
          t.error = describeError(err);
          t.checkedAt = now();
          return;
        }
      }
    }
  }

  /**
   * Assemble the contract from every table's windowed rows.
   * `commit`: record these rows as the baseline the next check diffs against;
   * `detect`: report keys with new rows as arrivals (live updates only).
   * `sig` (not part of the contract) changes exactly when a section's
   * content does, apart from a sliding section's `until`: the worker posts
   * only the sections whose `sig` moved.
   */
  function assemble({ commit = false, detect = false } = {}) {
    const at = now();
    const out = {
      wallet,
      checkedAt: null,
      tables: {},
      rewards: null,
      usage: null,
      heartbeats: null,
      invalidHeartbeats: null,
      speedtests: null,
      bans: null,
      sig: {},
    };
    const byTable = {};
    const windowSig = [];
    for (const [name, t] of tables) {
      const spec = TABLES[name];
      const entry = (out.tables[name] = { state: t.status });
      if (t.error) entry.error = t.error;
      if (t.checkedAt) {
        entry.checkedAt = t.checkedAt;
        out.checkedAt = Math.max(out.checkedAt ?? 0, t.checkedAt);
      }
      if (t.okAt) entry.okAt = t.okAt;
      const plan = t.plan;
      if (!plan) continue;
      const rows = [];
      let end = at;
      if (spec.window.kind === "sliding") {
        // Fresh: the window ends now. Otherwise it stays at the last good check.
        const fresh = t.status === "ok" && t.okAt != null && at - t.okAt <= FRESH_MS;
        if (!fresh) end = t.okAt ?? at;
        const since = end - spec.window.ms;
        for (const e of t.extracts.values()) for (const r of e.rows) if (r.at >= since) rows.push(r);
        // The rows kept are those at or after `since`, so with the file set
        // fixed their count pins them down exactly.
        out.sig[name] = `${t.version}:${rows.length}`;
        windowSig.push(`${name}:${out.sig[name]}`);
      } else {
        for (const e of t.extracts.values()) for (const r of e.rows) rows.push(r);
        out.sig[name] = String(t.version);
      }
      out[name] = spec.assemble(rows, {
        now: end,
        days: plan.days,
        priceByDay: priceByDay(plan, t),
        // A planned day not yet read is "loading" while a check runs and
        // "failed" once the table's last check has given up on it.
        dayState: (day) => dayState(plan, t, day, !running && t.status === "error"),
      });
      if (commit && t.status === "ok") {
        const ids = countIds(spec, rows);
        if (detect && t.prevIds) {
          const keys = new Set();
          for (const r of rows) {
            const id = spec.rowId(r);
            if ((ids.get(id) || 0) > (t.prevIds.get(id) || 0)) keys.add(r.k);
          }
          if (keys.size) byTable[name] = [...keys];
        }
        t.prevIds = ids;
      }
    }
    if (Object.keys(byTable).length) arrivals = { seq: arrivals.seq + 1, at, byTable };
    out.arrivals = arrivals;
    out.live = live;
    out.refreshing = running != null;
    lastWindowSig = windowSig.join(",");
    return out;
  }

  function priceByDay(plan, t) {
    const out = new Map();
    for (const [url, e] of t.extracts) {
      const day = plan.files.get(url)?.day;
      if (day && e.meta?.price != null) out.set(day, e.meta.price);
    }
    return out;
  }

  function dayState(plan, t, day, failed) {
    if (!plan.present.has(day)) return "missing";
    for (const f of plan.files.values()) if (f.day === day && !t.extracts.has(f.url)) return failed ? "failed" : "loading";
    return "ok";
  }

  // Files the wallet's tables still show or plan: never evicted for age
  // (an upstream append that runs late keeps a "days" file on screen past
  // its expiry). The byte budget still applies.
  function keepSet() {
    const keep = new Set();
    const at = now();
    for (const [name, t] of tables) {
      for (const url of t.extracts.keys()) keep.add(url);
      for (const f of t.plan?.files.values() ?? []) if (fileInWindow(TABLES[name], f, at)) keep.add(f.url);
    }
    return keep;
  }

  /**
   * One check of every table. Concurrent calls share the run; a wallet switch
   * or stop abandons it at the next step. `onProgress(state)` fires after
   * each step with a partial assembly (no arrivals).
   */
  async function refresh({ onProgress } = {}) {
    const myEpoch = epoch;
    if (running?.epoch === myEpoch) return running.promise;
    const { signal } = run;
    // A previous wallet's run was cancelled; let it settle first.
    const previous = running?.promise;
    const promise = (async () => {
      if (previous) await previous.catch(() => {});
      if (myEpoch !== epoch) return assemble();
      const names = [...tables.keys()];
      // Heads up front, in parallel: unchanged tables are 304s.
      const heads = new Map(
        await Promise.all(
          names.map((n) => loadTableHead(TABLES[n].ref, { signal }).then((h) => [n, h], (e) => [n, e])),
        ),
      );
      for (const step of REFRESH_STEPS) {
        if (myEpoch !== epoch) return assemble();
        if (!tables.has(step.table)) continue;
        // The rewards backfill reuses this check's plan: no second head.
        const head = step.backfill ? tables.get(step.table).plan ?? heads.get(step.table) : heads.get(step.table);
        if (step.backfill && tables.get(step.table).status === "error") continue;
        await refreshTable(step.table, head, step, myEpoch, signal);
        if (myEpoch === epoch) onProgress?.(assemble());
      }
      if (myEpoch !== epoch) return assemble();
      const firstForWallet = !live;
      live = true;
      const state = assemble({ commit: true, detect: !firstForWallet });
      const keep = keepSet();
      track(bytes.flush(now(), keep));
      track(extracts.purge(now(), keep));
      return state;
    })();
    running = { epoch: myEpoch, promise };
    try {
      return await promise;
    } finally {
      if (running?.promise === promise) running = null;
    }
  }

  /**
   * Slide the windows between checks. Returns the new state, or null when no
   * windowed row moved (or a check is running; its end assembles anyway).
   */
  function reassemble() {
    if (running || !live) return null;
    const before = lastWindowSig;
    const state = assemble({ commit: true });
    return lastWindowSig === before ? null : state;
  }

  /** Settles once this engine's cache writes and cleanup have (a one-shot check waits on it). */
  function settle() {
    return Promise.allSettled([...pending, bytes.idle?.()]);
  }

  return {
    setWallet,
    stop,
    refresh,
    reassemble,
    state: () => assemble(),
    settle,
    stats: { bytes: bytes.stats, extracts: extracts.stats },
    usage: () => bytes.usage(),
  };
}
