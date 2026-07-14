# Vote (Governance Proposal Viewer)

A **blind page** (intentionally *not* linked from the landing page) that shows
live vote activity, outcomes, and a **per-vote historical trend chart** for a
Helium governance proposal, plus an **index page of every tracked current and
past vote**. Works for any proposal; election-aware (multi-choice, seat counts).

- **Featured vote** (`DEFAULT_PROPOSAL`, in both `config.js` and `Vote.jsx`):
  `EejcqoypTXfix3m8GrPwLPQfs1P16yCPhiyzkMLvLRx4` — the HIP-149 Advisory Council
  election (top **5** of the candidates win; each ballot may back up to 5).
- **Past featured votes** stay pinned via `KNOWN_PROPOSALS` (worker `config.js`)
  so they remain tracked + indexed: HIP-149 itself
  (`4zLh9V1wiZJ3GffytCnqQA9FX1VQSM3kXxx22RpzPXWo`, resolved).

Everything is read from **our own Solana RPC** (`SOLANA_RPC_URL`), mirroring how
heliumvote.com queries on-chain.

- **Blind URLs:** `https://heliumtools.org/vote/<proposalId>`; `/vote` alone
  falls back to the featured vote; **`/votes` is the index** of current + past
  votes (each card links to its detail page).

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
- **Tracked set:** the default proposal and every `KNOWN_PROPOSALS` id are
  always tracked; any other proposal that's viewed (and refreshed once) is
  added to a KV set (`vote:tracked`) and kept on the cron's list until
  `TRACK_TTL_DAYS` after it was last seen.
- **Settled proposals freeze.** A snapshot whose proposal is resolved/cancelled
  is stamped `final: true` (after the end-state roster rebuild below), stored
  with the longer `RESOLVED_SNAPSHOT_TTL`, and then **not refreshed again** —
  the cron skips it (only backfilling its index catalog row if missing) and
  viewers are served it frozen with no staleness check. Two convergence
  escapes: settled snapshots written by pre-`final` code lack the stamp, so
  they get exactly one corrective refresh; and while the flip resolver still
  has undecoded markers for the proposal, the cron keeps refreshing so the
  frozen roster carries the last flip flags before going quiet. If a frozen
  snapshot ever expires, the next viewer's cold-start rebuild recreates it
  from chain + D1.

The frontend polls the worker every 60s (history every 5 min) — cheap KV/D1
reads, no RPC — and shows freshness from the snapshot's `snapshotAt` (replaced
by a "Final results" label once settled; polling also stops then).

## End-state counting — resolved votes rebuild their roster from D1

**Markers close after a proposal resolves**, so the live `getProgramAccounts`
scan returns nothing and every marker-derived metric (unique voters, per-choice
voter counts, the roster itself) would zero out — which is exactly what the
page used to show for an ended vote. `ProposalV0.choices[].weight` (the tally)
survives resolution and stays authoritative; the roster does not.

The fix: when a refresh finds the proposal settled and the marker scan empty,
`aggregateVotesFromEvents` (builders.js) rebuilds the votes payload from the D1
`vote_events` rows (each marker's final voter/choices/weight/flipped state),
marked `reconstructed: true` on the wire; the frontend labels it "final
roster". Caveats, accepted as best-effort: votes cast in the final minutes
before resolution are missing if no cron tick saw them; a marker relinquished
*before* resolution lingers with its last recorded state; the per-position
`proxy` badge is unknown post-close (proxy *names* still resolve). The tally
shown above the roster always comes from the proposal account, not the rebuild.

## Resolution settings — scheduled end + election seats

`ProposalV0` only carries an end time once resolved, and never a seat count.
Both live in the state controller's **`ResolutionSettingsV0`** (an RPN node
list), reached via **`ProposalConfigV0.state_controller`**:
`services/resolution.js` fetches + decodes both accounts (layouts verified
against `@helium/modular-governance-idls` 0.1.6; owner + discriminator checked)
and summarizes the renderable operands — `EndTimestamp{end_ts}` /
`OffsetFromStartTs{offset}` → the proposal's **`endTs` while still open** (the
countdown), `Top{n}` → **`seats`** (5 for the council election). KV-cached per
config address (`vote:resmeta:<config>`, `RESOLUTION_META_CACHE_TTL`);
best-effort — any failure or unknown controller leaves `endTs`/`seats` null and
the UI renders as before. Unknown node variants abort the parse (`partial`)
rather than mis-read offsets.

