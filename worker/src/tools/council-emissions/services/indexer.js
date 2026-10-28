// The council indexer, run on the FAST_CRON (*/15) tick. Per run:
//   1. poll every cursor's signatures (forward with `until`, backward to its
//      window start while backfilling), queueing new ones in ce_pending
//   2. fetch up to DECODE_BUDGET_PER_RUN pending transactions in JSON-RPC
//      batches and store their parsed records in ce_tx
//   3. once a day, discover each seat's other HNT token accounts
//   4. read live balances and the fanout account
//   5. replay the trace from D1 (pure), look up identities for new
//      counterparties, replay again, and add cursors for wallets to follow
//   6. write the KV views viewers read
// Viewers never reach the RPC. Everything is idempotent, so an overlapping or
// half-finished run only costs a repeat.

import { kvGetJson, kvPutJson, withKvLock } from "../../../lib/kv.js";
import {
  ACCOUNT_DISCOVERY_MS,
  CLASSIFIER_VERSION,
  DECODE_BUDGET_PER_RUN,
  FANOUT,
  HNT_MINT,
  IDENTITY_LOOKUPS_PER_RUN,
  IDENTITY_MISS_TTL_MS,
  IDENTITY_TTL_MS,
  INDEX_ENABLED,
  KV,
  LOCK_TTL_SECONDS,
  NODE_SIG_CAP,
  RPC_BATCH,
  SIG_PAGE,
} from "../config.js";
import { makeLabelResolver } from "../labels.js";
import * as db from "./db.js";
import { decodeMiniFanout } from "./fanout.js";
import { parseTransaction, RECORD_VERSION } from "./parse.js";
import {
  getAccountData,
  getIdentity,
  getOwnerTokenAccounts,
  getSignatures,
  getTokenBalances,
  getTransactionCall,
  rpcBatch,
} from "./rpc.js";
import { buildViews } from "./snapshot.js";
import { replayTrace } from "./trace.js";

const MAX_BACKFILL_PAGES = 3;
const MAX_FORWARD_PAGES = 3;

function inWindow(cursor, sig) {
  if (cursor.from_slot != null) return sig.slot >= cursor.from_slot;
  return (sig.blockTime ?? Infinity) >= (cursor.from_time ?? FANOUT.createdAt);
}

/** Poll one cursor; returns { successes, failures } signature entries. */
async function pollCursor(env, cursor) {
  const successes = [];
  const failures = [];
  // A downstream account busier than NODE_SIG_CAP is an exchange, protocol or
  // bot: it is marked busy before any of its history is queued, so none of it
  // is fetched (the trace stops at it as "Not traced further").
  const overCap = (n) => cursor.role === "node_token" && cursor.sig_count + n > NODE_SIG_CAP;
  const markBusy = () => {
    cursor.busy = 1;
    cursor.backfill_done = 1;
  };
  const take = (sigs) => {
    for (const s of sigs) (s.err ? failures : successes).push(s);
  };

  if (cursor.newest_sig) {
    // Forward: everything newer than the last signature seen.
    let before;
    for (let i = 0; i < MAX_FORWARD_PAGES; i++) {
      const page = await getSignatures(env, cursor.address, { until: cursor.newest_sig, before });
      if (overCap(page.length)) {
        markBusy();
        return { successes: [], failures: [] };
      }
      if (i === 0 && page.length) cursor.next_newest = page[0].signature;
      take(page);
      cursor.sig_count += page.length;
      if (page.length < SIG_PAGE) break;
      before = page[page.length - 1].signature;
    }
    if (cursor.next_newest) cursor.newest_sig = cursor.next_newest;
  }

  if (!cursor.backfill_done) {
    // Backward from the oldest signature seen until the window start.
    for (let i = 0; i < MAX_BACKFILL_PAGES && !cursor.backfill_done; i++) {
      const page = await getSignatures(env, cursor.address, { before: cursor.oldest_sig || undefined });
      if (!cursor.newest_sig && page.length) cursor.newest_sig = page[0].signature;
      const inside = page.filter((s) => inWindow(cursor, s));
      if (overCap(inside.length)) {
        markBusy();
        return { successes: [], failures: [] };
      }
      take(inside);
      cursor.sig_count += inside.length;
      if (page.length) cursor.oldest_sig = page[page.length - 1].signature;
      if (page.length < SIG_PAGE || inside.length < page.length) cursor.backfill_done = 1;
    }
  }
  return { successes, failures };
}

