// The Mobile activity engine: keeps one wallet's view of Helium's Mobile
// network tables current. Runs in a Web Worker (mobileWorker.js).
//
// Each check loads every table's head up front, in parallel, then reads the
// tables in REFRESH_STEPS order, the next table planning (metadata only)
// while the current one's files download (failures isolated per table, one
// retry):
//   1. Load the table head. An unchanged snapshot reuses the last plan.
//   2. Otherwise plan the window's data files from the current snapshot.
//   3. File-set diff: extract only files not already extracted, drop extracted
//      files no longer in the plan (aged out of the window, or replaced by the
//      daily compaction). No lineage walk: the plan is the truth.
//   4. Extract: whole file (byte cache), wallet's keys by Set, window filter.
// Then every table's windowed rows assemble into the hook's contract; a
// section is re-assembled only when its rows change, so an unchanged one
// keeps its identity. At the end of a check, each table whose file set moved
// diffs its rows, as multisets of row ids, against its last check's: keys
// with rows that weren't there before are this check's arrivals. A
// compaction rewrites the same rows into a new file, so it never reads as
// new data.
//
// Each table keeps `checkedAt` (its last check, ok or not) and `okAt` (its
// last successful one). A sliding window ends at now only while its table is
// fresh (FRESH_MS); after a failed or overdue check it stays frozen at `okAt`,
// so it never drains into false "no heartbeat" verdicts. Each sliding table
// names its window's end as `tables[name].until`.
//
// A wallet switch or `stop()` cancels the running check: it returns at its
// next step and its downloads are aborted (a download another caller still
// waits for carries on; see storage.js).
import { sleep } from "../../lib/utils.js";
import { cancelledError, createByteCache, createExtractCache } from "./storage.js";
import { extractFile, fileInWindow, loadTableHead, mapLimit, planTable } from "./iceberg.js";
import { REFRESH_STEPS, TABLES } from "./tables.js";
import { FRESH_MS, TABLE_NAMES, WIFI_TABLES } from "./tableMeta.js";

// Files in progress per table (download, then decode). The byte cache
// schedules the downloads themselves by size.
const EXTRACT_CONCURRENCY = 5;
// A plan this large is a malfunction (a normal window is ≤ ~20 MB).
const TABLE_BYTE_CAP = 80_000_000;
const RETRY_DELAY_MS = 1500;

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
function hashKeys(keys) {
  const s = [...keys].sort().join("\n");
  return `${cyrb53(s, 1).toString(36)}${cyrb53(s, 2).toString(36)}`;
}

const newTable = () => ({
  status: "loading",
  error: undefined,
  checkedAt: undefined, // last check, ok or not
  okAt: undefined, // last successful check
  plan: null,
  extracts: new Map(),
  // Bumped whenever the plan or the extracted file set changes.
  version: 0,
  // The last assembled section, and the sig it was assembled for.
  section: null,
  sig: null,
  // The arrival baseline: row id → count, taken at version `idsVersion`.
  ids: null,
  idsVersion: -1,
});

// A sliding window ends now while its table is fresh, else at its last good check.
function windowEnd(t, at) {
  const fresh = t.status === "ok" && t.okAt != null && at - t.okAt <= FRESH_MS;
  return fresh ? at : (t.okAt ?? at);
}

function countSince(t, since) {
  let n = 0;
  for (const e of t.extracts.values()) for (const r of e.rows) if (r.at >= since) n++;
  return n;
}

// A table's windowed rows: every extracted row, or those at or after `since`.
function rowsOf(t, since) {
  const rows = [];
  for (const e of t.extracts.values()) {
    for (const r of e.rows) if (since == null || r.at >= since) rows.push(r);
  }
  return rows;
}

function priceByDay(t) {
  const out = new Map();
  for (const [url, e] of t.extracts) {
    const day = t.plan.files.get(url)?.day;
    if (day && e.meta?.price != null) out.set(day, e.meta.price);
  }
  return out;
}

function dayState(t, day, failed) {
  if (!t.plan.present.has(day)) return "missing";
  for (const f of t.plan.files.values()) {
    if (f.day === day && !t.extracts.has(f.url)) return failed ? "failed" : "loading";
  }
  return "ok";
}

