# Vote (Governance Proposal Viewer)

A **blind page** (intentionally *not* linked from the landing page) that shows
live vote activity, outcomes, and a **historical trend chart** for a Helium
governance proposal. Built for vote
`4zLh9V1wiZJ3GffytCnqQA9FX1VQSM3kXxx22RpzPXWo`, but works for any proposal.

Everything is read from **our own Solana RPC** (`SOLANA_RPC_URL`), mirroring how
heliumvote.com queries on-chain.

- **Blind URL:** `https://heliumtools.org/vote/<proposalId>` (and `/vote` alone
  falls back to the default proposal above).

## Polling model — the worker polls, viewers read cache

The RPC is **only ever touched server-side**. Viewers never trigger RPC:

- A **cron (`*/15 * * * *`)** snapshots every *tracked* proposal: it fetches the
  proposal, voter roster, and recent activity once, writes a combined
  **snapshot** to KV, and appends a point to the **history** time-series in D1.
- **Viewer endpoints serve the stored snapshot only.** A refresh happens just on
  cold start (no snapshot yet → `await`) or staleness (snapshot older than
  `SNAPSHOT_STALE_MS` → serve stale, refresh in the background). Both paths are
  **single-flight** (a KV lock), so N concurrent viewers cause at most one RPC
  refresh — never one-per-viewer.
- The cron is branched on in `worker/src/index.js scheduled()` via
  `VOTE_SNAPSHOT_CRON`; the 6-hourly tasks (OUI notifier, etc.) do **not** run on
  the 15-min tick (guarded by both the cron-string branch and a `minute === 0`
  backstop).
- **Tracked set:** the default proposal is always tracked; any other proposal
  that's viewed (and thus refreshed once) is added to a KV set
  (`vote:tracked`) and kept on the cron's list until `TRACK_TTL_DAYS` after it
  was last seen, then dropped.

The frontend polls the worker every 60s (and history every 5 min) — cheap KV
reads, no RPC — and shows freshness from the snapshot's `snapshotAt`.

## Architecture

### Worker (API) — prefix `/vote`

Entry: `index.js` (rate limit + dispatch; also re-exports `runVoteSnapshots` /
`VOTE_SNAPSHOT_CRON` for the cron) → `handlers/`.

**Endpoints (all GET, read-only, served from the snapshot/D1 — not RPC):**
- `GET /vote/proposal?id=` — authoritative outcome (choices + veHNT `weight` +
  percentages + leading/winning choice + status + timing + off-chain body) +
  `snapshotAt`. `202 {warming:true}` if the first snapshot is still building.
- `GET /vote/votes?id=` — voter roster (per-voter choice + weight), per-choice
  aggregates, unique-voter count, `snapshotAt`. `unavailable:true` if the roster
  fetch failed that cycle.
- `GET /vote/activity?id=&before=&limit=` — recent vote transactions (newest
  first) + `snapshotAt`. An explicit `before` cursor does a one-off live fetch
  (off the hot path; the default page never paginates).
- `GET /vote/history?id=` — recorded tally time-series (`points[]`), for the
  trend chart. Read from D1, KV-cached `HISTORY_CACHE_TTL`.

**Services:**
- `services/rpc.js` — JSON-RPC helpers (`getAccount`, `getProgramAccounts`,
  `getSignaturesForAddress`) over `SOLANA_RPC_URL`.
- `services/decode.js` — manual Borsh decoders for `ProposalV0` /
  `VoteMarkerV0` (no Anchor in the worker); a `Reader` cursor handles the
  variable-length proposal layout.
- `services/builders.js` — pure RPC→object builders (`buildProposalData`,
  `buildVotesData`, `buildActivityData`) + `VoteError` (carries 404/400). No
  caching; called by the snapshotter and the cold-start path.
- `services/snapshot.js` — the polling brain: `refreshSnapshot` (single-flight
  build + KV write + history append + track), `getOrRefreshSnapshot`
  (read-through for viewers), `runVoteSnapshots` (cron), and the tracked-set
  helpers.
- `services/history.js` — D1 time-series: self-provisions `vote_snapshots`
  (`CREATE TABLE IF NOT EXISTS`), `appendSnapshot` (15-min-bucketed
  `INSERT OR IGNORE` + retention prune), `getHistory` (KV-cached read).
- `services/content.js` — best-effort off-chain `uri` body fetch with an SSRF
  guard (https only; no IP-literal / localhost / internal hosts) and a streamed
  byte cap.
- `utils.js` — `parseProposalId`, `weightToVeHnt`, `tallyChoices`,
  `deriveStatus`, `proposalTiming`, `isValidSignature`, `kvGetJson`/`kvPutJson`.
- `config.js` — program ID, discriminators, default proposal, cron string,
  snapshot/lock/history/track TTLs, caps.

