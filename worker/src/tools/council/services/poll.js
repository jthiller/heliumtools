// Council poller — the primary ingest source. Runs on the worker cron: reads the
// Discord channel with the bot token, classifies each message, and commits a full
// snapshot through the same validated store path the /ingest push endpoint uses.
// A full read every run means `complete: true`, so deleted messages soft-remove.

import { COUNCIL_CHANNEL_ID, COUNCIL_GUILD_ID } from "../config.js";
import { fetchChannelMessages, mapMessage } from "./discord.js";
import { classifyMessage } from "./classify.js";
import { validatePayload } from "./validate.js";
import { commitSnapshot } from "./commit.js";

/**
 * Poll Discord and refresh the stored snapshot. No-op (returns { skipped }) when the
 * bot token isn't configured, so the cron stays quiet until the bot is set up.
 * Returns the commit counts; throws on a Discord or validation failure (the caller
 * wraps it so one failing cron task never kills the others).
 */
export async function pollCouncil(env) {
  if (!env.DISCORD_BOT_TOKEN) {
    console.log("council poll skipped: DISCORD_BOT_TOKEN not configured");
    return { skipped: true };
  }

  const { messages: raw, complete } = await fetchChannelMessages(env);
  const messages = raw
    .map(mapMessage)
    .filter(Boolean)
    .map((m) => ({ ...m, kind: classifyMessage(m) }));

  // Guard against the "Message Content intent disabled" failure mode: Discord then
  // returns 200 with empty content on every message. Committing that as a complete
  // snapshot would overwrite every nomination with blank content and empty the page.
  // Refuse to commit and surface the likely cause instead.
  if (messages.length > 0 && messages.every((m) => !m.content)) {
    throw new Error(
      "every message came back with empty content — enable the Message Content intent on the bot",
    );
  }

  const payload = {
    channelId: COUNCIL_CHANNEL_ID,
    guildId: COUNCIL_GUILD_ID,
    scrapedAt: Date.now(),
    // Truncated fetch (hit the page cap) → not complete, so soft-remove is skipped
    // and older un-fetched nominations aren't retired.
    complete,
    messages,
  };

  // Run through the same validator the push endpoint uses (host allowlist on
  // avatars, reaction caps, snowflake checks, dedup) so both sources are identical.
  const validated = validatePayload(payload);
  if (validated.error) {
    throw new Error(
      `council poll produced an invalid payload: ${validated.error}` +
        (validated.messageIndex !== undefined ? ` (message ${validated.messageIndex})` : ""),
    );
  }

  // The replay guard (older-scrapedAt → 409) is push-only; the poll is live Discord
  // truth on a fresh timestamp each run, so it commits directly.
  const counts = await commitSnapshot(env, validated.value);
  const kinds = messages.reduce((a, m) => ((a[m.kind] = (a[m.kind] || 0) + 1), a), {});
  console.log(
    `council poll: received ${counts.received} (${JSON.stringify(kinds)}), ` +
      `inserted ${counts.inserted}, updated ${counts.updated}, removed ${counts.removed}`,
  );
  return counts;
}