## Vote index — `/vote/proposals` + the `/votes` page

Every snapshot refresh upserts a compact row into D1 **`vote_proposals`**
(`services/catalog.js`): name, status/state, dates, `seats`, tallies (both the
per-choice-sum `total_ve_hnt` and the distinct `voted_ve_hnt`), voter count,
winners, a `choices_json` summary, tags. Roster-derived columns COALESCE so a
failed marker fetch can't blank them. `GET /vote/proposals` serves the table
(active first, then newest-ended; KV-cached `PROPOSALS_CACHE_TTL`), and the
frontend `/votes` index lists Live / Past cards from it. Rows are durable —
past votes stay listed long after snapshots expire and markers close.

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

## Flip detection — `flipped` is decoded, never counted

A voter "flipped" a position iff its `VoteMarkerV0` shows **more than one distinct
vote choice** across the marker's on-chain history (voted one way, re-voted
another). The flip (⇄) icon and the expandable per-voter timeline both key off
this.

The marker PDA (`["marker", mint, proposal]`) is **reused on re-vote**, so it
accumulates transactions — but the account only ever stores the *current* choice.
Two signals are tempting and both **wrong**:
- **Transaction count** (`> 1 tx ⇒ flipped`): false-positives every proxy, whose
  batched vote across many positions plus later crank touches leave several
  transactions on each marker with no choice change. (This shipped briefly and
  flagged a 453-position proxy that never flipped.)
- **Change-detection only** (choice differs from what we last stored): misses any
  flip that happened **before** we started recording — that marker looks like a
  single vote in our table and its choice never changes again, so it's never
  flagged. (This also shipped briefly and dropped a genuine flipper.)

So the authoritative signal is to **decode the marker's vote instructions**
(`services/flips.js`, reusing `actionsForMarker`) and count distinct choices.
This is the only source of truth for `flipped`:
- **New markers** are recorded `flip_resolved = 0`; the cron's `resolveProposalFlips`
  decodes them in bounded batches (`FLIP_RESOLVE_PER_RUN`, concurrency
  `FLIP_RESOLVE_CONCURRENCY`, shared `getTransaction` cache). Single-signature
  markers short-circuit to not-flipped with no `getTransaction`.
- **Confirmed flips during tracking** (a recorded marker whose choice changed) are
  written `flipped = flip_resolved = 1` directly by the recorder — we watched it
  change, no decode needed.
- A **one-time backfill** re-decodes every pre-existing row: the `flip_resolved`
  column defaults to 0, so the resolver re-queues all legacy markers and corrects
  any flag from the earlier heuristics. It spreads over several cron ticks; the
  roster reflects each resolved marker on the next refresh (one-cycle lag).
- **Limitation:** the timeline (`getVoterHistory`) only parses markers already
  flagged `flipped = 1`, so a flip is surfaced once the resolver has decoded it.

## Architecture

### Worker (API) — prefix `/vote`

Entry: `index.js` (rate limit + dispatch; re-exports `runVoteSnapshots` /
`VOTE_SNAPSHOT_CRON` for the cron) → `handlers/`.

**Endpoints (all GET, read-only, served from snapshot/D1 — not RPC):**
- `GET /vote/proposals` — the index: every cataloged proposal (current + past)
  as compact rows from D1 `vote_proposals`, live votes first.
- `GET /vote/proposal?id=` — authoritative outcome + `snapshotAt`. `202
  {warming:true}` while the first snapshot builds. Carries `circulating`
  (`{ veHnt, veHntNative, positions, asOf }`) — total network veHNT voting power,
  the participation denominator — when it has been computed (omitted otherwise).
  Also `endTs` (actual end when resolved, *scheduled* close while open) and
  `seats` (election winner count, from the resolution settings; null for
  yes/no votes).
