import { OUI_API_URL } from "../config.js";
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

export async function listOuis(env) {
  const { results } = await env.DB.prepare(
    `SELECT oui, owner, payer, escrow, delegate_keys, locked, last_synced_at
     FROM ouis
     ORDER BY oui ASC`
  ).all();
  return results || [];
}

export async function getOuiBalanceSeries(env, oui, days = 30) {
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
