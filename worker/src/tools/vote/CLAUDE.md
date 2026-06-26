# Vote (Governance Proposal Viewer)

A **blind page** (intentionally *not* linked from the landing page) that shows
live vote activity, outcomes, and a **per-vote historical trend chart** for a
Helium governance proposal. Built for vote
`4zLh9V1wiZJ3GffytCnqQA9FX1VQSM3kXxx22RpzPXWo`, but works for any proposal.

Everything is read from **our own Solana RPC** (`SOLANA_RPC_URL`), mirroring how
heliumvote.com queries on-chain.

- **Blind URL:** `https://heliumtools.org/vote/<proposalId>` (and `/vote` alone
  falls back to the default proposal above).

## Polling model — the worker polls, viewers read cache

The RPC is **only ever touched server-side**:

- A **cron (`*/15 * * * *`)** processes every *tracked* proposal: it refreshes a
  combined **snapshot** (proposal + voter roster + recent activity) into KV, and
  **records any new votes** into the D1 history time-series.
- **Viewer endpoints serve the stored snapshot / D1 only.** A snapshot refresh
  happens just on cold start (no snapshot → `await`) or staleness (older than
  `SNAPSHOT_STALE_MS` → serve stale, refresh in background). Both are
  **single-flight** (a KV lock), so N concurrent viewers cause at most one RPC
  refresh — never one per viewer.
- The cron is branched on in `worker/src/index.js scheduled()` via
  `VOTE_SNAPSHOT_CRON`; the 6-hourly tasks do **not** run on the 15-min tick
  (guarded by both the cron-string branch and a `minute === 0` backstop).
- **Tracked set:** the default proposal is always tracked; any other proposal
  that's viewed (and refreshed once) is added to a KV set (`vote:tracked`) and
  kept on the cron's list until `TRACK_TTL_DAYS` after it was last seen.

The frontend polls the worker every 60s (history every 5 min) — cheap KV/D1
reads, no RPC — and shows freshness from the snapshot's `snapshotAt`.

## History — precise per-vote time-series

`VoteMarkerV0` records a position's `(choice, weight)` but **no timestamp**. To
chart precise vote times we read each marker account's *creation* transaction
(`getSignaturesForAddress` on the marker → oldest `blockTime`) and store **one
immutable event per vote** at that exact time. The cumulative per-choice curve
is folded at **read** time, so the chart steps at each real vote.

