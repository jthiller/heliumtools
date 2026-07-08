// Pure assembly: live council_messages rows → the nominations tree the public feed
// returns. Support→nomination linking is resolved HERE (never persisted), so a
// message changing kind between scrapes can't leave a stale link. `other` rows are
// filtered out of the output but kept in the id map so reply chains through them
// still resolve.

import { COUNCIL_GUILD_ID, COUNCIL_CHANNEL_ID } from "../config.js";

function messageLink(id) {
  return `https://discord.com/channels/${COUNCIL_GUILD_ID}/${COUNCIL_CHANNEL_ID}/${id}`;
}

function parseReactions(json) {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// A stored row → its public shape (camelCase, parsed reactions, Discord link).
function toPublic(row) {
  return {
    id: row.id,
    authorId: row.author_id ?? null,
    authorUsername: row.author_username ?? null,
    authorDisplayName: row.author_display_name,
    avatarUrl: row.avatar_url ?? null,
    content: row.content,
    postedAt: row.posted_at,
    editedAt: row.edited_at ?? null,
    link: messageLink(row.id),
    reactions: parseReactions(row.reactions_json),
  };
}

/**
 * Rows → `{ nominations, unattachedSupports }`.
 * - Nominations sorted `postedAt` DESC; each nomination's endorsements sorted ASC.
 * - Supports attach via a one-level reply walk (see `resolveNominationId`);
 *   unresolvable supports are tallied into the `unattachedSupports` count.
 */
export function assembleNominations(rows) {
  const byId = new Map();
  for (const row of rows) byId.set(row.id, row);

  const nominations = [];
  const nominationById = new Map();
  for (const row of rows) {
    if (row.kind !== "nomination") continue;
    const nom = { ...toPublic(row), endorsements: [] };
    nominations.push(nom);
    nominationById.set(row.id, nom);
  }

  let unattachedSupports = 0;
  for (const row of rows) {
    if (row.kind !== "support") continue;
    const nominationId = resolveNominationId(row, byId);
    const nom = nominationId != null ? nominationById.get(nominationId) : null;
    if (nom) {
      nom.endorsements.push(toPublic(row));
    } else {
      unattachedSupports++;
    }
  }

  nominations.sort((a, b) => b.postedAt - a.postedAt);
  for (const nom of nominations) {
    nom.endorsements.sort((a, b) => a.postedAt - b.postedAt);
  }

  return { nominations, unattachedSupports };
}

// One-level walk: a support replying straight to a nomination attaches to it; a
// support replying to another support attaches to THAT support's nomination (its
// parent). Anything else (reply to chatter, a missing/removed target, or no reply)
// is unresolvable.
function resolveNominationId(support, byId) {
  const parent = support.reply_to_id != null ? byId.get(support.reply_to_id) : null;
  if (!parent) return null;
  if (parent.kind === "nomination") return parent.id;
  if (parent.kind === "support") {
    const grandparent =
      parent.reply_to_id != null ? byId.get(parent.reply_to_id) : null;
    if (grandparent && grandparent.kind === "nomination") return grandparent.id;
  }
  return null;
}
