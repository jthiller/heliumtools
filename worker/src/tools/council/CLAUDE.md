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

**One nomination per author** (`services/assemble.js`, read-time): a candidate's
EARLIEST long top-level post is their nomination; any later long top-level post by the
same author is dropped (endorsements the heuristic mis-promoted — e.g. "here are my
favorite two other candidates", or a re-declaration). Keyed on `authorId` (proxy posts
are already re-attributed to the candidate's id), so it dedupes the right person, and it
runs at read time so it fixes the `/council` page and the `/council/cms` feed together.
These dropped posts can't be shown as attached endorsements (they're top-level and name
several people), so they're hidden rather than mis-shown as nominations.

**Review gate (moderation)** (`services/review.js`): nothing reaches the public
surfaces (`/nominations` + `/cms`) until it is reviewed **approved**; anything else is
held. The heuristic classifier can't judge *content* (FUD, scams, off-brand, a
non-candidate's long post the classifier promoted), so a **local Claude** review makes
that call — no server-side LLM/API key. State is a KV map (`council:review`,
`{ id: { status, reason } }`) set only by `POST /council/moderate`; the poll never
touches it (durable across re-polls). Admin reads via `GET /council/review`. The store
**fails closed**: `loadReviewMap` returns `{ ok, map }` and on any KV read error (or
missing binding) callers serve nothing and never persist — a blip can't wipe decisions
or re-approve held items. There is **no auto-grandfather**; approval is always an
explicit `/moderate` call (the deploy seeded the vetted set that was live at cutover).
The review itself is the `council-review` skill, run hourly by a scheduled local Claude
session (see Touchpoints). Note: a newly-approved candidate not yet in the Framer
collection is auto-created by the sync (it create-or-updates approved items by handle).

**Election timeline** (`config.js`, hard-coded dates for this one election):
- **Nominations close `2026-07-12T23:59:59.999Z`** (`NOMINATIONS_CLOSE_MS`). After that
  instant a post can't become a nomination or endorsement — `assemble.js` filters both to
  `postedAt <= close`, so the ballot freezes. It's a fixed `postedAt` bound (not a clock
  check): a no-op before the date, a freeze after. The poll keeps running, so **reaction
  counts on the frozen set stay live**. Endorsements freeze too (only reactions change
  post-close); relax that by dropping the `withinBallot` check in the support loop.
- **Poll stopped `2026-07-15T00:00:00Z`** (`POLL_STOP_MS`). `pollCouncil` no-ops after
  this, freezing the page at its final snapshot. Brought forward from the planned
  2026-07-19 when the **Discord bot was removed** (2026-07-15) — with the bot gone the
  poll would 403 hourly, so stopping it keeps the worker quiet. The worker no longer
  calls Discord; `DISCORD_BOT_TOKEN` is now unused (deleted in full teardown).

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
config.js        constants (ids, caps, NOMINATION_MIN_CHARS, cache keys/TTL, rate limit)
index.js         dispatch: OPTIONS/ingest/refresh/diag/nominations/cms; exports pollCouncil for cron
handlers/        ingest.js (auth+validate+replay guard), refresh.js, diag.js,
                 nominations.js (cache-first tree), cms.js (flat feed for an external CMS)
services/        discord.js (REST fetch + mapMessage + resolveMentions + cdnAvatar), classify.js,
                 proxy.js, present.js (candidate-name lift + body strip — shared by the page + CMS),
                 commit.js (shared upsert/soft-remove/cache), store.js (D1), validate.js, assemble.js