- `services/recording.js` `recordProposalVotes(env, id, { markers, limit })` is
  **incremental**: it takes the markers the snapshot already fetched (no second
  `getProgramAccounts`), skips those already recorded (`getRecordedMarkers`),
  times only the new ones (`MARKER_TIME_CONCURRENCY` at a time, picking each
  marker's oldest signature with a `blockTime`), and inserts them. The **first
  run records every past vote back to vote-open** (the backfill); later runs
  append only new votes. `runVoteSnapshots` passes a shrinking `limit` so the
  **total** new votes timed per cron invocation (across all tracked proposals)
  is bounded — a big first run spreads across a few ticks rather than blowing
  the Workers subrequest limit. Called by the cron (awaited) and the cold-start
  path (background via `ctx.waitUntil`).
- `getHistory()` folds events → cumulative points `{ ts, totalVeHnt,
  choices:[{index, veHnt}] }` (each point carries every choice seen so far), then
  **downsamples** to `MAX_HISTORY_POINTS`. KV-cached `HISTORY_CACHE_TTL`.
- **Invariant:** the final cumulative equals `sum(marker weights)` =
  `ProposalV0.choices[].weight`, so the chart's endpoint matches the live tally.
- Caveat: reconstruction only works while markers are open. Markers close after a
  proposal resolves, so this can't backfill an already-resolved proposal — but
  events already recorded persist.

## Architecture

### Worker (API) — prefix `/vote`

Entry: `index.js` (rate limit + dispatch; re-exports `runVoteSnapshots` /
`VOTE_SNAPSHOT_CRON` for the cron) → `handlers/`.

**Endpoints (all GET, read-only, served from snapshot/D1 — not RPC):**
- `GET /vote/proposal?id=` — authoritative outcome + `snapshotAt`. `202
  {warming:true}` while the first snapshot builds.
- `GET /vote/votes?id=` — voter roster + per-choice aggregates + `snapshotAt`
  (`unavailable:true` if the roster fetch failed that cycle).
- `GET /vote/activity?id=` — recent vote transactions (newest first) +
  `snapshotAt`.
- `GET /vote/history?id=` — per-vote cumulative time-series for the chart.

**Services:**
- `services/rpc.js` — vote-specific RPC wrappers (`getAccount`,
  `getProgramAccounts`, `getSignaturesForAddress`) over the shared `rpc`
  primitive in `worker/src/lib/solanaRpc.js`.
- `services/decode.js` — manual Borsh decoders for `ProposalV0` /
  `VoteMarkerV0`; a `Reader` cursor handles the variable-length proposal layout.
- `services/builders.js` — RPC→object builders (`buildProposalData`,
  `buildActivityData`), `fetchProposalMarkers` (shared by the roster and the
  recorder), `aggregateVotes` (pure: markers → roster), `emptyVotesData`, and
  `VoteError` (carries 404/400).
- `services/snapshot.js` — `refreshSnapshot` (single-flight build + KV write +
  track), `getOrRefreshSnapshot` (viewer read-through), `runVoteSnapshots`
  (cron: refresh + record), tracked-set helpers.
- `services/recording.js` — incremental per-vote recorder (see History above).
- `services/history.js` — D1 `vote_events` (self-provisioning), `getRecordedMarkers`,
  `insertVoteEvents`, `getHistory` (cumulative fold + downsample).
- `services/content.js` — best-effort off-chain `uri` body fetch with an SSRF
  guard (https only; no IP-literal / localhost / internal hosts) and a streamed
  byte cap.
- `utils.js` — `parseProposalId`, `resolveProposal` (shared handler
  parse/default/validate), `weightToVeHnt`, `tallyChoices`, `deriveStatus`,
  `proposalTiming`.
- `config.js` — program ID, marker discriminator, default proposal, cron string,
  snapshot/lock/track TTLs, history/recording caps.

**Shared libs (hoisted, not duplicated per tool):**
- `worker/src/lib/solanaRpc.js` — the single `rpc(env, method, params)` JSON-RPC
  primitive (also used by wallet-dashboard).
- `worker/src/lib/kv.js` — `kvGetJson`/`kvPutJson` best-effort helpers (also used
  by wallet-dashboard).

### Frontend
- `pages/public/src/vote/Vote.jsx` — status pill, outcome bars, **`VoteTrendChart`**
  (recharts; one `stepAfter` line per choice, cumulative veHNT at precise vote
  times, seeded with a zero point at voting-open; `memo`'d so live-data polls
  don't reconcile it), voter roster, activity feed, collapsible details. Polls
  live data every 60s and history every 5 min while visible; freshness from
  `snapshotAt`. No wallet connect. Routes `/vote` and `/vote/:proposalId` in
  `main.jsx` — **deliberately absent from `Landing.jsx`** (blind page).
- `pages/public/src/lib/voteApi.js` — API client
  (`fetchProposal`/`fetchVotes`/`fetchActivity`/`fetchHistory`).

## On-Chain Data Model (verified against source)

| Account | Program | ID |
|---|---|---|
| `ProposalV0` | proposal (modular-governance) | `propFYxqmVcufMhk5esNMrexq2ogHbbC2kP9PU1qxKs` |
| `VoteMarkerV0` | voter-stake-registry (VSR) | `hvsrNC3NKbcryqDs2DocYHZ9yPKEVzdSjQG6RVtK1s8` |

- **`ProposalV0`** (after 8-byte disc): `namespace`, `owner`, `state` enum,
  `created_at` i64, `proposal_config`, `max_choices_per_voter` u16, `seed`
  Vec\<u8\>, `name` String, `uri` String, `tags` Vec\<String\>, `choices`
  Vec\<Choice\>, `bump_seed` u8. Fixed-size allocated + right-padded — parse
  forward, ignore slack.
  - `Choice` = `weight` **u128 LE** (accumulated veHNT), `name` String, `uri`
    Option\<String\>.
  - `ProposalState` enum: `0 Draft`, `1 Cancelled`, `2 Voting{start_ts:i64}`,
    `3 Resolved{choices:Vec<u16>, end_ts:i64}`, `4 Custom`. `Resolved.choices` =
    winning indices.
- **`VoteMarkerV0`**: `voter` (off 8), `registrar` (40), `proposal` (**72** —
  memcmp offset), `mint` (104, the position NFT), `choices` Vec\<u16\>, `weight`
  u128, `bump_seed` u8, `_deprecated_relinquished` bool, `proxy_index` u16,
  `rent_refund` Pubkey. **No timestamp** (hence the marker-creation-tx lookup).

### Outcome / status (mirrors heliumvote `getDerivedProposalState`)
- `percent[i] = weight[i] * 10000 / totalWeight / 100`.
- `voting` → **active**; `cancelled` → **cancelled**; `draft` → **draft**.
- `resolved` with >2 choices → **completed**; binary → **passed** if the winner's
  name starts with `For`/`Yes` (or >1 winner), **failed** if no winner or it
  starts with `Against`/`No`.

## Storage

### KV
- `vote:snap:<id>` — combined snapshot `{ snapshotAt, proposal, votes, activity }`
  (`SNAPSHOT_TTL`), the single source viewers read.
- `vote:lock:<id>` — single-flight refresh lock (`REFRESH_LOCK_TTL`).
- `vote:tracked` — `{ id: lastSeenMs }` set the cron iterates.
- `vote:content:<id>` — cached off-chain body (`CONTENT_CACHE_TTL`).
- `vote:histcache:<id>` — cached `/history` response (`HISTORY_CACHE_TTL`).
- `rl:vote:*` — IP rate-limit counter.

### D1 (`DB` binding) — `vote_events`
One immutable row per vote, `PRIMARY KEY (proposal, marker)`: `ts` (exact vote
blockTime), `voter`, `choices_json` (`[index,...]`), `weight` (u128 string).
Self-provisions via `CREATE TABLE IF NOT EXISTS` (also in `worker/schema.sql`).
Cumulative is computed at read time. (The earlier bucketed `vote_snapshots` table
is superseded; it's harmless if it lingers in an existing DB.)

## Gotchas
- **u128 weights are 16 bytes LE** — BigInt; format via `weightToVeHnt` (÷1e8).
- **`VoteMarkerV0` fields after `choices` are variably positioned** — parse the
  vec first. memcmp uses base58 of the discriminator + proposal at offset 72, on
  the **VSR** program.
- **Markers close after a proposal resolves** → empty roster + un-backfillable
  history are expected post-resolution; `ProposalV0.choices[].weight` stays
  authoritative, and already-recorded events persist.
- **Recording is incremental and capped** — a huge first vote backfills over
  several cron ticks; don't expect the whole history instantly.
- **Cron isolation** — anything added to `scheduled()` outside the 15-min branch
  must tolerate running only at the 6-hourly ticks; the vote work stays inside
  the `VOTE_SNAPSHOT_CRON` branch.
- **Snapshot/history are best-effort** — KV/D1 errors never fail a request.

## Environment
- `SOLANA_RPC_URL` — Helius staked endpoint (never log/expose).
- `KV` — snapshots, locks, tracked set, content/history caches, rate limit.
- `DB` (D1) — the `vote_events` history time-series. No new env vars.
