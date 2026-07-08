// Heuristic message classification for the Discord-bot poller. The browser-scrape
// design had Claude classify each message; the worker can't do that judgment, so
// this applies structural rules that fit this channel's shape:
//
//   - A reply (has a reply target) is support for whatever it replies to. The
//     read-time walk in assemble.js attaches it to the right nomination.
//   - A top-level post long enough to be a real self-intro is a nomination, unless
//     it's the channel-intro announcement (which is also long and top-level).
//   - Everything else (short top-level chatter, "I'd nominate X" asides) is other.
//
// This is coarse by design — notably it can't tell a short supportive reply from a
// short jab, so both count as support. If that noise matters, swap this function
// for an LLM call (Workers AI or the Anthropic API); it's the single seam to change.

import { NOMINATION_MIN_CHARS } from "../config.js";

// Channel-intro / broadcast announcements: long and top-level, but not nominations.
const ANNOUNCEMENT_RE = /welcome to the|@everyone|^\s*@here/i;

export function classifyMessage(m) {
  if (m.replyToId) return "support";
  const content = m.content || "";
  if (ANNOUNCEMENT_RE.test(content.slice(0, 200))) return "other";
  if (content.length >= NOMINATION_MIN_CHARS) return "nomination";
  return "other";
}
