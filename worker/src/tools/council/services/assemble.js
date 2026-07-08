// Pure assembly: live council_messages rows → the nominations tree the public feed
// returns. Support→nomination linking is resolved HERE (never persisted), so a
// message changing kind between scrapes can't leave a stale link. `other` rows are
// filtered out of the output but kept in the id map so reply chains through them
// still resolve.

import { COUNCIL_GUILD_ID, COUNCIL_CHANNEL_ID, NOMINATIONS_CLOSE_MS } from "../config.js";
import { presentNomination } from "./present.js";

// The ballot freezes at the nominations-close instant: a message posted after it can't
// be shown as a nomination or an endorsement (see config.js NOMINATIONS_CLOSE_MS). This
// is a fixed postedAt bound, so it filters nothing before the deadline and freezes the
// displayed set after — while the poll keeps refreshing reaction counts on that set.
const withinBallot = (row) =>
  !Number.isFinite(NOMINATIONS_CLOSE_MS) || row.posted_at <= NOMINATIONS_CLOSE_MS;

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

// The nomination for an author is their EARLIEST long top-level post. Any later
// long top-level post by the same author is not a second nomination — it's an
// endorsement / re-declaration the heuristic classifier mis-promoted (e.g. a
// candidate posting "here are my favorite two other candidates"). Proxy nominations
// are already re-attributed to the candidate's authorId (services/proxy.js), so this
// keys on the right person. authorId is present for real Discord authors; fall back
// to username/display name defensively.
const authorKeyOf = (nom) => nom.authorId || nom.authorUsername || nom.authorDisplayName;

/**
 * Rows → `{ nominations, unattachedSupports }`.
 * - Only messages posted on/before NOMINATIONS_CLOSE_MS are eligible (the ballot
 *   freezes at close; reaction counts on the frozen set still update via the poll).
 * - At most one nomination per author (the earliest); later same-author "nominations"
 *   are dropped and any endorsements on them are folded into the kept one.
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
    if (!withinBallot(row)) continue; // ballot frozen at close — no new nominations
    const base = toPublic(row);
    // Presentation fields (same logic the /council page uses): the lifted candidate
    // name and the body with any redundant name-header line removed.
    const { candidateName, body } = presentNomination(base.content, base.authorDisplayName);
    const nom = { ...base, candidateName, body, endorsements: [] };
    nominations.push(nom);
    nominationById.set(row.id, nom);
  }

  let unattachedSupports = 0;
  for (const row of rows) {
    if (row.kind !== "support") continue;
    if (!withinBallot(row)) continue; // endorsements freeze at close too (reactions still update)
    const nominationId = resolveNominationId(row, byId);
    const nom = nominationId != null ? nominationById.get(nominationId) : null;
    if (nom) {
      nom.endorsements.push(toPublic(row));
    } else {
      unattachedSupports++;
    }
  }

  // One nomination per author: keep the earliest, fold later duplicates' endorsements
  // into it, drop the rest (they are not additional nominations).
  const canonicalByAuthor = new Map();
  for (const nom of nominations) {
    const key = authorKeyOf(nom);
    const existing = canonicalByAuthor.get(key);
    if (!existing) {
      canonicalByAuthor.set(key, nom);
      continue;
    }
    const keep = existing.postedAt <= nom.postedAt ? existing : nom;
    const drop = keep === existing ? nom : existing;
    keep.endorsements.push(...drop.endorsements);
    canonicalByAuthor.set(key, keep);
  }
  const deduped = [...canonicalByAuthor.values()];

  deduped.sort((a, b) => b.postedAt - a.postedAt);
  for (const nom of deduped) {
    nom.endorsements.sort((a, b) => a.postedAt - b.postedAt);
  }

  return { nominations: deduped, unattachedSupports };
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
