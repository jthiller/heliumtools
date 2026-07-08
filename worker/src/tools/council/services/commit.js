// Shared "apply a validated snapshot to storage" step, used by BOTH the HTTP push
// endpoint (handlers/ingest.js) and the Discord-bot poller (services/poll.js), so
// the two ingest sources behave identically: same upsert, same complete-scrape
// soft-removal, same cache invalidation and replay-guard meta stamp.

import { NOMINATIONS_CACHE_KEY, META_KEY } from "../config.js";
import { getStoredIds, upsertMessages, softRemoveStale } from "./store.js";

/**
 * Commit an already validated + normalized snapshot.
 * `value` = { channelId, guildId, scrapedAt, complete, messages }.
 * Returns { received, inserted, updated, removed, scrapedAt }.
 */
export async function commitSnapshot(env, value) {
  const { channelId, guildId, scrapedAt, complete, messages } = value;

  // inserted vs updated is decided against the ids already stored for the channel.
  const storedIds = await getStoredIds(env, channelId);
  let inserted = 0;
  for (const m of messages) {
    if (!storedIds.has(m.id)) inserted++;
  }
  const updated = messages.length - inserted;

  await upsertMessages(env, channelId, guildId, scrapedAt, messages);

  // Only a complete-channel snapshot may soft-remove rows it didn't carry
  // (deleted in Discord). A partial one must not.
  let removed = 0;
  if (complete) {
    removed = await softRemoveStale(env, channelId, scrapedAt);
  }

  // Invalidate the public read cache and stamp the replay-guard meta (no TTL).
  // Best-effort: a KV hiccup must not fail a commit whose D1 write succeeded.
  try {
    if (env.KV) {
      await env.KV.delete(NOMINATIONS_CACHE_KEY);
      await env.KV.put(
        META_KEY,
        JSON.stringify({ scrapedAt, channelId, guildId, updatedAt: Date.now() }),
      );
    }
  } catch {
    // best-effort
  }

  return { received: messages.length, inserted, updated, removed, scrapedAt };
}
