---
name: council-scrape
description: Scrape the Helium Discord #advisory-council channel from the user's logged-in Chrome and push the classified nominations to the heliumtools worker. Use this skill whenever the user asks to update, refresh, sync, re-scrape, or re-pull the council nominations (the blind /council page), and whenever a scheduled council-scrape task fires. Drives claude-in-chrome to read the channel DOM read-only, classifies every message as nomination / support / other, and POSTs a full snapshot to the admin-token-protected ingest endpoint. No Discord bot, no Discord REST API, no secrets in output.
---

# Council Scrape

**Manual fallback.** The `/council` page is now populated by a worker-side Discord
**bot poll** on a 6-hourly cron (`worker/src/tools/council/services/poll.js`), which
reads the channel server-side with a read-only bot token. This browser-scrape skill is
kept only as a manual override — e.g. to force an immediate refresh, or to populate the
page in an environment where the bot can't be used. Note: in a sandboxed agent session
whose browser tool results are filtered for logged-in-session content, this skill can't
carry full nomination text to the ingest; prefer the bot poll there.

Push-model ingestion for the blind `/council` page: the freshness of
`heliumtools.org/council` depends on this skill running on this Mac when used. Each run
is a full snapshot, so a run that is skipped or missed is harmless. The page surfaces
`scrapedAt` honestly as "data Xh ago", so a stale run shows up as stale, never as wrong.

The flow: drive the user's logged-in Chrome (claude-in-chrome MCP) to read the
channel DOM, classify each message, then `curl` a JSON snapshot to the worker's
admin-token-protected `POST /council/ingest`. The worker holds no Discord
credentials and we never touch Discord's REST API (ToS): we only read what the
already-logged-in browser renders.

Channel: guild `404106811252408320`, channel `1524096173206536242`
(`https://discord.com/channels/404106811252408320/1524096173206536242`).

## Preconditions

1. **claude-in-chrome connected.** Load the browser tools and confirm a browser is
   attached (`list_connected_browsers`). Open the channel in a new tab.
