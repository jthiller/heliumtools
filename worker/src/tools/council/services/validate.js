// Pure validation + normalization of an ingest payload. No D1/KV — just shape
// checks and coercion, so it's trivially testable. The scraper is a controlled
// client, so validation rejects the WHOLE payload on the first bad message
// (`{ error, messageIndex }`) rather than silently skipping it — a silent skip
// would hide a scraper bug behind a partially-ingested snapshot.

import {
  COUNCIL_CHANNEL_ID,
  COUNCIL_GUILD_ID,
  MESSAGE_KINDS,
  MAX_MESSAGES,
  MAX_CONTENT_CHARS,
  MAX_REACTIONS,
  MAX_EMOJI_CHARS,
  MAX_REACTION_COUNT,
  AVATAR_URL_PREFIXES,
} from "../config.js";

// Discord snowflakes are 15-20 digit unsigned 64-bit ids; match the scraper's own
// filter so a bad id fails the same way on both sides rather than slipping through.
const SNOWFLAKE_RE = /^\d{15,20}$/;

function isSnowflake(v) {
  return typeof v === "string" && SNOWFLAKE_RE.test(v);
}

/**
 * Validate + normalize the ingest payload.
 * Returns `{ value: { channelId, guildId, scrapedAt, complete, messages } }` on
 * success, or `{ error }` (with `messageIndex` for a per-message failure) to
 * reject with 400.
 */
export function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "Payload must be an object" };
  }
  const { channelId, guildId, scrapedAt, complete, messages } = payload;

  if (channelId !== COUNCIL_CHANNEL_ID) {
    return { error: "channelId does not match the council channel" };
  }
  if (guildId !== COUNCIL_GUILD_ID) {
    return { error: "guildId does not match the council guild" };
  }
  if (!Number.isFinite(scrapedAt)) {
    return { error: "scrapedAt must be a millisecond timestamp" };
  }
  if (typeof complete !== "boolean") {
    return { error: "complete must be a boolean" };
  }
  if (!Array.isArray(messages)) {
    return { error: "messages must be an array" };
  }
  if (messages.length > MAX_MESSAGES) {
    return { error: `messages exceeds the ${MAX_MESSAGES} cap` };
  }

  const normalized = [];
  const seenIds = new Set();
  for (let i = 0; i < messages.length; i++) {
    const result = normalizeMessage(messages[i]);
    if (result.error) return { error: result.error, messageIndex: i };
    // A duplicate id is a scraper bug: INSERT OR REPLACE would collapse it to one
    // row while the counts reported two. Reject fail-fast like any other bad message.
    if (seenIds.has(result.value.id)) {
      return { error: "duplicate message id in payload", messageIndex: i };
    }
    seenIds.add(result.value.id);
    normalized.push(result.value);
  }

  return { value: { channelId, guildId, scrapedAt, complete, messages: normalized } };
}

// One message → `{ value }` or `{ error }`. `authorId`/`authorUsername` are
// nullable (default avatars carry no user id; the DOM shows a display name, not
// always a @handle); `authorDisplayName` is always present.
function normalizeMessage(msg) {
  if (!msg || typeof msg !== "object") {
    return { error: "message must be an object" };
  }
  if (!isSnowflake(msg.id)) {
    return { error: "message id must be a snowflake" };
  }
  if (!MESSAGE_KINDS.has(msg.kind)) {
    return { error: "message kind is not recognized" };
  }
  if (msg.replyToId != null && !isSnowflake(msg.replyToId)) {
    return { error: "replyToId must be a snowflake or null" };
  }
  if (msg.authorId != null && !isSnowflake(msg.authorId)) {
    return { error: "authorId must be a snowflake or null" };
  }
  if (msg.authorUsername != null && typeof msg.authorUsername !== "string") {
    return { error: "authorUsername must be a string or null" };
  }
  if (typeof msg.authorDisplayName !== "string" || msg.authorDisplayName.trim() === "") {
    return { error: "authorDisplayName is required" };
  }
  if (typeof msg.content !== "string") {
    return { error: "content must be a string" };
  }
  if (!Number.isFinite(msg.postedAt)) {
    return { error: "postedAt must be a millisecond timestamp" };
  }
  if (msg.editedAt != null && !Number.isFinite(msg.editedAt)) {
    return { error: "editedAt must be a millisecond timestamp or null" };
  }

  return {
    value: {
      id: msg.id,
      kind: msg.kind,
      replyToId: msg.replyToId ?? null,
      authorId: msg.authorId ?? null,
      authorUsername: msg.authorUsername ?? null,
      authorDisplayName: msg.authorDisplayName,
      avatarUrl: normalizeAvatarUrl(msg.avatarUrl),
      content: msg.content.slice(0, MAX_CONTENT_CHARS),
      postedAt: msg.postedAt,
      // The scraper emits -1 as an "edited, timestamp unknown" sentinel and is
      // told to convert it to null before POSTing; normalize non-positive here too
      // so a forgotten conversion can't leak a 1969 date into the public feed.
      editedAt: msg.editedAt != null && msg.editedAt > 0 ? msg.editedAt : null,
      reactions: normalizeReactions(msg.reactions),
    },
  };
}

// Keep only Discord CDN avatar URLs; anything else (default-avatar asset, foreign
// host, non-string) becomes null.
function normalizeAvatarUrl(url) {
  if (typeof url !== "string") return null;
  for (const prefix of AVATAR_URL_PREFIXES) {
    if (url.startsWith(prefix)) return url;
  }
  return null;
}

// `[{ emoji, count }]` → sane, capped entries. Drops malformed rows and any
// non-positive count; caps the array at MAX_REACTIONS and clamps each entry's
// emoji length and count so a buggy scraper can't serve absurd values to viewers.
function normalizeReactions(reactions) {
  if (!Array.isArray(reactions)) return [];
  const out = [];
  for (const r of reactions) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.emoji !== "string" || r.emoji === "") continue;
    const count = Math.trunc(Number(r.count));
    if (!Number.isFinite(count) || count <= 0) continue;
    out.push({
      emoji: r.emoji.slice(0, MAX_EMOJI_CHARS),
      count: Math.min(count, MAX_REACTION_COUNT),
    });
    if (out.length >= MAX_REACTIONS) break;
  }
  return out;
}
