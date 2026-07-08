// Proxy re-attribution: some nominations are posted by one member on another's
// behalf ("Application: <@candidate>", "On behalf of <@candidate>"). Without this,
// the card would credit the poster. When a nomination opens with a proxy preface
// that @-mentions someone, re-attribute the nomination to that mentioned candidate
// (name, handle, avatar from the resolved mention) and drop the preface line.

import { cdnAvatar } from "./discord.js";

// First line reads as "posting for someone else".
const PROXY_PREFACE =
  /^\s*(application|nomination|candidacy|proxy|on behalf of|posting(?:\s+this)?\s+for|below is)\b/i;

export function applyProxyAttribution(m) {
  if (!m || m.kind !== "nomination") return m;
  const content = m.content || "";
  const nl = content.indexOf("\n");
  const firstLine = nl === -1 ? content : content.slice(0, nl);
  if (!PROXY_PREFACE.test(firstLine)) return m;

  const mention = firstLine.match(/<@!?(\d+)>/);
  if (!mention) return m;
  const candidate = (m.mentions || []).find((u) => u.id === mention[1]);
  if (!candidate || !candidate.displayName) return m;

  return {
    ...m,
    authorId: candidate.id,
    authorUsername: candidate.username ?? m.authorUsername,
    authorDisplayName: candidate.displayName,
    avatarUrl: cdnAvatar(candidate.id, candidate.avatar),
    // Drop the now-redundant "Application: @candidate" preface line.
    content: nl === -1 ? content : content.slice(nl + 1).replace(/^\s+/, ""),
  };
}
