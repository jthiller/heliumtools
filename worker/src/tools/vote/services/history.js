// Vote history time-series, stored in D1 (the `DB` binding). One row per
// proposal per 15-minute bucket: the authoritative per-choice tally over time,
// so the frontend can chart a vote's arc across its (e.g. 7-day) lifetime.

import { kvGetJson, kvPutJson } from "../utils.js";
import {
  HISTORY_BUCKET_SECONDS,
  HISTORY_RETENTION_DAYS,
  HISTORY_CACHE_TTL,
} from "../config.js";

let schemaReady = false;

// CREATE IF NOT EXISTS — idempotent, so the table self-provisions on first use
// (also mirrored in worker/schema.sql as the source of truth). Cached per
// isolate to avoid a round-trip on every call.
async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS vote_snapshots (
       proposal TEXT NOT NULL,
       ts INTEGER NOT NULL,
       total_weight TEXT NOT NULL,
       total_vehnt REAL NOT NULL,
       unique_voters INTEGER,
       marker_count INTEGER,
       choices_json TEXT NOT NULL,
       PRIMARY KEY (proposal, ts)
     )`,
  ).run();
  schemaReady = true;
}

/**
 * Append one history point for a snapshot, bucketed to a 15-min boundary
 * (INSERT OR IGNORE → at most one point per bucket regardless of trigger), then
 * prune points older than the retention window.
 */
export async function appendSnapshot(env, id, snapshot) {
  if (!env.DB) return;
  await ensureSchema(env);

  const p = snapshot.proposal;
  if (!p || !Array.isArray(p.choices)) return;

  const ts = Math.floor(snapshot.snapshotAt / 1000);
  const bucketTs = Math.floor(ts / HISTORY_BUCKET_SECONDS) * HISTORY_BUCKET_SECONDS;
  const choices = p.choices.map((c) => ({
    index: c.index,
    weight: c.weight,
    veHnt: c.veHnt,
  }));

  await env.DB.prepare(
    `INSERT OR IGNORE INTO vote_snapshots
       (proposal, ts, total_weight, total_vehnt, unique_voters, marker_count, choices_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    bucketTs,
    p.totalWeight,
    p.totalVeHnt,
    snapshot.votes?.uniqueVoters ?? null,
    snapshot.votes?.markerCount ?? null,
    JSON.stringify(choices),
  ).run();

  const cutoff = bucketTs - HISTORY_RETENTION_DAYS * 86400;
  await env.DB.prepare(
    `DELETE FROM vote_snapshots WHERE proposal = ? AND ts < ?`,
  ).bind(id, cutoff).run();
}

/** Read the retained history points for a proposal, oldest first. KV-cached. */
export async function getHistory(env, id) {
  const cacheKey = `vote:histcache:${id}`;
  const cached = await kvGetJson(env, cacheKey);
  if (cached) return cached;

  let points = [];
  if (env.DB) {
    await ensureSchema(env);
    const cutoff = Math.floor(Date.now() / 1000) - HISTORY_RETENTION_DAYS * 86400;
    const { results } = await env.DB.prepare(
      `SELECT ts, total_weight, total_vehnt, unique_voters, marker_count, choices_json
         FROM vote_snapshots WHERE proposal = ? AND ts >= ? ORDER BY ts ASC`,
    ).bind(id, cutoff).all();
    points = (results || []).map((r) => ({
      ts: r.ts,
      totalWeight: r.total_weight,
      totalVeHnt: r.total_vehnt,
      uniqueVoters: r.unique_voters,
      markerCount: r.marker_count,
      choices: safeParse(r.choices_json),
    }));
  }

  const body = { proposal: id, points };
  await kvPutJson(env, cacheKey, body, HISTORY_CACHE_TTL);
  return body;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}
