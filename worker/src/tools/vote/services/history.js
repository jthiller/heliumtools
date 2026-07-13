// Vote history time-series, stored in D1 (the `DB` binding). One immutable row
// per vote — keyed by its VoteMarkerV0 account — recording the exact blockTime
// the vote was cast, the choice(s), and the weight. The cumulative per-choice
// curve is computed at read time, so the chart reflects precise vote times (not
// coarse intervals). Rows are appended incrementally by the snapshot cron.

import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import { weightToVeHnt } from "../utils.js";
import { HISTORY_CACHE_TTL, MAX_HISTORY_POINTS } from "../config.js";

let schemaReady = false;

// CREATE IF NOT EXISTS — idempotent, so the table self-provisions on first use
// (also mirrored in worker/schema.sql). Cached per isolate.
async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS vote_events (
       proposal TEXT NOT NULL,
       marker TEXT NOT NULL,
       ts INTEGER NOT NULL,
       voter TEXT,
       choices_json TEXT NOT NULL,
       weight TEXT NOT NULL,
       flipped INTEGER NOT NULL DEFAULT 0,
       flip_resolved INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (proposal, marker)
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_vote_events_proposal_ts ON vote_events (proposal, ts)`,
  ).run();
  // Migrate older tables (each ALTER throws harmlessly if the column exists).
  // `flip_resolved` defaults to 0, so every pre-existing row is re-decoded by
  // the flip resolver, correcting flags from the old transaction-count heuristic.
  for (const col of [
    `ADD COLUMN flipped INTEGER NOT NULL DEFAULT 0`,
    `ADD COLUMN flip_resolved INTEGER NOT NULL DEFAULT 0`,
  ]) {
    try {
      await env.DB.prepare(`ALTER TABLE vote_events ${col}`).run();
    } catch {
      /* column already exists */
    }
  }
  // Resolver scans for unresolved markers per proposal — index keeps it cheap.
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_vote_events_unresolved ON vote_events (proposal, flip_resolved)`,
  ).run();
  schemaReady = true;
}

/**
 * Map of marker pubkey → recorded choices_json, for the proposal. The recorder
 * uses it to skip unchanged markers and to detect flips (current choice differs
 * from what we stored). Reads all rows for the proposal — fine at the documented
 * scale (hundreds–low-thousands of voters), would need windowing far beyond that.
 */
export async function getRecordedMarkers(env, id) {
  if (!env.DB) return new Map();
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT marker, choices_json FROM vote_events WHERE proposal = ?`,
  ).bind(id).all();
  return new Map((results || []).map((r) => [r.marker, r.choices_json]));
}

/**
 * Every recorded vote event for a proposal, decoded for aggregation — the
 * source for rebuilding a resolved vote's roster after its markers close.
 * Rows: { marker, voter, choices:[idx], weight:string, flipped:0|1 }.
 */
export async function getEventRows(env, id) {
  if (!env.DB) return [];
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT marker, voter, choices_json, weight, flipped FROM vote_events WHERE proposal = ?`,
  ).bind(id).all();
  return (results || []).map((r) => ({
    marker: r.marker,
    voter: r.voter,
    choices: safeParse(r.choices_json),
    weight: r.weight,
    flipped: r.flipped === 1,
  }));
}

/**
 * The marker pubkeys a given voter holds on a proposal (one per position).
 * `flippedOnly` restricts to positions that changed their vote — the only ones
 * worth parsing for the flip timeline, which also bounds the work for a wallet
 * with many positions.
 */
export async function getVoterMarkers(env, id, voter, { flippedOnly = false } = {}) {
  if (!env.DB) return [];
  await ensureSchema(env);
  const where = flippedOnly
    ? `proposal = ? AND voter = ? AND flipped = 1`
    : `proposal = ? AND voter = ?`;
  const { results } = await env.DB.prepare(
    `SELECT marker, choices_json FROM vote_events WHERE ${where}`,
  ).bind(id, voter).all();
  // `choices` is the marker's current decoded choice — used as the reliable
  // direction fallback when a transaction's instruction can't be decoded.
  return (results || []).map((r) => ({ marker: r.marker, choices: safeParse(r.choices_json) }));
}

