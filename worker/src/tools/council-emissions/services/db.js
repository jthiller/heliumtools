// D1 storage for the council indexer (the `DB` binding). Tables self-provision
// (CREATE ... IF NOT EXISTS, cached per isolate) and are mirrored in
// worker/schema.sql.
//
//   ce_cursors  one row per indexed address (signature cursors + live balance)
//   ce_tx       the parsed record of every indexed transaction (replay source)
//   ce_pending  signatures waiting to be fetched
//   ce_failed   failed distribution attempts (from the fanout's signature list)
//   ce_labels   cached Helius wallet identity results

import { EXPECTED_SEATS, FANOUT } from "../config.js";

let schemaReady = false;

export async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ce_cursors (
         address TEXT PRIMARY KEY,
         role TEXT NOT NULL,
         owner TEXT,
         depth INTEGER NOT NULL DEFAULT 0,
         from_time INTEGER,
         from_slot INTEGER,
         newest_sig TEXT,
         oldest_sig TEXT,
         backfill_done INTEGER NOT NULL DEFAULT 0,
         sig_count INTEGER NOT NULL DEFAULT 0,
         busy INTEGER NOT NULL DEFAULT 0,
         live_raw TEXT,
         discovered_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ce_tx (
         signature TEXT PRIMARY KEY,
         slot INTEGER NOT NULL,
         block_time INTEGER,
         version INTEGER NOT NULL,
         record_json TEXT NOT NULL
       )`,
    ),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ce_tx_slot ON ce_tx (slot)`),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ce_pending (
         signature TEXT PRIMARY KEY,
         slot INTEGER NOT NULL,
         added_at INTEGER NOT NULL
       )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ce_failed (
         signature TEXT PRIMARY KEY,
         slot INTEGER NOT NULL,
         block_time INTEGER,
         error TEXT
       )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ce_labels (
         address TEXT PRIMARY KEY,
         identity_json TEXT NOT NULL,
         fetched_at INTEGER NOT NULL
       )`,
    ),
  ]);
  schemaReady = true;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Seed the fanout and expected seat accounts (no-op once they exist). */
export async function seedCursors(env) {
  const t = nowSec();
  const rows = [
    { address: FANOUT.pda, role: "fanout_pda", owner: null },
    { address: FANOUT.tokenAccount, role: "fanout_token", owner: FANOUT.pda },
    ...EXPECTED_SEATS.map((s) => ({ address: s.ata, role: "seat_token", owner: s.wallet })),
  ];
  await env.DB.batch(rows.map((r) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO ce_cursors (address, role, owner, depth, from_time, discovered_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    ).bind(r.address, r.role, r.owner, FANOUT.createdAt, t, t),
  ));
}

export async function addCursors(env, requests) {
  if (!requests.length) return;
  const t = nowSec();
  await env.DB.batch(requests.map((r) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO ce_cursors (address, role, owner, depth, from_time, from_slot, discovered_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(r.account, r.role, r.owner, r.depth ?? 0, r.fromTime ?? null, r.fromSlot ?? null, t, t),
  ));
}

/** Backfill a followed account further back, to an earlier traced receipt. */
export async function widenCursors(env, requests) {
  if (!requests.length) return;
  await env.DB.batch(requests.map((r) =>
    env.DB.prepare(
      `UPDATE ce_cursors SET from_slot = ?, backfill_done = 0, oldest_sig = NULL, updated_at = ?
       WHERE address = ? AND busy = 0 AND (from_slot IS NULL OR from_slot > ?)`,
    ).bind(r.fromSlot, nowSec(), r.account, r.fromSlot),
  ));
}

export async function loadCursors(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM ce_cursors`).all();
  return results || [];
}

export async function saveCursor(env, c) {
  await env.DB.prepare(
    `UPDATE ce_cursors SET newest_sig = ?, oldest_sig = ?, backfill_done = ?, sig_count = ?, busy = ?, updated_at = ?
     WHERE address = ?`,
  ).bind(c.newest_sig ?? null, c.oldest_sig ?? null, c.backfill_done ? 1 : 0, c.sig_count ?? 0, c.busy ? 1 : 0, nowSec(), c.address).run();
}