- `GET /vote/votes?id=` — voter roster **grouped by voter** (one row per wallet:
  total veHNT summed across their positions, distinct choices, `positions` count,
  `flipped`, and `proxyName` for registered delegates) + per-choice aggregates
  (`perChoice[]`: `weight`/`veHnt` and `voters` = distinct voters backing that
  choice, counted over **all** voters not just the returned top N; a split voter
  counts toward each choice) + `snapshotAt` (`unavailable:true` if the roster
  fetch failed that cycle). `totalVeHnt` here is the **distinct participating
  veHNT** (each position once) — on a multi-choice election this is smaller than
  the proposal's per-choice sum and is the honest turnout numerator. Once a vote
  settles and markers close the payload is rebuilt from D1 (`reconstructed:true`
  — see End-state counting).
- `GET /vote/activity?id=` — recent transactions (newest first) + `snapshotAt`.
  Each vote/relinquish row is decoded to carry `action`, `choices` (direction),
  `weight`/`veHnt` (size, summed over the positions the tx voted), and `voter`;
  non-vote txns (cranks/admin) carry just `signature`/`blockTime`/`success`.
- `GET /vote/history?id=` — per-vote cumulative time-series for the chart.
- `GET /vote/voter-history?id=&voter=` — one voter's merged vote/flip timeline
  across their positions (`[{ts, action, choice, marker}]`), parsed from each
  marker's transactions. Lazy (loaded when a flipped roster row is expanded),
  KV-cached.

**Services:**
- `services/rpc.js` — vote-specific RPC wrappers (`getAccount`,
  `getProgramAccounts`, `getSignaturesForAddress`) over the shared `rpc`
  primitive in `worker/src/lib/solanaRpc.js`.
- `services/decode.js` — manual Borsh decoders for `ProposalV0` /
  `VoteMarkerV0` / `ProposalConfigV0` / `ResolutionSettingsV0`; a `Reader`
  cursor handles the variable-length layouts.
- `services/resolution.js` — `getResolutionMeta` (proposal config → resolution
  settings → `{ endTimestamp, offsetFromStart, seats }`, KV-cached) and
  `scheduledEndTs`. See "Resolution settings" above.
- `services/catalog.js` — the D1 `vote_proposals` index table:
  `upsertCatalogRow` (called from every snapshot refresh), `hasCatalogRow`
  (cron backfill check for frozen proposals), `listCatalog` (the `/proposals`
  response, KV-cached).