export function createEngine() {
  const bytes = createByteCache();
  const extracts = createExtractCache();
  // Plans are wallet-independent, so they're kept across wallet switches:
  // per table, its latest snapshot's (see ensurePlan).
  const plans = new Map();
  // Cache writes and cleanup still in flight (`settle()`).
  const pending = new Set();
  let epoch = 0;
  let run = new AbortController(); // the current wallet's checks
  let wallet = null;
  let keySet = new Set();
  let keyIndex = new Map(); // entity key → its index, so row ids stay short
  let keysHash = null;
  let tables = new Map();
  let arrivals = { seq: 0, byTable: {} };
  let live = false;
  let running = null; // the running check's promise

  function activeNames(wifi) {
    return TABLE_NAMES.filter((name) => wifi || !WIFI_TABLES.includes(name));
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
    keyIndex = new Map([...keySet].map((k, i) => [k, i]));
    keysHash = nextWallet ? hashKeys(keySet) : null;
    live = false;
    arrivals = { seq: 0, byTable: {} };
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

  // The plan for a table head's snapshot, shared while it loads. One still
  // loading for a cancelled check isn't shared: it is about to reject with
  // the cancellation.
  function ensurePlan(name, head, signal) {
    const prev = plans.get(name);
    if (prev?.snapshotId === head.snapshotId && (prev.settled || !prev.signal.aborted)) return prev.promise;
    const entry = { snapshotId: head.snapshotId, signal, settled: false };
    entry.promise = planTable(TABLES[name], head, bytes, Date.now(), { signal });
    entry.promise.then(
      () => {
        entry.settled = true;
      },
      () => plans.get(name) === entry && plans.delete(name),
    );
    plans.set(name, entry);
    return entry.promise;
  }

  // One attempt at one table. Throws on failure; returns false if superseded.
  // The new file set is staged and swapped in only once complete, so a failed
  // check keeps the last good window (frozen at its okAt).
  async function checkTable(name, head, { backfill }, myEpoch, signal) {
    const spec = TABLES[name];
    const t = tables.get(name);
    const plan = await ensurePlan(name, head, signal);
    if (myEpoch !== epoch) return false;
    const at = Date.now();
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
      const value = await extractFile(spec, plan, f, keySet, bytes, Date.now(), { signal });
      if (myEpoch !== epoch) return;
      next.set(f.url, value);
      track(extracts.put(key, f.url, value, f.expireAt ?? Date.now() + spec.retainMs));
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
    let head = headResult;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(RETRY_DELAY_MS);
          if (myEpoch !== epoch) return;
          head = await loadTableHead(TABLES[name], { signal });
        }
        if (head instanceof Error) throw head;
        if (!(await checkTable(name, head, step, myEpoch, signal))) return;
        t.status = "ok";
        t.error = undefined;
        t.checkedAt = t.okAt = Date.now();
        return;
      } catch (err) {
        if (myEpoch !== epoch) return;
        if (err?.capExceeded || attempt === 1) {
          console.warn(`[wallet-dashboard] ${TABLES[name].ref}:`, err);
          t.status = "error";
          t.error = describeError(err);
          t.checkedAt = Date.now();
          return;
        }
      }
    }
  }

  // Row ids name the Hotspot by its index, not its 366-char key. `fresh`:
  // keys with more copies of a row than the baseline `prev` had.
  function diffRows(spec, rows, prev) {
    const ids = new Map();
    const fresh = new Set();
    for (const r of rows) {
      const id = `${keyIndex.get(r.k)}|${spec.rowId(r)}`;
      const n = (ids.get(id) ?? 0) + 1;
      ids.set(id, n);
      if (prev && n > (prev.get(id) ?? 0)) fresh.add(r.k);
    }
    return { ids, fresh };
  }

  /**
   * Assemble the contract from every table's windowed rows. A section is
   * re-assembled only when its sig moves: the table's file set (`version`),
   * plus for a sliding table the count of its rows in the window (with the
   * files fixed, the count pins them down: between two assembles the window's
   * start moves one way). `commit` (a check's end): each ok table whose file
   * set moved since its baseline takes these rows as the new baseline, and
   * with `detect` reports keys with rows the old one didn't have as arrivals.
   */
  function assemble({ commit = false, detect = false } = {}) {
    const at = Date.now();
    const out = {
      wallet,
      checkedAt: null,
      live,
      tables: {},
      rewards: null,
      usage: null,
      heartbeats: null,
      invalidHeartbeats: null,
      speedtests: null,
      bans: null,
      arrivals: null,
    };
    const byTable = {};
    for (const [name, t] of tables) {
      const spec = TABLES[name];
      const entry = (out.tables[name] = { state: t.status });
      if (t.error) entry.error = t.error;
      if (t.checkedAt) {
        entry.checkedAt = t.checkedAt;
        out.checkedAt = Math.max(out.checkedAt ?? 0, t.checkedAt);
      }
      if (t.okAt) entry.okAt = t.okAt;
      if (!t.plan) continue;
      // Planned files still unread are "failed" once this table's check has
      // given up on them: at the end of a check (`commit`, while it still
      // counts as running) or between checks.
      const failed = t.status === "error" && (commit || !running);
      let since = null;
      let sig = `${t.version}:${failed}`;
      if (spec.window.kind === "sliding") {
        entry.until = windowEnd(t, at);
        since = entry.until - spec.window.ms;
        sig += `:${countSince(t, since)}`;
      }
      let rows = null;
      if (sig !== t.sig) {
        rows = rowsOf(t, since);
        t.section = spec.assemble(rows, {
          days: t.plan.days,
          priceByDay: priceByDay(t),
          dayState: (day) => dayState(t, day, failed),
        });
        t.sig = sig;
      }
      out[name] = t.section;
      if (commit && t.status === "ok" && t.idsVersion !== t.version) {
        const { ids, fresh } = diffRows(spec, rows ?? rowsOf(t, since), detect ? t.ids : null);
        if (fresh.size) byTable[name] = [...fresh];
        t.ids = ids;
        t.idsVersion = t.version;
      }
    }
    if (Object.keys(byTable).length) arrivals = { seq: arrivals.seq + 1, byTable };
    out.arrivals = arrivals;
    return out;
  }

  // Files the wallet's tables still show or plan: never evicted for age
  // (an upstream append that runs late keeps a "days" file on screen past
  // its expiry). The byte budget still applies.
  function keepSet() {
    const keep = new Set();
    const at = Date.now();
    for (const [name, t] of tables) {
      for (const url of t.extracts.keys()) keep.add(url);
      for (const f of t.plan?.files.values() ?? []) if (fileInWindow(TABLES[name], f, at)) keep.add(f.url);
    }
    return keep;
  }

  /**
   * One check of every table; a wallet switch or stop abandons it at the
   * next step. During a wallet's first check, `onProgress(getState)` fires
   * after each step (`getState()` assembles the partial state, no arrivals).
   */
  async function refresh({ onProgress } = {}) {
    const myEpoch = epoch;
    const { signal } = run;
    // A previous wallet's check was cancelled; let it settle first.
    const previous = running;
    const promise = (async () => {
      if (previous) await previous.catch(() => {});
      if (myEpoch !== epoch) return assemble();
      const names = [...tables.keys()];
      // Heads up front, in parallel: unchanged tables are 304s.
      const heads = new Map(
        await Promise.all(
          names.map((n) => loadTableHead(TABLES[n], { signal }).then((h) => [n, h], (e) => [n, e])),
        ),
      );
      const plan = (name, head) => (head instanceof Error ? Promise.reject(head) : ensurePlan(name, head, signal));
      for (const [i, step] of REFRESH_STEPS.entries()) {
        if (myEpoch !== epoch) return assemble();
        const t = tables.get(step.table);
        if (!t || (step.backfill && t.status === "error")) continue;
        // The rewards backfill reuses this check's plan: no second head.
        const head = step.backfill ? (t.plan ?? heads.get(step.table)) : heads.get(step.table);
        // Once this table is planned, the next one plans (metadata only)
        // while this one's files download, queued behind them.
        const next = REFRESH_STEPS[i + 1]?.table;
        plan(step.table, head)
          .then(() => myEpoch === epoch && tables.has(next) && plan(next, heads.get(next)))
          .catch(() => {});
        await refreshTable(step.table, head, step, myEpoch, signal);
        if (myEpoch === epoch && !live) onProgress?.(assemble);
      }
      if (myEpoch !== epoch) return assemble();
      const firstForWallet = !live;
      live = true;
      const state = assemble({ commit: true, detect: !firstForWallet });
      const keep = keepSet();
      track(bytes.flush(Date.now(), keep));
      track(extracts.purge(Date.now(), keep));
      return state;
    })();
    running = promise;
    try {
      return await promise;
    } finally {
      if (running === promise) running = null;
    }
  }

  /**
   * Slide the windows between checks. Returns the new state, or null when no
   * section changed (or a check is running; its end assembles anyway).
   */
  function reassemble() {
    if (running || !live) return null;
    const before = [...tables.values()].map((t) => t.section);
    const state = assemble();
    return [...tables.values()].some((t, i) => t.section !== before[i]) ? state : null;
  }

  /** Settles once this engine's cache writes and cleanup have (a one-shot check waits on it). */
  function settle() {
    return Promise.allSettled([...pending, bytes.idle()]);
  }

  return { setWallet, stop, refresh, reassemble, state: () => assemble(), settle };
}
