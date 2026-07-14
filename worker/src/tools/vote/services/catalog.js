// Durable per-proposal catalog (D1 `vote_proposals`) behind GET /vote/proposals.
// Every snapshot refresh upserts one compact row (name, status, dates, tallies,
// choice summary), so the index page can list current *and* past votes long
// after their KV snapshots expire and their markers close. Resolved rows stop
// changing; the active vote's row updates each cron tick.

import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import { safeParseJson } from "../utils.js";
import { PROPOSALS_CACHE_TTL } from "../config.js";

const LIST_CACHE_KEY = "vote:catalog";

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS vote_proposals (
       address TEXT PRIMARY KEY,
       name TEXT,
       status TEXT NOT NULL,
       state TEXT NOT NULL,
       created_at INTEGER,
       start_ts INTEGER,
       end_ts INTEGER,
       max_choices INTEGER,
       seats INTEGER,
       total_weight TEXT,
       total_ve_hnt REAL,
       voted_ve_hnt REAL,
       unique_voters INTEGER,
       winning_json TEXT,
       choices_json TEXT,
       tags_json TEXT,
       updated_at INTEGER NOT NULL
     )`,
  ).run();
  schemaReady = true;
}

/**
 * Upsert the catalog row for a freshly-built snapshot. Roster-derived fields
 * (voted veHNT, voter count) COALESCE onto the previous value so a cycle whose
 * marker fetch failed doesn't blank them. Best-effort: callers swallow throws.
 */
export async function upsertCatalogRow(env, snapshot) {
  const p = snapshot?.proposal;
  if (!env.DB || !p) return;
  await ensureSchema(env);

  const votes = snapshot.votes;
  const choices = (p.choices || []).map((c) => ({
    index: c.index,
    name: c.name,
    veHnt: c.veHnt,
    percent: c.percent,
  }));

  await env.DB.prepare(
    `INSERT INTO vote_proposals
       (address, name, status, state, created_at, start_ts, end_ts, max_choices,
        seats, total_weight, total_ve_hnt, voted_ve_hnt, unique_voters,
        winning_json, choices_json, tags_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       name = excluded.name,
       status = excluded.status,
       state = excluded.state,
       created_at = excluded.created_at,
       start_ts = COALESCE(excluded.start_ts, start_ts),
       end_ts = COALESCE(excluded.end_ts, end_ts),
       max_choices = excluded.max_choices,
       seats = COALESCE(excluded.seats, seats),
       total_weight = excluded.total_weight,
       total_ve_hnt = excluded.total_ve_hnt,
       voted_ve_hnt = COALESCE(excluded.voted_ve_hnt, voted_ve_hnt),
       unique_voters = COALESCE(excluded.unique_voters, unique_voters),
       winning_json = excluded.winning_json,
       choices_json = excluded.choices_json,
       tags_json = excluded.tags_json,
       updated_at = excluded.updated_at`,
  ).bind(
    p.address,
    p.name || null,
    p.status,
    p.state,
    p.createdAt ?? null,
    p.startTs ?? null,
    p.endTs ?? null,
    p.maxChoicesPerVoter ?? null,
    p.seats ?? null,
    p.totalWeight ?? null,
    p.totalVeHnt ?? null,
    votes ? votes.totalVeHnt : null,
    votes ? votes.uniqueVoters : null,
    p.winningChoices ? JSON.stringify(p.winningChoices) : null,
    JSON.stringify(choices),
    JSON.stringify(p.tags || []),
    Date.now(),
  ).run();

  // Drop the list cache so the index reflects this row on the next request —
  // the TTL is only a read shield, not an acceptable staleness window for a
  // vote that just appeared or just resolved.
  if (env.KV) {
    try {
      await env.KV.delete(LIST_CACHE_KEY);
    } catch {
      /* TTL covers it */
    }
  }
}

/** Whether a catalog row exists (cron uses this to backfill frozen proposals). */
export async function hasCatalogRow(env, address) {
  if (!env.DB) return true; // nothing to backfill into
  await ensureSchema(env);
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM vote_proposals WHERE address = ?`,
  ).bind(address).first();
  return !!row;
}

/**
 * All cataloged proposals for the index page: live votes first, then past ones
 * newest-ended first. KV-cached briefly so index viewers don't hit D1 each time.
 */
export async function listCatalog(env) {
  const cached = await kvGetJson(env, LIST_CACHE_KEY);
  if (cached) return cached;

  let proposals = [];
  if (env.DB) {
    await ensureSchema(env);
    const { results } = await env.DB.prepare(
      `SELECT * FROM vote_proposals
       ORDER BY (status = 'active') DESC,
                COALESCE(end_ts, created_at) DESC,
                created_at DESC`,
    ).all();
    proposals = (results || []).map((r) => ({
      address: r.address,
      name: r.name,
      status: r.status,
      state: r.state,
      createdAt: r.created_at,
      startTs: r.start_ts,
      endTs: r.end_ts,
      maxChoicesPerVoter: r.max_choices,
      seats: r.seats,
      totalVeHnt: r.total_ve_hnt,
      votedVeHnt: r.voted_ve_hnt,
      uniqueVoters: r.unique_voters,
      winningChoices: safeParseJson(r.winning_json),
      choices: safeParseJson(r.choices_json, []),
      tags: safeParseJson(r.tags_json, []),
      updatedAt: r.updated_at,
    }));
  }

  const body = { proposals };
  await kvPutJson(env, LIST_CACHE_KEY, body, PROPOSALS_CACHE_TTL);
  return body;
}
