import { OUI_API_URL, BALANCE_HISTORY_DAYS } from "../config.js";
import { safeText } from "../utils.js";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await safeText(res);
    throw new Error(`Failed to fetch OUIs (${res.status}): ${body}`);
  }
  return res.json();
}

export async function fetchAllOuisFromApi() {
  const data = await fetchJson(OUI_API_URL);
  if (!data?.orgs || !Array.isArray(data.orgs)) {
    throw new Error("Unexpected OUI payload shape.");
  }

  return data.orgs
    .map((org) => ({
      oui: Number(org.oui),
      owner: org.owner || null,
      payer: org.payer || null,
      escrow: org.escrow || null,
      delegate_keys: Array.isArray(org.delegate_keys) ? org.delegate_keys : [],
      locked: Boolean(org.locked),
    }))
    .filter((org) => Number.isInteger(org.oui) && org.escrow);
}

export async function ensureOuiTables(env) {
  // Creates OUI tables if not present to avoid 500s on first run.
  const statements = [
    `CREATE TABLE IF NOT EXISTS ouis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      oui INTEGER NOT NULL UNIQUE,
      owner TEXT,
      payer TEXT,
      escrow TEXT,
      delegate_keys TEXT,
      locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_synced_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ouis_escrow ON ouis (escrow);`,
    `CREATE TABLE IF NOT EXISTS oui_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      oui INTEGER NOT NULL,
      date TEXT NOT NULL,
      balance_dc REAL NOT NULL,
      fetched_at TEXT NOT NULL,
      UNIQUE (oui, date),
      FOREIGN KEY (oui) REFERENCES ouis(oui)
    );`,
  ];

  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
}

export async function pruneOuiBalanceHistory(env, keepDays = BALANCE_HISTORY_DAYS) {
  if (!Number.isFinite(keepDays) || keepDays <= 0) return;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  try {
    await env.DB.prepare("DELETE FROM oui_balances WHERE date < ?").bind(cutoffDate).run();
  } catch (err) {
    console.error("Failed to prune oui_balances history", err);
  }
}

export async function upsertOuis(env, orgs, syncedAtIso) {
  if (!orgs?.length) return;
  const createdAtIso = syncedAtIso;

  for (const org of orgs) {
    try {
      await env.DB.prepare(
        `INSERT INTO ouis (oui, owner, payer, escrow, delegate_keys, locked, created_at, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(oui) DO UPDATE SET
           owner = excluded.owner,
           payer = excluded.payer,
           escrow = excluded.escrow,
           delegate_keys = excluded.delegate_keys,
           locked = excluded.locked,
           last_synced_at = excluded.last_synced_at`
      )
        .bind(
          org.oui,
          org.owner,
          org.payer,
          org.escrow,
          JSON.stringify(org.delegate_keys || []),
          org.locked ? 1 : 0,
          createdAtIso,
          syncedAtIso
        )
        .run();
    } catch (err) {
      console.error(`Failed to upsert OUI ${org.oui}`, err);
    }
  }
}

export async function recordOuiBalance(env, { oui, escrow }, balanceDC, dateIso, fetchedAtIso) {
  try {
    await env.DB.prepare(
      `INSERT INTO oui_balances (oui, date, balance_dc, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(oui, date) DO UPDATE SET
         balance_dc = excluded.balance_dc,
         fetched_at = excluded.fetched_at`
    )
      .bind(oui, dateIso, balanceDC, fetchedAtIso)
      .run();
  } catch (err) {
    console.error(`Failed to record balance for OUI ${oui} (${escrow})`, err);
  }
}

export async function getOuiByNumber(env, oui) {
  return env.DB.prepare(
    `SELECT oui, owner, payer, escrow, delegate_keys, locked, last_synced_at
     FROM ouis WHERE oui = ?`
  )
    .bind(oui)
    .first();
}

export async function getOuiByEscrow(env, escrow) {
  return env.DB.prepare(
    `SELECT oui, owner, payer, escrow, delegate_keys, locked, last_synced_at
     FROM ouis WHERE escrow = ?`
  )
    .bind(escrow)
    .first();
}

export async function listOuis(env) {
  const { results } = await env.DB.prepare(
    `SELECT oui, owner, payer, escrow, delegate_keys, locked, last_synced_at
     FROM ouis
     ORDER BY oui ASC`
  ).all();
  return results || [];
}

export async function getOuiBalanceSeries(env, oui, days = 30) {
  await ensureOuiTables(env);
  const { results } = await env.DB.prepare(
    `SELECT date, balance_dc, fetched_at
     FROM oui_balances
     WHERE oui = ?
     ORDER BY date DESC
     LIMIT ?`
  )
    .bind(oui, days)
    .all();

  if (!results) return [];
  // Reverse to ascending order for chart friendliness.
  return results.slice().reverse();
}

/**
 * Batch fetch multiple OUIs by their numbers.
 * @param {object} env - Worker environment
 * @param {number[]} ouiNumbers - Array of OUI numbers to fetch
 * @returns {Promise<object[]>} Array of OUI records
 */
export async function getOuisByNumbers(env, ouiNumbers) {
  if (!ouiNumbers?.length) return [];
  const placeholders = ouiNumbers.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT oui, owner, payer, escrow, delegate_keys, locked, last_synced_at
     FROM ouis WHERE oui IN (${placeholders})`
  ).bind(...ouiNumbers).all();
  return results || [];
}

/**
 * Batch fetch recent balance records for multiple OUIs.
 * @param {object} env - Worker environment
 * @param {number[]} ouiNumbers - Array of OUI numbers
 * @param {number} lookbackDays - Number of days to look back (time range filter, not record limit)
 * @returns {Promise<object[]>} Array of balance records sorted by OUI and date ascending
 */
export async function getRecentBalancesForOuis(env, ouiNumbers, lookbackDays = 2) {
  if (!ouiNumbers?.length) return [];
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) return [];

  const placeholders = ouiNumbers.map(() => '?').join(',');
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const { results } = await env.DB.prepare(
    `SELECT oui, date, balance_dc, fetched_at
     FROM oui_balances 
     WHERE oui IN (${placeholders}) AND date >= ?
     ORDER BY oui, date ASC`
  ).bind(...ouiNumbers, cutoffDate).all();
  return results || [];
}