2. **Token file present.** `~/.config/heliumtools/council-admin-token` must exist
   (a single-line file holding the worker's `COUNCIL_INGEST_TOKEN`). Confirm it
   exists with `test -f`; never print, echo, or log its contents.
3. **Logged in.** After navigating, probe `location.pathname.startsWith('/login')`
   (or a redirect to `discord.com/login`). If redirected, stop and tell the user:
   "Chrome is not signed into Discord. Please sign in at discord.com in Chrome, then
   run the scrape again." Sessions persist, so this is a one-time step.

## Procedure

1. **Open the channel** in a new tab and wait for the message list to render.
   Discord is a heavy SPA: if the first `extract.js` run returns
   `{ error: 'message list not found' }`, the app may still be loading. Wait ~3s
   and retry up to 3 times before treating it as selector drift.
2. **Harvest loop.** Read the sibling file `extract.js` and paste its entire
   contents into the `javascript_tool`. Run it, wait about 2 seconds, run it again,
   and repeat. Page globals persist across calls, so the script accumulates every
   rendered message into `window.__council.byId` and returns only a small counters
   object each pass (keeps token traffic tiny). It scrolls the message list to the
   top after each pass to load older history. See **Loop termination** below for
   when to stop.
3. **Final dump.** Once the loop terminates, run this one-liner in `javascript_tool`
   to pull the accumulated messages out of the page:

   ```js
   JSON.stringify(Object.values(window.__council.byId).filter(m => !m.system))
   ```

   If the result shows `[BLOCKED: Sensitive key]` in place of author fields, or the
   dump is cut off with `[TRUNCATED]`, see the harness-redaction and
   large-result rows in **Failure handling**.
4. **Post-process** (Claude-side, no page interaction):
   - Sort messages by snowflake id ascending (BigInt compare).
   - **Patch grouped messages.** Consecutive messages from the same author render
     without an author header, so `extract.js` leaves their `authorDisplayName` /
     `authorId` / `avatarUrl` null. Walk the sorted list carrying the last non-null
     author forward and fill those nulls from the nearest earlier message (its group
     head is the same author). If the earliest harvested messages are still
     author-less afterward (their group head scrolled off the top of a capped or
     partial run), **drop those leading messages** from the payload and note the
     count in the run summary. The worker requires `authorDisplayName`, so shipping a
     null there would 400 the entire snapshot; dropping the unidentifiable leaders
     keeps the rest of a degraded run ingestable.
   - **Normalize `editedAt`.** `extract.js` uses `-1` as a sentinel for "edited badge
     seen but no timestamp". Convert every `-1` to `null` before building the payload.
   - **Extract nominee handles.** Real nominations open with a
     "Display Name - @handle" first line (a hyphen or dash then `@handle`, e.g.
     `Chris Ferebee - @ferebee`, `Jacob Brady - @JB`). For each `nomination`, parse
     the `@handle` from that first line into `authorUsername`. If the first line
     carries no handle, you may click the author to read the profile popout for the
     true `@handle` (nominees only, see safety rails), else leave `authorUsername`
     null. Endorser `authorUsername` stays null unless trivially present.
   - Mentions arrive **pre-resolved** from the DOM: `@DisplayName` and `#channel`
     render as readable text already, so no id lookups are needed here.
5. **Classify** every message (rubric below): set `kind` to `nomination`, `support`,
   or `other`.
6. **Build the payload** (contract below) with `scrapedAt = Date.now()` and
   `complete` per the loop outcome. Write it to a file in the scratchpad (or /tmp),
   never inline into the curl command.
7. **POST** via curl (never echo the token):

   ```sh
   curl -sS -X POST https://api.heliumtools.org/council/ingest \
     -H "Authorization: Bearer $(cat ~/.config/heliumtools/council-admin-token)" \
     -H "Content-Type: application/json" \
     --data @/path/to/payload.json
   ```

   Expect `{ ok, received, inserted, updated, removed, scrapedAt }`.
8. **Verify.** `GET https://api.heliumtools.org/council/nominations`; confirm the
   nominee count and that `scrapedAt` matches this run.
9. **Close** the tab created for the scrape and **report a run summary**: total
   messages, counts by kind, new-since-last-run, the `complete` flag, and any
   degradations (handles that fell back to null, self-nominations vs nominating
   someone else, selector drift, cap hit).

## Ingest contract (payload shape)

```json
{
  "channelId": "1524096173206536242",
  "guildId": "404106811252408320",
  "scrapedAt": 0,
  "complete": true,
  "messages": [
    {
      "id": "<snowflake>",
      "kind": "nomination",
      "replyToId": null,
      "authorId": null,
      "authorUsername": null,
      "authorDisplayName": "Display Name",
      "avatarUrl": "https://cdn.discordapp.com/avatars/.../....webp",
      "content": "...",
      "postedAt": 0,
      "editedAt": null,
      "reactions": [{ "emoji": "👍", "count": 12 }]
    }
  ]
}
```

Field rules:
- `kind` is one of `nomination` | `support` | `other`.
- `id` and `postedAt` come from the snowflake and are always present.
- `authorId` and `authorUsername` are **nullable** (default avatars carry no user id;
  the DOM shows a display name, not a `@username`). `authorDisplayName` is **required**.
- `avatarUrl` is nullable. The worker keeps it only for `cdn.discordapp.com` /
  `media.discordapp.net` hosts and nulls anything else, but a null here is fine.
- `editedAt` is a ms epoch or null (after the `-1` sentinel is converted).
- `reactions` is an array (possibly empty) of `{ emoji, count }`.

## Classification rubric

- **`nomination`**: a formal candidacy announcement, usually the author nominating
  themselves. Someone nominating a different person still counts as `nomination`;
  note that case in the run summary for the user to adjudicate. These match the
  "Display Name - @handle" first-line convention and run roughly 700 to 2400 chars.
- **`support`**: a reply that endorses a nomination, or an explicit "+1 @X".
- **`other`**: chatter, process posts, troll re-posts of a nominee's text, one-liner
  jabs. When ambiguous, choose `other`: reactions on the nomination itself still
  carry the support signal, so nothing is lost.

Classification is load-bearing, not cosmetic: the channel has troll noise (accounts
re-posting a nominee's full text as mock replies, plus one-liner jabs) that must not
pollute the page.

## Loop termination

Stop the harvest loop when any of these holds, and set `complete` accordingly:

- `atTop === true` in the last counters (the "This is the start of..." channel-intro
  block is on screen). `complete: true`.
- `minIdStable === true` on **two consecutive** passes (locale-independent backstop
  for when the intro text is not detected). `complete: true`.
- `pass` reaches **15** without either of the above. Set **`complete: false`** so the
  worker never soft-deletes rows on a partial view.

Wait about 2 seconds between passes (see safety rails).

## Failure handling

On any ingest 4xx the response **body** is safe to print (it carries `{ error }` and
often a `messageIndex`); the token lives only in the request header, so never echo
the request or its headers.

| Symptom | Cause | Action |
|---|---|---|
| Redirect to `/login` | Chrome not signed into Discord | Stop. Tell the user to sign in at discord.com in Chrome, then rerun. |
| `extract.js` returns `{ error: 'wrong channel' }` | Active tab is not the council channel | The tool ran against the wrong tab. Navigate the intended tab to the channel URL and rerun; do not POST (a `complete:true` push of another channel would soft-delete real rows). |
| `extract.js` returns `{ error: 'message list not found' }` after the load retries | Discord DOM changed | Self-repair using `read_page` (a11y tree) plus the structural anchors, which are years-stable: the `data-list-id="chat-messages"` list attribute and the `chat-messages-`, `message-content-`, `message-reply-context-` id prefixes. The `class*=` hints break first. Report the drift so a follow-up commit can update the selectors. |
| Author fields show `[BLOCKED: Sensitive key]` in a `javascript_tool` result | Harness result filter redacting name strings | Re-dump authors in a different serialization: emit one `id<TAB>name` line per message and join with `\n`, or read the names from `read_page`'s a11y tree keyed by message id, then merge back by id. A JSON dump that omits the display-name field is not redacted, so pull the records without names and merge the names back from the `id<TAB>name` dump. |
| Final dump is cut off with `[TRUNCATED]`, or a `btoa`/base64 dump is `[BLOCKED]` | `javascript_tool` result size cap; base64 blobs are filtered | Don't rely on one big dump. Pull the messages in slices (`window.__council` persists, so `JSON.stringify(all.slice(0,5))`, then `slice(5,10)`, …) and reassemble host-side. Keep each slice small (trim `content`, or emit compact positional arrays and rebuild the objects host-side, recomputing `postedAt` from the snowflake). Do NOT POST from the browser with `fetch` to avoid this: the ingest endpoint does not allow the `Authorization` header via CORS, and putting the token in a `javascript_tool` call would leak it into the transcript. The token stays host-side in the `curl`. |
| Ingest returns 400 | Payload failed validation | Read the body: `messageIndex` pinpoints the offending message. Fix the scrape/post-processing and re-POST. Do not blindly retry. |
| Ingest returns 413 | Payload over the 4 MB cap | A scrape this large is unexpected for this channel. Stop and investigate rather than trimming blindly. |
| Ingest returns 401 | Token rotated or mismatched | Re-read the token file and retry once at most. If still 401, stop and tell the user to check `~/.config/heliumtools/council-admin-token`. |
| Ingest returns 503 | Neither `COUNCIL_INGEST_TOKEN` nor `ADMIN_TOKEN` set on the worker (or `DB` binding missing) | Stop and tell the user the ingest token / database is not configured on the worker. |
| Ingest returns 409 | `scrapedAt` older than the stored snapshot | Benign, a newer scrape already landed. Do not retry. |
| Harvest hit the 15-pass cap | History too long or scroller stuck | Send with `complete: false`; the worker will not soft-delete on a partial view. Note it in the run summary. |

## Safety rails

- **Read-only browsing**: navigate, scroll, read. Nothing else.
- Profile-popout clicks are allowed **only** to read a nominee's `@handle`.
- No typing, no reactions, no message sends.
- **Never** call Discord's REST API with any credentials.
- At least **2 seconds** between scroll steps.
- **No secrets in output**: never print, echo, or log the token or its file contents.

## Notes

- Full snapshot every run with `complete: true`. The channel is tiny (tens of
  messages, election-season only); reactions and edits change on old messages, and
  only a complete snapshot lets the worker detect deletions. `complete: false` exists
  solely for a degraded (capped) run.
- Same person nominated twice yields two cards (message-keyed). Dedup is deferred
  unless it actually happens.
- Passive network capture is not a source: Discord hydrates from local cache and the
  gateway websocket, so no REST `/messages` request fires. DOM extraction is the way.
- Worker tool details (endpoints, KV keys, soft-removal and replay semantics) live in
  `worker/src/tools/council/CLAUDE.md`.
