# Council (Advisory-Council Nominations)

A **blind page** (intentionally *not* linked from the landing page) that lists the
nominees in the Helium Discord **#advisory-council** channel: each nomination's
display name, @handle, avatar, text, a link to the Discord post, emoji-reaction
tallies, and supporting replies as sub-items.

- **Blind URL:** `https://heliumtools.org/council`.
- Built for guild `404106811252408320`, channel `1524096173206536242`
  (`config.js` — flip `COUNCIL_CHANNEL_ID` for a future election cycle).

## Architecture — worker-side Discord bot poll (primary) + manual push (override)

Two ingest sources, one shared commit path (`services/commit.js`):

```
PRIMARY: worker cron (hourly) → services/poll.js
  → fetchChannelMessages() reads the channel via Discord REST (Authorization: Bot …)
  → mapMessage() + classifyMessage()  →  same validate + commit as the push path
  → GET /council/nominations (public, KV-cached) → the page

OVERRIDE: curl POST /council/ingest (Bearer COUNCIL_INGEST_TOKEN)
  → validate + commit  (manual correction / backfill / a browser-scrape fallback)
```

Both sources go through `validatePayload` → `commitSnapshot` (upsert + complete-scrape
soft-remove + cache invalidation), so they behave identically. The poll is a full read
each run, so it's always `complete: true`.

**Why a bot poll, not a browser scrape.** The original design read the channel from a
logged-in browser (the `council-scrape` skill) and pushed to `/ingest`. That still works
as a manual override, but a sandboxed agent session filters bulk logged-in-session content
out of its browser tool results (anti-exfiltration), so it can't reliably carry full
nomination text to the ingest. A read-only **bot token** used server-side sidesteps that
entirely: the worker talks to Discord directly, with full content, on cron — no browser,
no user session. This needs the bot in the guild with **View Channel + Read Message
History** on the channel and the **Message Content** privileged intent enabled.

**Classification is heuristic** (`services/classify.js`): a reply → `support`; a
top-level post ≥ `NOMINATION_MIN_CHARS` and not the channel-intro announcement →
`nomination`; else `other`. This gets nominations right but can't tell a short
supportive reply from a short jab (both become `support`). If that endorsement noise
matters, replace `classifyMessage` with an LLM call (Workers AI or the Anthropic API) —
it's the single seam. The scraper's Claude-side classification was more precise; this is
the tradeoff for a fully-automated, browser-free pipeline.

Page freshness is the last successful poll; the frontend shows an honest "data N ago"
from `scrapedAt`. The manual-push skill lives at **`.claude/skills/council-scrape/`**
(now a disabled fallback — the bot poll is primary).

**Proxy nominations** (`services/proxy.js`): a nomination posted on someone's behalf
("Application: @X", "on behalf of @X") is re-attributed to the mentioned candidate —
name, @handle, and avatar are pulled from the mention Discord resolves in the payload
(`mapMessage` captures `mentions` transiently), and the preface line is dropped. So a
post by Keenon for PepeMexico shows as PepeMexico.

**Admin/debug endpoints** (Bearer `COUNCIL_INGEST_TOKEN` || `ADMIN_TOKEN`):
- `POST /council/refresh` (`handlers/refresh.js`) — force an immediate poll; returns the
  commit counts or the poll's own error (e.g. a Discord 403) as a token-free 502. Use
  after (re-)adding the bot instead of waiting for the cron.
- `GET /council/diag` (`handlers/diag.js`) — read-only: is the bot in the guild
  (`GET /guilds/{id}`, authoritative) and can it read the channel? Surfaces Discord's
  error code, so a poll failure pins to wrong-server vs missing channel permission.

## Files

```
config.js        constants (ids, caps, NOMINATION_MIN_CHARS, cache TTL, rate limit)
index.js         dispatch: OPTIONS/ingest/refresh/diag/nominations; exports pollCouncil for cron
handlers/        ingest.js (auth+validate+replay guard), refresh.js, diag.js, nominations.js (cache-first)
services/        discord.js (REST fetch + mapMessage + cdnAvatar), classify.js, proxy.js,
                 commit.js (shared upsert/soft-remove/cache), store.js (D1), validate.js, assemble.js (read-time tree)
```

## Adding the bot (Wick gauntlet)