async function fetchPending(env, budget) {
  const sigs = await db.nextPending(env, budget);
  let stored = 0;
  for (let i = 0; i < sigs.length; i += RPC_BATCH) {
    const chunk = sigs.slice(i, i + RPC_BATCH);
    const results = await rpcBatch(env, chunk.map(getTransactionCall));
    const records = [];
    const dropped = [];
    results.forEach((res, j) => {
      if (res.error) return; // stays pending for the next run
      if (!res.result) return; // not available yet
      const record = parseTransaction(chunk[j], res.result);
      if (record) records.push(record);
      else dropped.push(chunk[j]);
    });
    await db.storeRecords(env, records, RECORD_VERSION, dropped);
    stored += records.length;
  }
  return stored;
}

async function discoverSeatAccounts(env, cursors) {
  const meta = (await kvGetJson(env, KV.meta)) || {};
  if (meta.discoveredAt && Date.now() - meta.discoveredAt < ACCOUNT_DISCOVERY_MS) return [];
  const known = new Set(cursors.map((c) => c.address));
  const seats = [...new Set(cursors.filter((c) => c.role === "seat_token").map((c) => c.owner))];
  const requests = [];
  for (const owner of seats) {
    for (const account of await getOwnerTokenAccounts(env, owner, HNT_MINT)) {
      if (!known.has(account)) requests.push({ account, owner, depth: 0, role: "seat_token", fromTime: FANOUT.createdAt });
    }
  }
  await db.addCursors(env, requests);
  await kvPutJson(env, KV.meta, { ...meta, discoveredAt: Date.now() });
  return requests;
}

async function lookupIdentities(env, addresses, learned) {
  const now = Date.now();
  const due = addresses.filter((a) => {
    const cached = learned[a];
    if (!cached) return true;
    return now - (cached.fetchedAt || 0) > (cached.none ? IDENTITY_MISS_TTL_MS : IDENTITY_TTL_MS);
  }).slice(0, IDENTITY_LOOKUPS_PER_RUN);
  let changed = 0;
  for (const address of due) {
    const identity = await getIdentity(env, address);
    if (!identity) continue;
    await db.saveLabel(env, address, identity);
    learned[address] = { ...identity, fetchedAt: now };
    changed += 1;
  }
  return changed;
}

function cursorMap(rows) {
  return Object.fromEntries(rows.map((c) => [c.address, {
    role: c.role, owner: c.owner, depth: c.depth, busy: !!c.busy, backfillDone: !!c.backfill_done, liveRaw: c.live_raw,
    fromSlot: c.from_slot,
  }]));
}

/**
 * Replay from D1 and write the KV views. With `withRpc`, also looks up
 * identities for new counterparties and registers newly followed accounts.
 * Without it (admin reclassify, cold reads) it makes no RPC call.
 */