- `services/builders.js` — RPC→object builders (`buildProposalData` — now also
  attaching `seats` + the scheduled `endTs` from `resolution.js`,
  `buildActivityData` — decodes each recent tx for vote direction + size, taking
  the snapshot's `markers` for per-position weights), `fetchProposalMarkers`
  (shared by the roster and the recorder), `aggregateVotes` (pure: markers →
  **per-voter** roster, summing veHNT across each wallet's positions),
  `aggregateVotesFromEvents` (same shape from D1 rows — the end-state rebuild),
  `emptyVotesData`, and `VoteError`.
- `services/voteDecode.js` — shared VSR instruction decoding (`decodeVsrInstruction`,
  `decodeVoteInstructions`, `actionsForMarker`); the single source of the vote/
  relinquish discriminators, consumed by the timeline, flip resolver, and activity
  feed.
- `services/circulating.js` — total circulating veHNT (the participation
  denominator). `refreshCirculatingVeHnt` enumerates every HNT `PositionV0` and
  sums each position's current voting power, **reusing `computeVeHnt` +
  `decodeRegistrar` from the ve-hnt tool** (the on-chain formula must not be
  duplicated). `getProgramAccounts` can't paginate, so the scan is **sharded into
  `CIRCULATING_SHARDS` (256) queries by the mint's first byte** (offset 40,
  uniformly distributed) — each filtered also by the `PositionV0` discriminator +
  HNT registrar (offset 8) and `dataSlice`d to the voting-power fields — bounding
  every response at scale. A position is in exactly one shard, so the union is
  exact; if any shard fails (after one retry) it returns null rather than caching
  an under-count. Heavy, so it's single-flight + KV-cached (`CIRCULATING_CACHE_TTL`);
  the cron refreshes it (cheap cache hit on most ticks), the snapshot only *reads*
  the cached figure (`getCirculatingVeHnt`), and any failure is swallowed so the
  snapshot never breaks. (Cross-tool import; hoist the veHNT math to a shared lib
  if a third consumer appears.)
- `services/snapshot.js` — `refreshSnapshot` (single-flight build + KV write +
  track), `getOrRefreshSnapshot` (viewer read-through), `runVoteSnapshots`
  (cron: refresh + record + **resolve flips**), tracked-set helpers.
- `services/recording.js` — incremental per-vote recorder (see History above).
  Sets each event's `flipped`/`flip_resolved` at record time: a marker already in
  the table whose choice now differs is a **confirmed** flip (we watched it
  change) → `flipped = flip_resolved = 1`; a freshly-seen marker's flip status is
  **unknown** (its pre-tracking history may hold a change we never saw) → recorded
  `flip_resolved = 0` for the resolver to decide. Transaction count is never used.
- `services/flips.js` — the **flip resolver** (see "Flip detection" below). The
  authoritative flip signal: decode a marker's vote instructions and flag it iff
  it shows **> 1 distinct vote choice** over its history. `resolveProposalFlips`
  processes a bounded batch of `flip_resolved = 0` markers per cron tick (a
  one-time backfill over existing votes spreads across a few ticks), with a shared
  `getTransaction` cache (proxy batch votes share signatures). Reuses
  `actionsForMarker` from `voteDecode.js`.
- `services/history.js` — D1 `vote_events` (self-provisioning, incl. `flipped` +
  `flip_resolved` columns + ALTER migrations), `getRecordedMarkers`
  (marker→choices), `getFlippedMarkers`, `getUnresolvedMarkers` /
  `setMarkerFlips` (resolver I/O), `insertVoteEvents` (upsert), `getHistory`
  (cumulative fold + downsample).
- `services/voteHistory.js` — `getVoterHistory(env, proposal, voter)`: looks up
  the voter's *flipped* markers (D1, capped at `MAX_VOTER_HISTORY_MARKERS`),
  parses each marker's transactions, decoding each VSR
  vote/relinquish instruction's `choice` (u16 at offset 8 — uniform across all
  vote/relinquish/proxied variants) into a merged `[{ts, action, choice, marker}]`
  timeline. Scans **both top-level and inner (CPI) instructions** — proxy/crank
  votes arrive as inner instructions — and attributes batched votes by the marker
  in the instruction's accounts (and a uniform batch — every VSR vote in the tx
  sharing one action+choice — is attributed even without account matching). When
  a transaction's choice can't be decoded it falls back to the marker's current
  direction (its stored `choices`), so each entry always shows a vote direction,
  not just "voted". KV-cached.
- `services/content.js` — best-effort off-chain `uri` body fetch with an SSRF
  guard (https only; no IP-literal / localhost / internal hosts) and a streamed
  byte cap.