### Frontend
- `pages/public/src/vote/Vote.jsx` — status pill, outcome bars, **`VoteTrendChart`
  (recharts line-per-choice veHNT over time)**, voter roster, activity feed,
  collapsible details. Polls live data every 60s and history every 5 min while
  the tab is visible; shows freshness from `snapshotAt`. No wallet connect (not
  wrapped in `SolanaProvider`). Routes `/vote` and `/vote/:proposalId` in
  `main.jsx` — **deliberately absent from `Landing.jsx`** (blind page).
- `pages/public/src/lib/voteApi.js` — API client
  (`fetchProposal`/`fetchVotes`/`fetchActivity`/`fetchHistory`).

## On-Chain Data Model (verified against source)

| Account | Program | ID |
|---|---|---|
| `ProposalV0` | proposal (modular-governance) | `propFYxqmVcufMhk5esNMrexq2ogHbbC2kP9PU1qxKs` |
| `VoteMarkerV0` | voter-stake-registry (VSR) | `hvsrNC3NKbcryqDs2DocYHZ9yPKEVzdSjQG6RVtK1s8` |

- **`ProposalV0`** (after 8-byte disc): `namespace` Pubkey, `owner` Pubkey,
  `state` enum, `created_at` i64, `proposal_config` Pubkey,
  `max_choices_per_voter` u16, `seed` Vec\<u8\>, `name` String, `uri` String,
  `tags` Vec\<String\>, `choices` Vec\<Choice\>, `bump_seed` u8. Fixed-size
  allocated + right-padded with zeros — parse forward, ignore slack.
  - `Choice` = `weight` **u128 LE** (accumulated veHNT, authoritative tally),
    `name` String, `uri` Option\<String\>.
  - `ProposalState` (Borsh enum = 1-byte index + fields): `0 Draft`,
    `1 Cancelled`, `2 Voting{start_ts:i64}`, `3 Resolved{choices:Vec<u16>,
    end_ts:i64}`, `4 Custom{name,bin}`. `Resolved.choices` = winning indices.
- **`VoteMarkerV0`**: `voter` (off 8), `registrar` (40), `proposal` (**72** — the
  memcmp offset), `mint` (104, the position NFT), `choices` Vec\<u16\>, `weight`
  u128, `bump_seed` u8, `_deprecated_relinquished` bool, `proxy_index` u16,
  `rent_refund` Pubkey. **No timestamp** — per-vote time comes from the txn.

### Outcome / status (mirrors heliumvote `getDerivedProposalState`)
- `percent[i] = weight[i] * 10000 / totalWeight / 100`.
- `voting` → **active**; `cancelled` → **cancelled**; `draft` → **draft**.
- `resolved` with >2 choices → **completed**; binary → **passed** if the single
  winner's name starts with `For`/`Yes` (or >1 winner), **failed** if no winner
  or the winner starts with `Against`/`No`.

## Storage

### KV
- `vote:snap:<id>` — combined snapshot `{ snapshotAt, proposal, votes, activity }`
  (`SNAPSHOT_TTL`). The single source viewers read.
- `vote:lock:<id>` — single-flight refresh lock (`REFRESH_LOCK_TTL`).
- `vote:tracked` — `{ id: lastSeenMs }` set the cron iterates (default always
  included).
- `vote:content:<id>` — cached off-chain body (`CONTENT_CACHE_TTL`).
- `vote:histcache:<id>` — cached `/history` response (`HISTORY_CACHE_TTL`).
- `rl:vote:*` — IP rate-limit counter.

### D1 (`DB` binding) — `vote_snapshots`
One row per `(proposal, ts)` where `ts` is bucketed to 15 min: `total_weight`
(u128 string), `total_vehnt` (real), `unique_voters`, `marker_count`,
`choices_json` (`[{index,weight,veHnt}]`). Self-provisions via
`CREATE TABLE IF NOT EXISTS` (also in `worker/schema.sql`); pruned to
`HISTORY_RETENTION_DAYS`.

## Gotchas
- **u128 weights are 16 bytes LE** — BigInt; format via `weightToVeHnt` (÷1e8).
- **`VoteMarkerV0` fields after `choices` are variably positioned** — parse the
  vec first; don't hard-offset past byte 136. memcmp uses base58 of the
  discriminator + proposal at offset 72, on the **VSR** program (not
  nft_voter/token_voter).
- **Markers close after a proposal resolves** → empty roster is expected;
  `ProposalV0.choices[].weight` is the authoritative final tally.
- **Cron isolation** — anything added to `scheduled()` outside the 15-min branch
  must tolerate (or be guarded against) running only at the 6-hourly ticks; the
  vote snapshot must stay inside the `VOTE_SNAPSHOT_CRON` branch.
- **Snapshot/history are best-effort** — KV/D1 errors never fail a request
  (`kvGetJson`/`kvPutJson` swallow; history append is wrapped). A cron outage
  just makes snapshots stale until a viewer single-flight-refreshes them.

## Environment
- `SOLANA_RPC_URL` — Helius staked endpoint (never log/expose).
- `KV` — snapshots, locks, tracked set, content/history caches, rate limit.
- `DB` (D1) — the `vote_snapshots` history time-series. No new env vars.
