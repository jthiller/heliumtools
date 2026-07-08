// Discord REST client for the council poller. The worker reads the channel with a
// read-only bot token (Authorization: Bot ...) — no browser, no user account, so
// there is no logged-in-session data flow to guard. This is the primary ingest
// source; the /ingest push endpoint remains as a manual override.
//
// Requires the bot to be in the guild with View Channel + Read Message History on
// the channel, and the "Message Content" privileged intent enabled (otherwise
// `content` comes back empty).

import { COUNCIL_CHANNEL_ID } from "../config.js";

const API_BASE = "https://discord.com/api/v10";
// Discord requires a descriptive User-Agent on every API request.
const USER_AGENT = "DiscordBot (https://heliumtools.org, 1.0)";
const PAGE_LIMIT = 100; // max the messages endpoint allows per request
const MAX_PAGES = 10; // safety bound (1000 messages); the channel is far smaller

/**
 * Fetch every message currently in the council channel, newest-first across pages.
 * Returns `{ messages, complete }` — `complete` is false only if the MAX_PAGES cap
 * was hit with a still-full final batch (more history may remain), so the caller
 * can skip the soft-remove that would otherwise retire the un-fetched older rows.
 * Throws with a clear, token-free message on auth/permission/RPC failure.
 */
export async function fetchChannelMessages(env) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is not configured");
  }
  const headers = {
    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    "User-Agent": USER_AGENT,
  };
  const all = [];
  let before = null;
  let complete = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${API_BASE}/channels/${COUNCIL_CHANNEL_ID}/messages`);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (before) url.searchParams.set("before", before);

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401) throw new Error("Discord rejected the bot token (401)");
    if (!res.ok) {
      // Include Discord's own error message/code (e.g. "Missing Access" 50001 vs
      // "Missing Permissions" 50013) — safe to surface, no secrets — so a setup
      // problem is diagnosable from the /refresh response.
      let detail = "";
      try {
        const e = await res.json();
        if (e?.message) detail = `: ${e.message}${e.code ? ` (code ${e.code})` : ""}`;
      } catch {
        // no JSON body
      }
      if (res.status === 403) {
        throw new Error(
          `Bot lacks channel access (403)${detail}. Grant the bot View Channel + Read Message History on #advisory-council`,
        );
      }
      if (res.status === 429) throw new Error(`Discord rate limited the poll (429)${detail}`);
      throw new Error(`Discord messages fetch failed (${res.status})${detail}`);
    }

    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE_LIMIT) break; // reached the start of the channel
    before = batch[batch.length - 1].id;
    // Full batch on the last allowed page → there may be more we didn't fetch.
    if (page === MAX_PAGES - 1) complete = false;
  }
  return { messages: all, complete };
}

// Replace user-mention tokens (<@id> / <@!id>) with a readable "@Name" using the
// users Discord resolves in the message payload, so prose like "shout out to <@123>"
// renders as "shout out to @Jacob" instead of the frontend's "@member" fallback.
// `mentions` is the mapped shape ({ id, username, displayName }). Tokens with no
// matching user (role/channel mentions, or a user absent from the payload) are left
// as-is for the frontend to degrade.
export function resolveMentions(content, mentions) {
  if (!content || !Array.isArray(mentions) || mentions.length === 0) return content;
  const byId = new Map(mentions.map((u) => [u.id, u.displayName || u.username]));
  return content.replace(/<@!?(\d+)>/g, (tok, id) => {
    const name = byId.get(id);
    return name ? `@${name}` : tok;
  });
}

// Discord CDN avatar URL for a user id + avatar hash, or null for a default
// (hashless) avatar. Only cdn.discordapp.com is produced, which the validator's
// host allowlist accepts. Exported for reuse by proxy re-attribution.
export function cdnAvatar(id, hash) {
  if (!id || !hash) return null;
  const ext = hash.startsWith("a_") ? "gif" : "webp";
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}`;
}

/**
 * Map a raw Discord message to the internal ingest shape (kind is assigned later
 * by classify.js). Returns null for message types we don't surface (joins, pins,
 * boosts, etc.) — only default (0) and reply (19) carry nomination/support content.
 */
export function mapMessage(raw) {
  if (!raw || (raw.type !== 0 && raw.type !== 19)) return null;
  const author = raw.author || {};
  // Account display name, then @username. (The REST messages endpoint doesn't
  // include a guild `member`, so a server nickname isn't available here.)
  const displayName = author.global_name || author.username || "Unknown";
  return {
    id: raw.id,
    // Only a reply (type 19) is an actual reply; a type-0 message can carry a
    // message_reference for a forward, which is not a reply to a channel message.
    replyToId: raw.type === 19 ? (raw.message_reference?.message_id ?? null) : null,
    authorId: author.id ?? null,
    authorUsername: author.username ?? null,
    authorDisplayName: displayName,
    avatarUrl: cdnAvatar(author.id, author.avatar),
    content: raw.content ?? "",
    postedAt: Date.parse(raw.timestamp),
    editedAt: raw.edited_timestamp ? Date.parse(raw.edited_timestamp) : null,
    reactions: Array.isArray(raw.reactions)
      ? raw.reactions
          .map((r) => ({ emoji: r?.emoji?.name || "", count: Number(r?.count) || 0 }))
          .filter((r) => r.emoji)
      : [],
    // Resolved @mentions from the payload (transient — used for proxy re-attribution
    // in poll.js, then dropped by validation). Carries each mentioned user's handle,
    // display name, and avatar so a "posting on behalf of @X" nomination can be
    // attributed to the real candidate X.
    mentions: Array.isArray(raw.mentions)
      ? raw.mentions.map((u) => ({
          id: u.id,
          username: u.username ?? null,
          displayName: u.global_name || u.username || null,
          avatar: u.avatar ?? null,
        }))
      : [],
  };
}