The Helium Discord runs **Wick**, whose join-gate kicks bots on join. An unverified bot
added by an admin trips these filters in turn — disable each with `w!jg Xa ?off`, or
better, whitelist the bot id: `4a` unauthorized-adder, `6a` unverified-by-Discord (our
bot can't verify), `3a` account-age <5d, `7a` suspicious, `2a` no-avatar. jg filters act
on join, so re-enabling after the bot is in leaves it grandfathered. Durable fix:
whitelist bot id `1524254437181358140` in Wick. The OAuth invite hands off to the Discord
app (the "Add to Server" dialog is inside Discord, not the browser) and needs the admin's
2FA. `GET /council/diag` is the tool for confirming the bot actually stuck. See the
`council-tool-ops` memory for the full runbook.

## Ingest contract (shared with the scraper)

```
POST /council/ingest
Authorization: Bearer <COUNCIL_INGEST_TOKEN>   # or ADMIN_TOKEN fallback
{
  "channelId": "1524096173206536242",   // must equal COUNCIL_CHANNEL_ID (else 400)
  "guildId":   "404106811252408320",
  "scrapedAt": <ms epoch>,               // replay guard key
  "complete":  true,                     // full-channel scrape → may soft-remove
  "messages": [{
    "id": "<snowflake>",                 // required
    "kind": "nomination"|"support"|"other",
    "replyToId": "<snowflake>"|null,
    "authorId": "<snowflake>"|null,      // null for default avatars (no user id)
    "authorUsername": "..."|null,        // @handle, null when unknown
    "authorDisplayName": "...",          // required (always in the DOM)
    "avatarUrl": "https://cdn.discordapp.com/..."|null,
    "content": "...", "postedAt": <ms>, "editedAt": <ms>|null,
    "reactions": [{ "emoji": "👍", "count": 12 }]
  }]
}
```

Response: `{ ok, received, inserted, updated, removed, scrapedAt }`.

**Validation is whole-payload, fail-fast.** The scraper is a controlled client, so
a single bad message rejects the entire push with `400 { error, messageIndex }`
rather than being silently skipped (a silent skip would hide a scraper bug). Checks
(`services/validate.js`, pure): `channelId` equals `COUNCIL_CHANNEL_ID`; `guildId`,
`id` are snowflakes; `authorId` is a snowflake **or null**; `kind` is in the set;
`authorDisplayName` is a non-empty string; `avatarUrl` is kept only for
`cdn.discordapp.com` / `media.discordapp.net` hosts (else nulled); reactions are
normalized + capped. Other guards: unset `ADMIN_TOKEN` → **503**; token mismatch →
**401**; body over `MAX_BODY_BYTES` (4 MB, checked on `Content-Length` when present
**and** on the decoded byte length) → **413**; unparseable JSON → **400**. Auth
resolves `COUNCIL_INGEST_TOKEN` then falls back to `ADMIN_TOKEN`; with neither set
the endpoint is disabled → **503** (see Environment).

`GET /council/nominations` → `{ generatedAt, scrapedAt, nominations, unattachedSupports }`
where each nomination is `{ id, authorId, authorUsername, authorDisplayName,
avatarUrl, content, postedAt, editedAt, link, reactions, endorsements: [...] }` and
`link = https://discord.com/channels/<guild>/<channel>/<id>`. Empty DB → `200` with
`nominations: []`.

## Storage model — one table, resolved at read time

**One table** `council_messages` (`kind` + `reply_to_id` columns), not separate
nomination/endorsement tables: the column shape is identical and a re-classification
between scrapes is a plain `INSERT OR REPLACE`, never a cross-table move. `other`
rows are stored (so reply-chain targets stay intact) and filtered out at read time.

- **Read-time linking.** Support→nomination attachment is computed in-memory in
  `services/assemble.js` on every read, **never persisted**. One-level walk: a
  support replying straight to a nomination attaches to it; a support replying to
  another support attaches to *that support's* nomination (its parent). Anything
  else is unresolvable and tallied into the top-level `unattachedSupports` count.
  Resolving at read time means a message changing `kind` between scrapes can never
  leave a stale link behind.
- **Soft-removal.** Every upsert stamps `removed = 0` and `last_seen_at = scrapedAt`.
  After a `complete: true` payload, `UPDATE ... SET removed = 1 WHERE channel_id = ?
  AND removed = 0 AND last_seen_at < scrapedAt` retires rows the snapshot didn't
  carry (deleted in Discord). A reappearing message auto-resurrects via the next
  upsert. A partial/degraded scrape (`complete: false`) skips this, so a partial
  view never deletes anything. The `removed` response count is rows *newly* retired
  this run.
- **Replay guard.** Ingest reads `council:meta` and rejects a payload whose
  `scrapedAt` is **older** than the stored one with `409 { error, storedScrapedAt }`.
  Equal `scrapedAt` is allowed (idempotent re-push). After a successful write the
  meta is re-stamped.
- **inserted vs updated** is decided against the set of ids already stored for the
  channel (a `removed` row counts as existing — an upsert resurrects it).

DDL self-provisions via `ensureSchema` in `services/store.js` (isolate-cached flag,
vote-tool pattern) and is mirrored in `worker/schema.sql`. `author_id` /
`author_username` are nullable; `author_display_name` is `NOT NULL`.

## Read path — cache-first before the rate limiter

`GET /council/nominations` reads the KV cache **before** `checkIpRateLimit`
(wallet-dashboard `summary.js` pattern): a cached response never spends a token,
because the limiter only exists to protect the D1 read + assembly. On a miss it
rate-limits, selects live rows, assembles, caches, and returns. There is **no**
rate limit on ingest — the bearer token is the gate.

## Storage keys

### KV
- `council:nominations` — cached `/nominations` response (`NOMINATIONS_CACHE_TTL`,
  60s). Deleted by every successful ingest so the next read rebuilds.
- `council:meta` — `{ scrapedAt, channelId, guildId, updatedAt }`, written with
  **no TTL** (it must outlive any single snapshot to power the replay guard and the
  page's freshness). Written directly via `env.KV.put`, best-effort (a KV failure
  never fails an ingest whose D1 write already succeeded).
- `rl:council:*` — IP rate-limit counter for the public read.

### D1 (`DB` binding) — `council_messages`
`PRIMARY KEY (channel_id, id)`; see `worker/schema.sql` for the full DDL and the
`idx_council_messages_live (channel_id, removed, posted_at)` index.

## CORS

The primary poll is server-side (no browser, no CORS). The manual `/ingest` push is a
**curl** client, also not a browser. So the shared `corsHeaders`
(`worker/src/lib/response.js`) — which allow-list `Content-Type, X-User-Uuid,
Coinbase-Signature` but **not `Authorization`** — are fine as-is, and `OPTIONS` returns
`204` with them. We deliberately do **not** add `Authorization` to
`Access-Control-Allow-Headers`: enabling a browser to POST the snapshot cross-origin
would be a way to route logged-in-session data around the sandbox's anti-exfiltration
guard, which is exactly why the bot-poll path exists instead.

## Environment

- `DISCORD_BOT_TOKEN` — read-only bot token for the primary poll (`Authorization:
  Bot …`). Set via `wrangler secret put DISCORD_BOT_TOKEN --env production`. Unset ⇒
  the hourly `council-poll` cron task is a **no-op** (logs "skipped"), so the tool
  ships dormant until the bot is configured. The bot must be in the guild with View
  Channel + Read Message History on the channel and the **Message Content** intent on.
- `COUNCIL_INGEST_TOKEN` — dedicated bearer token gating the manual `POST /council/ingest`
  override, resolved **first**. Lets the ingest rotate independently of the
  OUI-notifier admin route. Set via `wrangler secret put COUNCIL_INGEST_TOKEN --env production`.
- `ADMIN_TOKEN` — **fallback** when `COUNCIL_INGEST_TOKEN` is unset (also gates the
  OUI-notifier admin route). Resolution is `env.COUNCIL_INGEST_TOKEN || env.ADMIN_TOKEN`;
  both unset ⇒ ingest returns **503**, a header mismatch on the resolved token ⇒ **401**.
  **Never log or expose** either value.
- The manual-push scraper reads its copy of `COUNCIL_INGEST_TOKEN` from
  `~/.config/heliumtools/council-admin-token` (outside the repo, never committed).
- `KV` — read cache, replay-guard meta, rate-limit counter.
- `DB` (D1) — the `council_messages` table. A missing `DB` binding makes ingest
  return **503** (rather than silently no-op the writes). No new binding. The only
  cron is the shared hourly tick driving `council-poll` (see `worker/src/index.js`).

## Related

- Scraper skill: `.claude/skills/council-scrape/` (`SKILL.md`, `extract.js`).
- Sibling blind page: `worker/src/tools/vote/CLAUDE.md` (same self-provisioning D1
  + KV-cache + cache-before-rate-limit conventions).
- Frontend: `pages/public/src/council/Council.jsx`, client
  `pages/public/src/lib/councilApi.js`, route in `pages/public/src/main.jsx`
  (blind — absent from `Landing.jsx`). Display logic lives in `Council.jsx`:
  `parseCandidateName` lifts the candidate's name from a nomination's first line into
  the card header and strips the redundant preface (conservative — skips greetings,
  titles, sentences); `DiscordText` renders basic inline markdown
  (`***`/`**`/`*`/`__`/`~~`/`` ` ``) as React elements (no `dangerouslySetInnerHTML`)
  plus https linkify and mention/emoji degrade. Polls the public feed every 60s while
  the tab is visible.
- Operational runbook (tokens, Wick, re-adding the bot): the `council-tool-ops` memory.

## Touchpoints (everything this tool added)

This tool is **temporary** — it exists for one advisory-council election and will be
torn down afterward. Every place it touches, so teardown is a clean checklist:

**Repo — council-only (safe to delete wholesale):**
- `worker/src/tools/council/**` (this whole directory).
- `pages/public/src/council/Council.jsx`, `pages/public/src/lib/councilApi.js`.
- `.claude/skills/council-scrape/**` (the disabled browser-scrape fallback + `extract.js`).

**Repo — shared files (edit, don't delete):**
- `worker/src/index.js` — the `import { handleCouncilRequest, pollCouncil }`, the
  `{ prefix: "/council", handler }` route, and the `run("council-poll", …)` line in
  `scheduled()`.
- `worker/src/index.js` + `worker/wrangler.jsonc` — **the cron is now shared/hourly
  because of this tool.** The four `0 0/6/12/18` crons were collapsed into one
  `0 * * * *`, and `scheduled()` gates OUI/DC/IoT to `hour % 6 === 0` and the OUI cache
  to `hour === 0`. Removing council must NOT break those cadences (see teardown).
- `worker/schema.sql` — the `council_messages` DDL block (also self-provisioned by
  `services/store.js`).
- `worker/.dev.vars.example` — `DISCORD_BOT_TOKEN` and `COUNCIL_INGEST_TOKEN` lines.
- `pages/public/src/main.jsx` — the lazy import + `<Route path="/council">`.
- Root `CLAUDE.md` — the Council table row and the cron description.
- `Landing.jsx` — **not touched** (blind page); nothing to undo there.

**Production infra:**
- D1 (`heliumtools-prod`): table `council_messages`.
- KV: keys `council:nominations`, `council:meta`, and `rl:council:*` rate-limit counters.
- Secrets: `DISCORD_BOT_TOKEN`, `COUNCIL_INGEST_TOKEN`. (No new binding — shares `DB`/`KV`.)

**This machine (not in the repo):**
- Token file `~/.config/heliumtools/council-admin-token`.
- Desktop scheduled task `council-scrape` (currently disabled).
- Memories `council-tool-ops`, `council-scrape-harvest-race` (keep
  `claude-in-chrome-exfiltration-filter` — it's general).

**External (Discord side):**
- Discord application/bot **`heliumtools-council`** (app/user id `1524254437181358140`),
  a member of the Official Helium Community guild (`404106811252408320`).
- **Wick was weakened to let the bot in**: join-gate filters `2a/3a/4a/6a/7a` were
  toggled `?off` (or the bot whitelisted). Teardown must restore them.

## Teardown (after the election)

1. **Restore Discord security first.** Re-enable the Wick filters that were turned off
   (`w!jg 2a ?on`, `3a`, `4a`, `6a`, `7a`), and/or remove the bot from Wick's whitelist.
   Then remove/kick the **heliumtools-council** bot from the server (and optionally
   delete the Discord application). This is the most important step — we lowered a
   shared server's raid protection to add the bot.
2. **Worker code**: delete `worker/src/tools/council/`; in `worker/src/index.js` remove
   the import, the `/council` route, and the `run("council-poll", …)` line. Decide on
   the cron: simplest is to leave the hourly cron + `hour % 6` gating as-is (the other
   tasks keep their cadence; the worker just wakes hourly). To fully revert, restore the
   four `0 0/6/12/18` crons in `wrangler.jsonc` and the original ungated `scheduled()`.
3. **Frontend**: delete `pages/public/src/council/` and `lib/councilApi.js`; remove the
   lazy import + route in `main.jsx`.
4. **Schema/secrets/data**: remove the `council_messages` block from `schema.sql`;
   `DROP TABLE council_messages` on prod D1; delete KV keys `council:nominations`,
   `council:meta`, `rl:council:*`; `wrangler secret delete DISCORD_BOT_TOKEN` and
   `COUNCIL_INGEST_TOKEN --env production`; remove both from `.dev.vars.example`.
5. **Skill/local**: delete `.claude/skills/council-scrape/`, the desktop `council-scrape`
   scheduled task, and `~/.config/heliumtools/council-admin-token`.
6. **Docs**: drop the Council row + cron mention from root `CLAUDE.md`; delete the
   `council-tool-ops` / `council-scrape-harvest-race` memories.
7. Commit + push (auto-deploys). Confirm `GET https://api.heliumtools.org/council/nominations`
   is 404 and `heliumtools.org/council` no longer resolves.