- `services/proxies.js` — `getProxyMap(env)`: fetches the public
  `helium/helium-vote-proxies` `proxies.json` registry (wallet → name) and caches
  it. Proxy/delegate names are off-chain; a proxied `VoteMarkerV0.voter` is the
  proxy wallet, so the roster looks the voter up directly. Best-effort + KV-cached.
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
- `pages/public/src/vote/Vote.jsx` — status pill + countdown (works while open
  now that `endTs` carries the scheduled close), **`ApprovalMeter`**
  (election-night pass bar atop the outcome card: For as a share of votes
  **cast** against a fixed `APPROVAL_THRESHOLD_PCT` = two-thirds (66.67%) "to
  pass" line; **only for ≤2-choice proposals** with a For/Yes side, and once
  resolved the verdict/color follow the **chain outcome**, not the threshold
  math), outcome card (headline stat is the **distinct** participating veHNT
  from `votes.totalVeHnt` on multi-choice elections — the proposal's per-choice
  sum counts a ballot once per candidate it backs; a dashed **"Top N win
  seats" cut line** sits after the leading `proposal.seats` rows while live,
  and after the winner block when resolved iff winners are exactly the top of
  the sort), outcome bars (each choice as a share of summed choice weight, with
  its **distinct voter count** from `votes.perChoice[].voters`),
  **`VoteProgress`** ("Turnout" card — participation vs **total circulating**
  veHNT; per-choice stacked segments on yes-no votes, a single aggregate
  segment on multi-choice elections where per-candidate shares would overlap /
  overcount, using the distinct `votes.totalVeHnt`; hidden until
  `proposal.circulating` exists — and, for multi-choice, until the roster
  loads; a quorum marker + verdict appear when `QUORUM_THRESHOLD_PCT` is set —
  currently `null` pending the figure), **`VoteTrendChart`** (recharts; one
  `stepAfter` line per choice, cumulative veHNT at precise vote times, seeded
  with a zero point at voting-open; `memo`'d so live-data polls don't reconcile
  it; **beyond 8 choices only the 8 heaviest get lines** — colors would repeat —
  **and the tail folds into a dashed gray "Others"**), voter roster (rows
  flagged `flipped` show a ⇄ icon and expand to that voter's vote timeline via
  `/voter-history`; a "final roster" tag when `votes.reconstructed`), activity
  feed (vote rows show direction + size), collapsible details, an **"All
  votes"** link to `/votes`. Polls live data every 60s and history every 5 min
  while visible — **stopping once the vote is final** ("Final results" replaces
  the freshness label and the refresh button). No wallet connect.
- `pages/public/src/vote/VotesIndex.jsx` — the `/votes` index page: Live / Past
  card lists from `/vote/proposals` (status pill, end date, seat count,
  leading/elected names, voter + veHNT stats), each card linking to
  `/vote/:proposalId`. Polls every 60s.
- `pages/public/src/vote/voteUi.jsx` — shared primitives for both pages:
  formatting (`fmtVeHnt`/`fmtDate`/`relTime`), `STATUS_META`/`StatusPill`/
  `isFinalStatus`, and the **choice color system**: emerald/rose reserved for
  For/Against; candidates draw from a fixed 8-hue order (sky, amber, violet,
  pink, indigo, orange, teal, fuchsia — chosen by maximizing worst adjacent-pair
  CVD ΔE, validated light *and* dark, with darker dark-mode steps for
  sky/amber/orange/teal). Hues are assigned by choice index (entity-stable);
  `choiceHex(name, index, dark)` for chart strokes, `choiceTone` for Tailwind
  text/bar classes.
- Routes `/vote`, `/vote/:proposalId`, and `/votes` in `main.jsx` —
  **deliberately absent from `Landing.jsx`** (blind pages).
- `pages/public/src/lib/voteApi.js` — API client (`fetchProposals`/
  `fetchProposal`/`fetchVotes`/`fetchActivity`/`fetchHistory`/`fetchVoterHistory`).

## On-Chain Data Model (verified against source)

| Account | Program | ID |
|---|---|---|
| `ProposalV0` | proposal (modular-governance) | `propFYxqmVcufMhk5esNMrexq2ogHbbC2kP9PU1qxKs` |
| `ProposalConfigV0` | proposal (modular-governance) | (same program) |
| `ResolutionSettingsV0` | state-controller (modular-governance) | `stcfiqW3fwD9QCd8Bqr1NBLrs7dftZHBQe7RiMMA4aM` |
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
- **`ProposalConfigV0`** (after disc): `vote_controller` Pubkey,
  `state_controller` Pubkey (→ the resolution settings account), `on_vote_hook`
  Pubkey, `name` String, `bump_seed` u8.
- **`ResolutionSettingsV0`** (after disc): `name` String, `settings.nodes`
  Vec\<ResolutionNode\> (RPN), `bump_seed` u8. Node enum order (per the IDL):
  `0 Resolved{Vec<u16>}` · `1 EndTimestamp{i64}` · `2 OffsetFromStartTs{i64}` ·
  `3 ChoiceVoteWeight{u128}` · `4 ChoicePercentage{i32}` · `5 Top{u16}` ·
  `6 NumResolved{u16}` · `7 And` · `8 Or` · `9 Not{String}` ·
  `10 TotalWeight{u128}` · `11 ChoicePercentageOfCurrent{i32}`.