```

## External CMS feed — `GET /council/cms`

A flat, presentation-ready array for an external CMS (e.g. a Framer synced/API-backed
collection) to pull from — the designer's public page binds to it and it stays current
with the hourly poll (no push, no key). Same public data as `/nominations`, reshaped by
`handlers/cms.js`: `{ generatedAt, scrapedAt, count, items: [{ id, slug, name, handle,
avatarUrl, body (markdown), postedAt (ISO), editedAt, discordLink, reactionCount,
reactions (summary string), endorsementCount, endorsers }] }`. `name`/`body` are the
**server-computed** presentation fields (`services/present.js`) — the same lift + strip
the `/council` page uses, so the two never diverge. KV-cached (`council:cms`, 60s),
invalidated by every ingest/poll. **Custom Discord emoji are stripped from this feed
only** (`reactionCount` + `reactions`): they arrive as ASCII names ("cat_scream", "LF5G")
that read as junk on the marketing page, so `/cms` keeps standard unicode emoji reactions
only. The blind `/council` page (`/nominations`) still shows all reactions.

**How the marketing site consumes it:** Framer does not pull this endpoint directly.
A local hourly launchd job (`org.heliumtools.council-framer-sync`, see Touchpoints →
"This machine") *pushes* this feed into the designer's "Nominations" Framer collection
via the `@framer/agent` CLI, matched by Discord handle: it **create-or-updates** — an
existing item is updated in place, and an approved `/cms` candidate with no matching item
is created (auto-published). Since `/cms` is gated to approved-only, creating from it only
ever publishes reviewed candidates. **`name` is curator-owned**: set once at create from
the feed's lifted name, then never overwritten on update — so a designer rename (e.g. the
lifted "EME" → "Eric Eife") sticks. Everything else (body, date, reactions, endorsements)
refreshes each run, and `avatar` is only (re)hosted when the item has none. So the marketing
page's freshness depends on that local job running (Mac awake, `@framer/agent` still
authorized), not on the endpoint alone.

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
- KV: keys `council:nominations`, `council:cms`, `council:meta`, `council:review` (moderation decisions), and `rl:council:*` rate-limit counters.
- Secrets: `DISCORD_BOT_TOKEN`, `COUNCIL_INGEST_TOKEN`. (No new binding — shares `DB`/`KV`.)

**This machine (not in the repo):**
- Token file `~/.config/heliumtools/council-admin-token`.
- Desktop scheduled task `council-scrape` (currently disabled).
- **Moderation review** — the committed `.claude/skills/council-review/` skill (the
  flag-negative rubric + procedure) driven by a desktop scheduled task `council-review`
  (`~/.claude/scheduled-tasks/council-review/`). A local Claude session reads
  `GET /council/review` and pushes approve/reject to `POST /council/moderate`.
  **Scheduled task DISABLED 2026-07-15** (nominations closed; skill kept for manual runs).
- **Framer CMS sync (hourly re-push into the marketing site).** *(launchd job REMOVED
  2026-07-15 — plist unloaded + deleted; the `council-framer-sync.{js,sh,log,launchd.log}`
  scripts remain inert in `~/.config/heliumtools/`.)* When it ran, a launchd agent
  `~/Library/LaunchAgents/org.heliumtools.council-framer-sync.plist` (label
  `org.heliumtools.council-framer-sync`, fired hourly at :20) ran
  `~/.config/heliumtools/council-framer-sync.sh`, which opens a `@framer/agent` CLI
  session and execs `council-framer-sync.js` (both in `~/.config/heliumtools/`; logs to
  `council-framer-sync.log` + `council-framer-sync.launchd.log`). It pushes `/council/cms`
  into the "Nominations" collection of the Helium.com Framer project
  (`wfVkOsvjtre4gvABHzvs`), matched by Discord handle (create-or-update: approved `/cms`
  candidates with no matching item are auto-created/published). Relies on `@framer/agent` auth persisted from
  `npx @framer/agent setup` (installed skills under `~/.agents/skills` + `~/.claude/skills/framer*`).
- Memories `council-tool-ops`, `council-scrape-harvest-race` (keep
  `claude-in-chrome-exfiltration-filter` — it's general).

**External (Framer / marketing site):**
- The "Nominations" CMS collection in the Helium.com Framer project is populated from
  `/council/cms`. This tool added the fields **Reaction Count, Endorsement Count,
  Reactions, Endorsers** to that (user-managed) collection. The collection, its fields,
  and the page belong to the design team — teardown just stops the local sync; removing
  the collection/fields/page is the designer's call.

**External (Discord side):**
- Discord application/bot **`heliumtools-council`** (app/user id `1524254437181358140`),
  a member of the Official Helium Community guild (`404106811252408320`).
- Wick join-gate filters `2a/3a/4a/6a/7a` were toggled `?off` to add the bot and have
  since been **re-enabled** (the bot is grandfathered in as an existing member, so it
  keeps working). Teardown only removes the bot (and any Wick whitelist entry added
  for it) — no filter changes needed.

## Teardown (after the election)

**Progress (as of 2026-07-15) — bot removed + automation stopped; page still live:**
- Discord bot **`heliumtools-council`** removed from the server (by the user).
- Worker poll **stopped** (`POLL_STOP_MS` = 2026-07-15) → no Discord calls; data frozen
  at its final snapshot (12 nominations + last-polled reactions), still served.
- Framer-sync launchd job **removed** (plist unloaded + deleted; scripts left inert in
  `~/.config/heliumtools/`, `DISCORD_BOT_TOKEN` unused).
- `council-review` scheduled task **disabled** (nominations closed; nothing to review).
- Still LIVE for viewing results: the `/council` page, `/nominations`, `/cms`, the
  admin endpoints (`/review`,`/moderate`,`/refresh`), D1 `council_messages`, the KV keys,
  and the Framer collection. Full removal below runs on "tear down the council tool".

Timing: nothing is actively running against Discord anymore, so there's no rush on the
full teardown below.

1. **Remove the bot.** *Done* — bot removed from the server + worker poll stopped
   (2026-07-15). If not already: delete the Discord application
   (**heliumtools-council**, app/user id `1524254437181358140`) and remove any Wick
   whitelist/immunity entry for the bot id. Wick's join-gate
   filters are already back on, so no filter changes are needed — just remove any Wick
   whitelist/immunity entry that was added for the bot id.
2. **Worker code**: delete `worker/src/tools/council/`; in `worker/src/index.js` remove
   the import, the `/council` route, and the `run("council-poll", …)` line. Decide on
   the cron: simplest is to leave the hourly cron + `hour % 6` gating as-is (the other
   tasks keep their cadence; the worker just wakes hourly). To fully revert, restore the
   four `0 0/6/12/18` crons in `wrangler.jsonc` and the original ungated `scheduled()`.
3. **Frontend**: delete `pages/public/src/council/` and `lib/councilApi.js`; remove the
   lazy import + route in `main.jsx`.
4. **Schema/secrets/data**: remove the `council_messages` block from `schema.sql`;
   `DROP TABLE council_messages` on prod D1; delete KV keys `council:nominations`,
   `council:cms`, `council:meta`, `council:review`, `rl:council:*`; `wrangler secret delete DISCORD_BOT_TOKEN` and
   `COUNCIL_INGEST_TOKEN --env production`; remove both from `.dev.vars.example`.
5. **Skill/local**: delete `.claude/skills/council-scrape/` and `.claude/skills/council-review/`,
   the desktop scheduled tasks `council-scrape` **and `council-review`**, and
   `~/.config/heliumtools/council-admin-token`.
   - **Stop the Framer sync**: `launchctl unload ~/Library/LaunchAgents/org.heliumtools.council-framer-sync.plist`,
     then delete that plist and the `~/.config/heliumtools/council-framer-sync.*` files
     (`.js`, `.sh`, `.log`, `.launchd.log`). The "Nominations" collection + the fields it
     added live in the designer's Framer project — leave those for the design team.
6. **Docs**: drop the Council row + cron mention from root `CLAUDE.md`; delete the
   `council-tool-ops` / `council-scrape-harvest-race` memories.
7. Commit + push (auto-deploys). Confirm `GET https://api.heliumtools.org/council/nominations`
   is 404 and `heliumtools.org/council` no longer resolves.