export async function rebuild(env, { withRpc = false, fanout } = {}) {
  await db.ensureSchema(env);
  let cursors = await db.loadCursors(env);
  const [records, failed, pending, stats] = await Promise.all([
    db.loadRecords(env), db.loadFailed(env), db.pendingCount(env), db.recordStats(env),
  ]);
  // Before the cron has indexed anything there is nothing true to publish:
  // viewers keep getting 202 until the first run writes real views.
  if (!withRpc && (!cursors.length || !records.length)) return { skipped: true };
  const learned = await db.loadLabels(env);

  const replay = (label) => replayTrace({ records, cursors: cursorMap(cursors), label, pendingCount: pending });
  let label = makeLabelResolver(learned);
  let trace = replay(label);
  if (withRpc && trace.needLabels.length) {
    if (await lookupIdentities(env, trace.needLabels, learned)) {
      label = makeLabelResolver(learned);
      trace = replay(label);
    }
  }
  if (withRpc && (trace.fetchRequests.length || trace.widenRequests.length)) {
    const known = new Set(cursors.map((c) => c.address));
    await db.addCursors(env, trace.fetchRequests.filter((r) => !known.has(r.account)));
    await db.widenCursors(env, trace.widenRequests);
    cursors = await db.loadCursors(env);
  }

  if (fanout === undefined) {
    const meta = await kvGetJson(env, KV.meta);
    fanout = { state: meta?.fanoutState ?? null, exists: meta?.fanoutExists };
  }
  const views = buildViews({
    trace, cursors, failed, fanoutState: fanout.state, fanoutExists: fanout.exists, learned, label,
    meta: {
      builtAt: Date.now(),
      pending,
      indexedThrough: stats?.maxTime ? { t: stats.maxTime, slot: stats.maxSlot } : null,
    },
  });
  await kvPutJson(env, KV.summary, views.summary);
  await kvPutJson(env, KV.runs, views.runs);
  await kvPutJson(env, KV.labels, views.labels);
  for (const [wallet, detail] of Object.entries(views.seats)) await kvPutJson(env, KV.seat(wallet), detail);
  return { records: records.length, seats: Object.keys(views.seats).length, pending };
}

async function indexOnce(env) {
  await db.ensureSchema(env);
  await db.seedCursors(env);
  const meta = (await kvGetJson(env, KV.meta)) || {};
  if (meta.recordVersion !== RECORD_VERSION) await db.requeueStaleRecords(env, RECORD_VERSION);

  let cursors = await db.loadCursors(env);
  let newSigs = 0;
  for (const cursor of cursors) {
    if (cursor.busy) continue;
    try {
      const { successes, failures } = await pollCursor(env, cursor);
      await db.addPending(env, successes);
      if (cursor.role === "fanout_pda") await db.addFailed(env, failures.filter((s) => inWindow(cursor, s)));
      await db.saveCursor(env, cursor);
      newSigs += successes.length;
    } catch (err) {
      console.error(`council-emissions: polling ${cursor.role} failed:`, err.message);
    }
  }

  const fetched = await fetchPending(env, DECODE_BUDGET_PER_RUN);
  const discovered = await discoverSeatAccounts(env, cursors).catch((err) => {
    console.error("council-emissions: account discovery failed:", err.message);
    return [];
  });

  cursors = await db.loadCursors(env);
  const tokenAccounts = cursors.filter((c) => c.role !== "fanout_pda").map((c) => c.address);
  const balances = await getTokenBalances(env, tokenAccounts);
  await db.saveLiveBalances(env, balances);
  let fanoutState = null;
  const raw = await getAccountData(env, FANOUT.pda);
  const fanoutExists = raw !== null;
  if (raw) {
    try {
      fanoutState = decodeMiniFanout(raw);
    } catch (err) {
      console.error("council-emissions: fanout decode failed:", err.message);
    }
  }

  // Skip the replay when nothing it reads has changed since the last one.
  const fingerprint = JSON.stringify([CLASSIFIER_VERSION, RECORD_VERSION, fetched, discovered.length, cursors.length, balances, fanoutState?.shares ?? null]);
  const fresh = await kvGetJson(env, KV.summary);
  let result = null;
  if (!fresh || fetched > 0 || meta.fingerprint !== fingerprint) {
    result = await rebuild(env, { withRpc: true, fanout: { state: fanoutState, exists: fanoutExists } });
  }
  await kvPutJson(env, KV.meta, {
    ...((await kvGetJson(env, KV.meta)) || {}),
    fingerprint, fanoutState, fanoutExists, recordVersion: RECORD_VERSION, lastRunAt: Date.now(),
  });
  return { newSigs, fetched, discovered: discovered.length, rebuilt: !!result };
}

/** Cron entry. Single-flight: a run still going when the next tick fires wins. */
export async function runCouncilEmissionsIndex(env) {
  if (!INDEX_ENABLED || !env.DB) return null;
  const { contended, result } = await withKvLock(env, KV.lock, LOCK_TTL_SECONDS, () => indexOnce(env));
  if (contended) return { contended: true };
  return result;
}