/**
 * Marker pubkeys whose flip status hasn't been decoded yet (`flip_resolved = 0`),
 * for the resolver to process in bounded batches. Includes every legacy row
 * after the migration (so the one-time backfill re-decodes them all).
 */
export async function getUnresolvedMarkers(env, id, limit) {
  if (!env.DB) return [];
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT marker FROM vote_events WHERE proposal = ? AND flip_resolved = 0 LIMIT ?`,
  ).bind(id, limit).all();
  return (results || []).map((r) => r.marker);
}

/**
 * Persist resolver verdicts: set each marker's `flipped` to the decoded value
 * and mark it resolved so it isn't re-decoded. `rows`: { marker, flipped:bool }.
 */
export async function setMarkerFlips(env, id, rows) {
  if (!env.DB || rows.length === 0) return;
  await ensureSchema(env);
  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        `UPDATE vote_events SET flipped = ?, flip_resolved = 1 WHERE proposal = ? AND marker = ?`,
      ).bind(r.flipped ? 1 : 0, id, r.marker),
    ),
  );
}

/** Set of marker pubkeys flagged as flipped, for joining onto the roster. */
export async function getFlippedMarkers(env, id) {
  if (!env.DB) return new Set();
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT marker FROM vote_events WHERE proposal = ? AND flipped = 1`,
  ).bind(id).all();
  return new Set((results || []).map((r) => r.marker));
}

/**
 * Upsert vote events (one per marker) in one D1 batch. INSERT OR REPLACE so a
 * marker whose choice changed (a flip) updates in place. `rows`: { marker, ts,
 * voter, choices:[idx], weight:string, flipped:bool, flipResolved:bool }.
 * A change-detection flip is recorded resolved (`flipped = flipResolved = 1`);
 * a freshly-seen marker is recorded unresolved so the flip resolver decodes it.
 */
export async function insertVoteEvents(env, id, rows) {
  if (!env.DB || rows.length === 0) return;
  await ensureSchema(env);
  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        `INSERT OR REPLACE INTO vote_events
           (proposal, marker, ts, voter, choices_json, weight, flipped, flip_resolved)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, r.marker, r.ts, r.voter ?? null, JSON.stringify(r.choices), r.weight,
        r.flipped ? 1 : 0, r.flipResolved ? 1 : 0,
      ),
    ),
  );
}

/**
 * Read the per-vote events and fold them into a cumulative per-choice series.
 * Each point carries the exact vote time and the running cumulative veHNT for
 * every choice seen so far. KV-cached; downsampled to MAX_HISTORY_POINTS.
 */
export async function getHistory(env, id) {
  const cacheKey = `vote:histcache:${id}`;
  const cached = await kvGetJson(env, cacheKey);
  if (cached) return cached;

  let points = [];
  if (env.DB) {
    await ensureSchema(env);
    const { results } = await env.DB.prepare(
      `SELECT ts, choices_json, weight FROM vote_events WHERE proposal = ? ORDER BY ts ASC, marker ASC`,
    ).bind(id).all();

    const perChoice = new Map(); // choiceIndex -> cumulative bigint
    const all = (results || []).map((r) => {
      let weight = 0n;
      try { weight = BigInt(r.weight); } catch { /* skip bad row */ }
      for (const ci of safeParse(r.choices_json)) {
        perChoice.set(ci, (perChoice.get(ci) || 0n) + weight);
      }
      return {
        ts: r.ts,
        choices: [...perChoice.entries()].map(([index, w]) => ({ index, veHnt: weightToVeHnt(w) })),
      };
    });
    const sampled = downsample(all, MAX_HISTORY_POINTS);
    // `total` is the true vote count (pre-downsample) for the UI label.
    const body = { proposal: id, points: sampled, total: all.length };
    await kvPutJson(env, cacheKey, body, HISTORY_CACHE_TTL);
    return body;
  }

  const body = { proposal: id, points, total: points.length };
  await kvPutJson(env, cacheKey, body, HISTORY_CACHE_TTL);
  return body;
}

// Keep the first + last points and evenly sample the middle so a huge vote
// stays under the payload cap while preserving the curve's shape. Skips
// collisions where rounding maps consecutive samples to the same index.
function downsample(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  let last = -1;
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * step);
    if (idx !== last) { out.push(points[idx]); last = idx; }
  }
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

function safeParse(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
