// D1 access for the single `council_messages` table (the `DB` binding). One table
// (kind + reply_to_id columns), not separate nomination/endorsement tables: the
// column shape is identical and a re-classification between scrapes is a plain
// INSERT OR REPLACE, never a cross-table move. Support→nomination linking is
// resolved at READ time (see assemble.js), never persisted, so a message changing
// kind can't leave a stale link behind.

import { D1_BATCH_CHUNK } from "../config.js";

let schemaReady = false;

// CREATE IF NOT EXISTS — idempotent, so the table self-provisions on first use
// (also mirrored in worker/schema.sql). Cached per isolate.
async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS council_messages (
       channel_id  TEXT NOT NULL,
       id          TEXT NOT NULL,
       guild_id    TEXT NOT NULL,
       kind        TEXT NOT NULL,
       reply_to_id TEXT,
       author_id           TEXT,
       author_username     TEXT,
       author_display_name TEXT NOT NULL,
       avatar_url  TEXT,
       content     TEXT NOT NULL,
       posted_at   INTEGER NOT NULL,
       edited_at   INTEGER,
       reactions_json TEXT NOT NULL DEFAULT '[]',
       removed     INTEGER NOT NULL DEFAULT 0,
       last_seen_at INTEGER NOT NULL,
       PRIMARY KEY (channel_id, id)
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_council_messages_live
       ON council_messages (channel_id, removed, posted_at)`,
  ).run();
  schemaReady = true;
}

/**
 * The set of message ids already stored for the channel (regardless of `removed`).
 * The ingest handler uses it to split a push into inserted vs updated counts; a
 * removed row still counts as existing since an upsert resurrects it.
 */
export async function getStoredIds(env, channelId) {
  if (!env.DB) return new Set();
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT id FROM council_messages WHERE channel_id = ?`,
  ).bind(channelId).all();
  return new Set((results || []).map((r) => r.id));
}

/**
 * Upsert messages in chunked D1 batches. Every upsert stamps `removed = 0` and
 * `last_seen_at = scrapedAt` — that's what lets a later complete-scrape soft-remove
 * the rows this snapshot didn't carry (`softRemoveStale`), and resurrect any that
 * reappear. `messages` are already validated/normalized.
 */
export async function upsertMessages(env, channelId, guildId, scrapedAt, messages) {
  if (!env.DB || messages.length === 0) return;
  await ensureSchema(env);
  for (let i = 0; i < messages.length; i += D1_BATCH_CHUNK) {
    const chunk = messages.slice(i, i + D1_BATCH_CHUNK);
    await env.DB.batch(
      chunk.map((m) =>
        env.DB.prepare(
          `INSERT OR REPLACE INTO council_messages
             (channel_id, id, guild_id, kind, reply_to_id,
              author_id, author_username, author_display_name, avatar_url,
              content, posted_at, edited_at, reactions_json, removed, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        ).bind(
          channelId, m.id, guildId, m.kind, m.replyToId,
          m.authorId, m.authorUsername, m.authorDisplayName, m.avatarUrl,
          m.content, m.postedAt, m.editedAt, JSON.stringify(m.reactions), scrapedAt,
        ),
      ),
    );
  }
}

/**
 * After a complete-channel scrape, soft-remove rows this snapshot didn't touch
 * (`last_seen_at < scrapedAt`) — messages deleted in Discord. Only rows currently
 * live transition, so the returned count is the number newly removed this run.
 */
export async function softRemoveStale(env, channelId, scrapedAt) {
  if (!env.DB) return 0;
  await ensureSchema(env);
  const res = await env.DB.prepare(
    `UPDATE council_messages SET removed = 1
       WHERE channel_id = ? AND removed = 0 AND last_seen_at < ?`,
  ).bind(channelId, scrapedAt).run();
  return res?.meta?.changes ?? 0;
}

/** Live (non-removed) rows for the channel, oldest first. Assembled at read time. */
export async function getLiveMessages(env, channelId) {
  if (!env.DB) return [];
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT id, kind, reply_to_id, author_id, author_username, author_display_name,
            avatar_url, content, posted_at, edited_at, reactions_json
       FROM council_messages
      WHERE channel_id = ? AND removed = 0
      ORDER BY posted_at ASC`,
  ).bind(channelId).all();
  return results || [];
}