export async function saveLiveBalances(env, balances) {
  const entries = Object.entries(balances);
  for (let i = 0; i < entries.length; i += 50) {
    await env.DB.batch(entries.slice(i, i + 50).map(([address, raw]) =>
      env.DB.prepare(`UPDATE ce_cursors SET live_raw = ? WHERE address = ?`).bind(raw, address),
    ));
  }
}

/** Queue signatures for fetching, skipping ones already stored. */
export async function addPending(env, sigs) {
  const t = nowSec();
  for (let i = 0; i < sigs.length; i += 50) {
    await env.DB.batch(sigs.slice(i, i + 50).map((s) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO ce_pending (signature, slot, added_at)
         SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ce_tx WHERE signature = ?)`,
      ).bind(s.signature, s.slot, t, s.signature),
    ));
  }
}

export async function addFailed(env, sigs) {
  for (let i = 0; i < sigs.length; i += 50) {
    await env.DB.batch(sigs.slice(i, i + 50).map((s) =>
      env.DB.prepare(`INSERT OR IGNORE INTO ce_failed (signature, slot, block_time, error) VALUES (?, ?, ?, ?)`)
        .bind(s.signature, s.slot, s.blockTime ?? null, JSON.stringify(s.err ?? null)),
    ));
  }
}

export async function nextPending(env, limit) {
  const { results } = await env.DB.prepare(`SELECT signature FROM ce_pending ORDER BY slot LIMIT ?`).bind(limit).all();
  return (results || []).map((r) => r.signature);
}

export async function pendingCount(env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ce_pending`).first();
  return row?.n ?? 0;
}

/** Store parsed records and clear their pending rows. `dropped` are sigs with no record (failed or empty). */
export async function storeRecords(env, records, version, dropped = []) {
  const stmts = [];
  for (const r of records) {
    stmts.push(env.DB.prepare(
      `INSERT OR REPLACE INTO ce_tx (signature, slot, block_time, version, record_json) VALUES (?, ?, ?, ?, ?)`,
    ).bind(r.sig, r.slot, r.t ?? null, version, JSON.stringify(r)));
    stmts.push(env.DB.prepare(`DELETE FROM ce_pending WHERE signature = ?`).bind(r.sig));
  }
  for (const sig of dropped) stmts.push(env.DB.prepare(`DELETE FROM ce_pending WHERE signature = ?`).bind(sig));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

/** Re-queue records parsed by an older parse.js (they are re-fetched over the next runs). */
export async function requeueStaleRecords(env, version) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO ce_pending (signature, slot, added_at) SELECT signature, slot, ? FROM ce_tx WHERE version < ?`,
    ).bind(nowSec(), version),
    env.DB.prepare(`DELETE FROM ce_tx WHERE version < ?`).bind(version),
  ]);
}

export async function loadRecords(env) {
  const { results } = await env.DB.prepare(`SELECT record_json FROM ce_tx ORDER BY slot`).all();
  return (results || []).map((r) => JSON.parse(r.record_json));
}

export async function recordStats(env) {
  return env.DB.prepare(`SELECT COUNT(*) AS n, MAX(slot) AS maxSlot, MAX(block_time) AS maxTime FROM ce_tx`).first();
}

export async function loadFailed(env) {
  const { results } = await env.DB.prepare(`SELECT signature, slot, block_time, error FROM ce_failed ORDER BY slot`).all();
  return results || [];
}

export async function loadLabels(env) {
  const { results } = await env.DB.prepare(`SELECT address, identity_json, fetched_at FROM ce_labels`).all();
  const out = {};
  for (const r of results || []) out[r.address] = { ...JSON.parse(r.identity_json), fetchedAt: r.fetched_at };
  return out;
}

export async function saveLabel(env, address, identity) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO ce_labels (address, identity_json, fetched_at) VALUES (?, ?, ?)`,
  ).bind(address, JSON.stringify(identity), Date.now()).run();
}