### Outcome / status (mirrors heliumvote `getDerivedProposalState`)
- `percent[i] = weight[i] * 10000 / totalWeight / 100`.
- `voting` → **active**; `cancelled` → **cancelled**; `draft` → **draft**.
- `resolved` with >2 choices → **completed**; binary → **passed** if the winner's
  name starts with `For`/`Yes` (or >1 winner), **failed** if no winner or it
  starts with `Against`/`No`.

## Storage

### KV
- `vote:snap:<id>` — combined snapshot `{ snapshotAt, proposal, votes, activity,
  final? }` (`SNAPSHOT_TTL`, or `RESOLVED_SNAPSHOT_TTL` once settled), the
  single source viewers read.
- `vote:resmeta:<proposalConfig>` — decoded resolution-settings summary
  (`RESOLUTION_META_CACHE_TTL`).
- `vote:catalog` — cached `/vote/proposals` response (`PROPOSALS_CACHE_TTL`).
- `vote:lock:<id>` — single-flight refresh lock (`REFRESH_LOCK_TTL`).
- `vote:tracked` — `{ id: lastSeenMs }` set the cron iterates.
- `vote:content:<id>` — cached off-chain body (`CONTENT_CACHE_TTL`).
- `vote:histcache:<id>` — cached `/history` response (`HISTORY_CACHE_TTL`).
- `vote:vhist:<proposal>:<voter>` — cached per-voter flip timeline (`VOTER_HISTORY_CACHE_TTL`).
- `vote:proxymap` — cached proxy wallet→name registry (`PROXY_MAP_CACHE_TTL`).
- `vote:circulating` — cached total circulating veHNT (`CIRCULATING_CACHE_TTL`×2);
  `vote:circulating:lock` is its single-flight lock.
- `rl:vote:*` — IP rate-limit counter.

### D1 (`DB` binding) — `vote_events`
One row per vote, `PRIMARY KEY (proposal, marker)`: `ts` (exact vote blockTime),
`voter`, `choices_json` (`[index,...]`), `weight` (u128 string), `flipped` (1 if
the position changed its vote choice), `flip_resolved` (1 once the flip resolver
has decoded this marker's history). Self-provisions via `CREATE TABLE IF NOT
EXISTS` (+ `ALTER TABLE ADD COLUMN` migrations for `flipped` and `flip_resolved`;
also in `worker/schema.sql`). Because `flip_resolved` defaults to 0, the migration
re-queues every existing row for accurate re-decoding by the resolver. Rows for a
changed marker are upserted in place (INSERT OR REPLACE). Cumulative is computed
at read time. Doubles as the **end-state roster source** once a resolved vote's
markers close. (The earlier bucketed `vote_snapshots` table is superseded; it's
harmless if it lingers in an existing DB.)

### D1 — `vote_proposals`
The index catalog: one row per tracked proposal (see "Vote index" above),
upserted on every snapshot refresh, `PRIMARY KEY (address)`. Self-provisions in
`services/catalog.js`; mirrored in `worker/schema.sql`.

## Gotchas
- **u128 weights are 16 bytes LE** — BigInt; format via `weightToVeHnt` (÷1e8).
- **`VoteMarkerV0` fields after `choices` are variably positioned** — parse the
  vec first. memcmp uses base58 of the discriminator + proposal at offset 72, on
  the **VSR** program.
- **Markers close after a proposal resolves** → the live roster scan goes empty
  and history becomes un-backfillable; `ProposalV0.choices[].weight` stays
  authoritative, already-recorded events persist, and the roster payload is
  **rebuilt from those events** (`reconstructed: true`) — don't "fix" the empty
  scan by re-querying markers.
- **Multi-choice elections double-count by design in the proposal account**: a
  ballot's weight is added to *every* choice it backs, so
  `sum(choices[].weight)` ≠ participating veHNT. Use the roster's
  `totalVeHnt` (each position once) for turnout/participation, and the choice
  weights only for per-candidate support. This is why `vote_proposals` stores
  both `total_ve_hnt` and `voted_ve_hnt`.
- **`seats`/scheduled `endTs` are best-effort** — a custom state controller or
  unknown resolution node leaves them null; the UI must render without them.
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
