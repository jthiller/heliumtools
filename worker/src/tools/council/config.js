// Council (advisory-council nominations) tool — configuration.
//
// A blind page (not listed on the landing page) that lists Helium advisory-council
// nominees from the Discord #advisory-council channel. Primary ingest is a worker-side
// bot poll on the 6-hourly cron (services/poll.js, Authorization: Bot); a manual
// admin-token push to /council/ingest is the override. Viewers read a KV-cached feed.
// See CLAUDE.md.

// The Discord guild + channel this page is built for. Flip COUNCIL_CHANNEL_ID for a
// future election cycle. The channel id is the ingest contract's `channelId` (a push
// for any other channel is rejected) and both ids build the per-message Discord link.
export const COUNCIL_GUILD_ID = "404106811252408320";
export const COUNCIL_CHANNEL_ID = "1524096173206536242";

// How the scraper classifies each message. Top-level nomination posts and their
// supporting replies render; `other` (chatter, troll noise) is stored so reply
// chains stay intact but is filtered out of the public feed at read time.
export const MESSAGE_KINDS = new Set(["nomination", "support", "other"]);

// Ingest body cap. Enforced twice (declared Content-Length when present, then the
// decoded text length) so neither a lying header nor an absent one can smuggle a
// huge payload past the guard.
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

// Defensive caps on one ingest payload (the channel is tiny; these only bound a
// buggy or hostile push). Content over MAX_CONTENT_CHARS is truncated; reactions
// beyond MAX_REACTIONS are dropped; each reaction's emoji string and count are
// clamped so a scraper bug can't serve an absurd value to every viewer.
export const MAX_MESSAGES = 5000;
export const MAX_CONTENT_CHARS = 8000;
export const MAX_REACTIONS = 50;
export const MAX_EMOJI_CHARS = 64;
export const MAX_REACTION_COUNT = 1_000_000;

// scrapedAt may not be further in the future than this (clock skew allowance). A
// far-future stamp would poison the replay guard — every later legitimate push
// would 409 forever — so it's rejected at ingest.
export const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

// avatarUrl is kept only for these Discord CDN hosts (else nulled) — a default
// avatar or any other host can't inject an arbitrary <img> src into the page.
export const AVATAR_URL_PREFIXES = [
  "https://cdn.discordapp.com/",
  "https://media.discordapp.net/",
];

// D1 has a per-batch statement ceiling; upserts are chunked at this size.
export const D1_BATCH_CHUNK = 50;

// Heuristic classification (services/classify.js) for the Discord-bot poller. Real
// nominations are long self-intro posts; a top-level message at least this many
// characters (and not the channel-intro announcement) is treated as a nomination.
// Replies are treated as support. This is a deliberately simple first pass — see
// the CLAUDE.md note on upgrading to LLM classification if it proves too coarse.
export const NOMINATION_MIN_CHARS = 400;

// KV keys. The public feed is cached briefly; the replay-guard meta is written
// with no TTL (it must outlive any single snapshot to reject out-of-order pushes).
export const NOMINATIONS_CACHE_KEY = "council:nominations";
export const NOMINATIONS_CACHE_TTL = 60;
export const META_KEY = "council:meta";
// Flat, presentation-ready feed for an external CMS (Framer) to sync from.
export const CMS_CACHE_KEY = "council:cms";
// Review/moderation store (no TTL): { "<msgId>": { status: "approved"|"rejected",
// reason, at } }. Ids absent from the map are "pending" (held). Written only by the
// admin /moderate endpoint + the one-time bootstrap; the hourly poll never touches it,
// so decisions survive re-polls. Gates BOTH /nominations and /cms.
export const REVIEW_KEY = "council:review";

// IP rate limit on the public read (the ingest is gated by the admin token, not IP).
export const RATE_LIMIT = {
  prefix: "rl:council",
  maxRequests: 60,
  windowSeconds: 60,
};
