# Council Emissions (HIP-149 Advisory Council emissions)

`/council-emissions`, listed on the landing page in its own Governance section
(see Landing preview) and in the WebMCP catalog. It shows every HNT emission to the five compensated HIP-149
Advisory Council seats on a per-seat timeline, and follows each emission to where
it went:
still held, swapped, sent to an exchange, locked in veHNT, burned for Data
Credits, or onward through other wallets.

Vocabulary (the owner's choice; keep it in copy, agent tools and docs): each
daily amount a seat receives is an **emission**, and the fanout's daily run is a
**distribution run**. Never "payout".

Worker-heavy: a FAST_CRON indexer stores parsed transactions in D1, a pure
tracer replays them into KV views, and viewers never reach the RPC.

## The flow on chain (verified 2026-10-27)

- **Emission.** Each epoch, `helium-sub-daos` `issue_rewards_v0` (`hdaoVTC…`)
  runs once per sub-DAO (IOT `39Lw1RH6…`, MOBILE `Gm9xDCJa…`). Each run mints
  1,225 HNT through the circuit breaker (`circAbx…`) into the council's token
  account `EYbAXgLq1aRr9a9y55DbjfMdXNrZuMa69WXN9c1UR6eK`, passed as the optional
  `council_vault`. That is 2,450 HNT/day, or 490 per seat. The program logs the
  literal, unformatted line "Minting {vault_amount} supplement, {council_amount}
  Council compensation", so amounts come from the `mintTo`, never the log. The
  flat window runs to about 2027-07-31, then tapers linearly to 0. The page
  derives the rate from recent mints and never assumes 490.
- **Fanout.** Mini-fanout `2pCpQYrUmQor9igsF4cY7tkmd3jBQzHFEB75gtpjdWA2`
  (program `mfanLprNnaiP4RX9Zz1BMcDosYHCqnG24H1fMEbi9Gn`). Its seeds are
  `["mini_fanout", hprdnjkb…, "hip149-council"]`.
  - Owner: the Helium governance Squads vault `pULUgsYt…`. It is the only key
    that can change shares, delegates or the schedule, or close the fanout.
  - Created 2026-08-03 19:55:56 UTC (`5nwytJpV…`), signed by `hprdnjkb…` directly.
    It was not a Squads proposal.
  - 5 equal shares, no delegates. Unchanged since creation.
- **Distribution.** tuktuk (`tuktukUr…`, task queue `H39gEs…`) runs `DistributeV0`
  daily at 00:00 UTC (`0 0 0 * * *`). It moves the token account's whole balance
  to the five seats' canonical HNT ATAs.
- **Run sizes.** The mint and the distribution fire in the same minute, so a run
  sends each seat 0, one day (490) or two days (980). The tracer attributes each emission
  to the mint days it spends (`epochs`), FIFO over the fanout's balance. Failed
  attempts (`6009` PreTaskNotRun, `3012` races) cost nothing and are retried.
- **Totals at the 2026-10-28 00:00 UTC cutoff:**
  - 205,800 HNT minted (84 epochs, 2 manual cranks on 08-12);
  - 86 runs (76 that distributed HNT, 10 empty), 33 failed attempts;
  - 203,350 HNT emitted to seats (40,670 per seat), 2,450 HNT waiting.

## Worker (`worker/src/tools/council-emissions/`, prefix `/council-emissions`)

| File | Role |
|---|---|
| `index.js` | Router, plus the `runCouncilEmissionsIndex` re-export for `scheduled()` |
| `config.js` | Fanout addresses, `EXPECTED_SEATS` (drift guard and indexing seed), `SEAT_NAMES` (empty; source-gated), program IDs, swap venues, caps, budgets, KV keys, `INDEX_ENABLED`, `CLASSIFIER_VERSION` |
| `labels.js` | The committed label registry (exchange hot wallets, deposit addresses, Helium ops keys) and the Helius identity → label mapping |
| `services/parse.js` | Pure. jsonParsed tx → compact record: HNT `transfer`/`transferChecked`/`mintTo`/`burn` moves in execution order, per-account HNT pre/post, other-mint and lamport deltas, program IDs, Anchor instruction names. `RECORD_VERSION` |
| `services/classify.js` | Pure. Classifies an HNT move out of, or into, a traced wallet |
| `services/trace.js` | Pure. The FIFO replay (below) |
| `services/snapshot.js` | Pure. Trace → the four KV views |
| `services/indexer.js` | Cron pipeline and `rebuild()` |
| `services/db.js` | D1 schema and queries |
| `services/rpc.js` | `rpcBatch` (JSON-RPC array POST), signatures, balances, token-account discovery, Helius identity |
| `services/fanout.js` | `MiniFanoutV0` decoder (layout verified against the live account) |
| `handlers/views.js`, `handlers/admin.js` | Endpoints |

### Endpoints

All `GET`s serve a KV document, read before the rate limiter (`rl:ce`, 60/min).
A miss returns 202 `{ warming: true }` and rebuilds the views from D1 in the
background, under the indexer's lock and still with no RPC. Before the cron has
indexed anything, that rebuild writes nothing, so viewers keep getting 202
rather than an empty "complete" page.

- `GET /summary`: totals (`minted`, `emitted`, `waiting`, `distributedRuns`,
  `lastEmissionAt`, per-seat-per-day from the last 7
  mint days, runs, failed attempts), the fanout's decoded shares, per-seat rollups
  (received, `byKind` fate totals, staying vs left, reconciliation), timeline
  `lanes`, `downstream` wallets being followed, `drift` flags and backfill progress.
  - Each lane has every emission `{ sig, t, amount, mix, firstLeftAt }` and every
    outflow `{ sig, t, amount, kind, label, to, lotIdx }`.
- `GET /seat?wallet=`: one seat. Every lot with `epochs` and its `fates` (each fate
  has kind, amount, `leftAt`, `at`, terminal `sig`, label, and the hop `path` with
  tx sigs), every outflow with the lots it carried, and other inflows. Returns 404
  for non-seat wallets once a summary exists.
- `GET /runs`: distribution runs (per-seat amounts, mint days, minutes after 00:00 UTC),
  every council mint (sub-DAO, manual flag) and the failed attempts.
- `GET /labels`: the registry and learned identity labels, published for transparency.
- `POST /admin/index`: one indexer pass now. `POST /admin/rebuild`: replay from D1
  with the current rules, no RPC. Both need `Authorization: Bearer ${ADMIN_TOKEN}`
  (constant-time compare), and return 503 if it is unset. CORS doesn't allow the
  header, so these are curl-only.

All amounts are integer base-unit strings (HNT has 8 decimals). Times are unix
seconds.

### Indexer (FAST_CRON, `*/15`)

`runCouncilEmissionsIndex` is single-flight under `withKvLock('ce:lock', 600)`.
Each run:

1. **Poll cursors.** `ce_cursors` holds one row per indexed address:
   - the fanout PDA (its failed signatures become `ce_failed` distribution attempts);
   - the fanout token account;
   - the seat ATAs;
   - each followed downstream token account.

   Forward polling uses `until: newest_sig`. Backfill pages `before: oldest_sig`
   down to the window start: `FANOUT.createdAt`, or for a downstream account the
   slot of its first traced receipt. Failed signatures are never fetched.
   - A downstream account whose signatures would pass `NODE_SIG_CAP` is marked
     `busy` before any of them are queued, so none are fetched.
   - When the replay finds an earlier traced receipt into an account it already
     follows, `widenCursors` lowers that account's `from_slot` and backfills again.
2. **Fetch.** Up to `DECODE_BUDGET_PER_RUN` (150) pending signatures, as
   `getTransaction` batches of 25. Parsed records go to `ce_tx`. A failed batch
   item stays pending.
3. **Discover accounts.** Once a day, `getTokenAccountsByOwner` (Token and
   Token-2022) for each seat. A non-ATA HNT account becomes a `seat_token` cursor.
4. **Read balances.** Live balances (`getMultipleAccounts`, at `finalized`, the
   same commitment as the signature lists) and the decoded fanout account. The run
   then skips the replay if its fingerprint hasn't changed.
5. **`rebuild()`.** Replay; look up Helius identities for new counterparties (at
   most 10 per run, cached in `ce_labels` for 30 days, misses for 7); replay again;
   add cursors for newly followed wallets; write the KV views.

The first backfill is about 370 transactions over 3 runs, and following the
Coinbase deposit address adds one more run. Steady state is about 10 RPC calls a
tick. `INDEX_ENABLED = false` stops the cron; readers keep the last views.

A `RECORD_VERSION` bump re-queues older `ce_tx` rows, which are re-fetched over
the next runs. A `CLASSIFIER_VERSION` bump only forces a replay.

### Storage

KV keys:
- `ce:snap`: summary.
- `ce:seat:<wallet>`: seat detail.
- `ce:runs`, `ce:labels`.
- `ce:meta`: fingerprint, decoded fanout state, last account discovery, record version.
- `ce:lock`, `rl:ce:*`.

D1 tables (self-provisioned by `db.js`, mirrored in `worker/schema.sql`):
- `ce_cursors`, `ce_tx`, `ce_pending`, `ce_failed`, `ce_labels`.

The removed nominee tool's `/council`, `council:*`, `rl:council:*` and
`council_messages` are deliberately not reused.

## The trace (`services/trace.js`)

**Lots.** Every nonzero emission to a seat is one lot, keyed `sig:seat:moveIndex`.

**FIFO queues.** Every traced wallet (a "node") holds a FIFO queue of segments:
- `prior`: HNT an account held when tracing began. Its pre-balance is the first
  time the replay meets it.
- `emission`: a lot.
- `other`: veHNT rewards, Helium seed transfers, buys, transfers in.

HNT is fungible, so the oldest HNT leaves first: an outflow consumes the queue
front. Records replay in slot order. Within a slot, a record that credits an account
replays before one that debits it (the RPC gives no cross-account order inside a
slot), so a receipt and its same-slot forward replay in the right order. Each
lot's id includes the move index, so a run that sends one owner two emissions keeps two
lots.

**Classifying a move out of a traced wallet** (`classify.js`). The destination
decides first, because one tx can also swap or touch veHNT. In this order:
- `burn`: `dc_burn` if the data-credits program ran or the DC mint increased,
  otherwise `program_other`.
- Destination is a seat: `council`. The lot moves to that seat's queue.
- Destination labeled `exchange_hot`: `exchange`.
- Destination labeled `exchange_deposit`: followed one hop, so the sweep to a hot
  wallet shows in the path. An unswept deposit balance reads "At a Coinbase deposit
  address".
- Destination is a wallet already being followed: `transfer`.
- Voter stake registry present: `vehnt`.
- A swap venue program present (`config.SWAP_PROGRAMS`), or the sender gains
  another token, or more than 0.05 SOL, in the same tx: `swapped`, with
  `swapOut`. Closing a token account refunds about 0.002 SOL, hence the threshold.
- Anything else: `transfer`, followed. A wallet not yet indexed gets a fetch
  request, and its pieces read `following` until its history arrives. So does a
  wallet's second token account when HNT moves into it.

**Caps.** These mark pieces `not_traced` with a reason:
- `MAX_HOPS` 6 (`hop_limit`);
- an onward move under `MIN_TRACE_RAW`, 1 HNT (`dust`);
- `MAX_TRACKED_NODES` 150 (`limit`);
- a downstream account with more than `NODE_SIG_CAP` 1,500 signatures (`busy`).
  Busy wallets are never replayed: their history is incomplete, and following
  them would pin a lot on whatever they sent HNT to next.

A capped move into a wallet that is already followed still lands in that
wallet's queue as untraced HNT, so its balance stays right.

**End state** of a lot piece:
- at its own seat: `held`;
- at another seat: `held_by_seat`;
- at a custodial seat or an exchange deposit address: `exchange` with `unswept`;
- elsewhere: `held_downstream`.

**Reconciliation.** Per seat, the queue total must equal the live on-chain
balance of its tracked accounts (`reconciled: ok | mismatch | indexing |
unknown`). It reads `indexing` while any cursor is backfilling or any signature
is still queued; while signatures are queued, downstream pieces read `following`
rather than `held_downstream`. At the cutoff every seat reconciles to the base
unit.

Run counting only counts this fanout: a `DistributeV0` with no emission moves is an
empty council run only if the record lists the fanout's token account. Other
mini-fanouts (Hotspot reward splits) also log `DistributeV0`.

**Seat 5 (`GrUBdD…`) is custodial.** The receiving address is itself a Coinbase
deposit address: Helius identity tag "Coinbase Deposit", SOL only from Coinbase's
gas distributor, and 41 full-balance sweeps. Its emissions land on Coinbase and its
sweeps are exchange-internal. The registry marks it `custodial: true` and the UI
says so.

## Labels (`labels.js`)

- **Registry first, always:**
  - Coinbase Hot Wallets 1–5 and 8–12, and Coinbase Staking & Gas Distributor;
  - ChangeNOW Hot Wallet 5;
  - Coinbase deposit addresses `DuSvSk…` and `GrUBdD…`;
  - Helium ops keys `hprdnjkb…` and `hPowh…`, labeled "inferred";
  - the fanout and the delegator-pool authority.

  Every entry carries its evidence.
- **Then Helius Wallet Identity** (`api.helius.xyz/v1/wallet/{a}/identity`, key
  from `getHeliusApiKey` in `lib/helius.js`):
  - `type: exchange` or category Centralized Exchange: `exchange_hot`;
  - else a `name`: `named`;
  - else a tag "<X> Deposit": `exchange_deposit`, medium confidence.

  Name and type always beat tags; Coinbase Hot Wallet 10 carries a spurious
  "Bitstamp Deposit" tag.
- **"Sent to an exchange"** means the HNT arrived at an exchange address, never
  "sold". Copy uses factual verbs only.

## Frontend (`pages/public/src/council-emissions/`)

| File | Role |
|---|---|
| `CouncilEmissions.jsx` | Shell. Polls `/summary` every 60 s while visible. View state lives in the query: `?seat=<wallet>&lot=<sig>&tx=<sig>`. Also stats, banners (backfill, drift, no emission for 54 h), elected members and method notes |
| `EmissionsTimeline.jsx` | SVG lanes on a shared UTC axis, with a pattern legend. Emissions above each lane's line, stacked by fate; outflows below it. The bars are too thin for patterns, so every mark's fates are also given as text: the tooltip, a polite live region for screen readers, the seat ledger and the table. Hover or focus links an emission to the transfers that carried it (`lotIdx`), and back. Arrow, Home and End keys move between marks; Enter opens the seat at that mark. Fits the screen below 560 px |
| `FateBars.jsx` | 100% bars (council and per seat), plus the same numbers as a table |
| `patterns.jsx` | One fill pattern per fate (`PatternDefs`/`PatternSheet`), `FateFill` and `Swatch`. Bars, legends and seat swatches use them so nothing relies on color alone |
| `SeatDetail.jsx` | Header (wallet, Solscan and Wallet Dashboard links; the reconciliation is in the API and agent tools, not shown as a pill); a cumulative emitted vs still-held chart (recharts `stepAfter`); every emission with each part's fate, date, days held and hop path; outflows with the emissions they carried; other inflows, with veHNT claims folded per day. Every swap, transfer and hop links to its transaction on Solscan (a fate links the transaction that moved it out of the seat), and each emission and transfer row has a "Link here" permalink (`?seat=&lot=` / `?seat=&tx=`) that scrolls to and highlights it |
| `DistributionRuns.jsx` | Lazy `/runs` table and the explanation of 0/1/2-day runs |
| `format.js` | Base-unit formatting, UTC dates (day counts are UTC calendar days), the `FATES` vocabulary (labels, Okabe-Ito hues, a pattern per fate), destination wording |
| `webmcpTools.js` | Agent tools |

`lib/councilEmissionsApi.js` is the API client. `txUrl`/`accountUrl` come from
`wallet-dashboard/format.js`. Seat names show only from `SEAT_NAMES` entries with
a `sourceUrl`. The elected five (election
`EejcqoypTXfix3m8GrPwLPQfs1P16yCPhiyzkMLvLRx4`) are listed separately, because
no public source maps them to wallets yet.

## Verified vs inferred

- **Verified on chain:** everything in "The flow on chain", every seat's fates and
  reconciliation, the deposit addresses' sweeps to Coinbase hot wallets, and seat
  4's 3,438.96 HNT held before emissions began, plus its veHNT positions.
- **Inferred:**
  - `hprdnjkb…` and `hPowh…` are Helium operations keys (behaviour only);
  - epoch attribution (a mint belongs to the 00:00 UTC at or before it);
  - FIFO attribution itself is a convention, not a fact about which coins moved.

## Gotchas

- Emissions touch only the seats' ATAs, never the owner wallets' signature lists.
  Index token accounts, not wallets.
- The daily emission tx uses address lookup tables. jsonParsed `accountKeys`
  already includes the loaded keys, so token-balance `accountIndex` resolves
  directly.
- Most failed signatures on the fanout token account are the emission crank's own
  failures. Only the fanout PDA's failures are distribution attempts.
- `transfer` (unchecked) carries no mint. HNT-ness comes from the token-balance
  map of the source account.
- A record parsed by an older `parse.js` is re-fetched, not re-parsed (raw txs
  aren't stored).
- The 2026-07-24 seed transfers (0.13 to 0.20 HNT from `hPowh…`) predate the
  window, so they sit in each seat's prior balance.

## Environment

- `SOLANA_RPC_URL`: the Helius RPC. Its `api-key` also authorizes the identity
  API. Never log or return the URL.
- `ADMIN_TOKEN`: the existing secret, for the admin routes.
- Bindings: `DB`, `KV`. No new binding, cron string or env var.

## Local testing

1. Run `npx wrangler dev --test-scheduled --port 8787` from `worker/`.
2. `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" localhost:8787/council-emissions/admin/index`.
   Repeat until `/summary` shows `backfill.done`.
3. Run the frontend with `npm run dev` in `pages/public`; it proxies `/api` to 8787.

## WebMCP

`pages/public/src/council-emissions/webmcpTools.js` exports
`makeCouncilEmissionsTools(navigate)`, registered once in `CouncilEmissions.jsx`
and listed in `src/webmcp/catalog.js`.

- `get-council-emissions`: totals, seats and fates in HNT. `includeTimeline` adds
  each seat's emissions and outgoing transfers, newest first, capped by
  `timelineLimit` (default 100 each).
- `get-council-seat-emissions`: one seat's emissions with fates and hop paths. Paged
  by `offset`/`limit`, newest first. Also outgoing transfers and other inflows
  (veHNT claims folded per day), each capped by `listLimit` (default 50).
- `get-council-distribution-runs`: newest runs, capped by `limit`, plus counts of mints
  and failed attempts.
- `open-council-emissions`: navigates to the page, a seat, or an emission or transfer.

The read tools are `readOnlyHint`, and all reads hit the KV views, so agent
traffic adds no RPC load. Framework: `pages/public/src/webmcp/CLAUDE.md`.

## Landing preview

The card (`pages/public/src/pages/landing/previews/council-emissions.js`, slug
`council-emissions`) sits in its own **Governance** section, after HNT Holders,
on the sea green tone (`TONES.governance`, h 180). It isn't a fourth HNT
Holders card because the palette has no room: Holders' arc is full at 30°
steps, and every placement among them touches a same-hue card or crowds
Brand's orchid. h 180 is the one free gap, between jade (166) and teal (195),
and the card touches neither at 3, 2 or 1 columns.

Three prints, from `scripts/tool-previews/capture/council-emissions.mjs`:
- `timeline` (back): the emissions timeline's five seat lanes, without the legend
  and month axis.
- `bars` (middle): "Where it went, by seat": legend, the all-seats bar and the
  five per-seat bars.
- `emitted` (top, the anchor): the "Emitted to seats" stat tile, shot at dpr 3.

The capture loads `/council-emissions` at 1024 px and clicks nothing. It
connects no wallet; the five seat wallets show because they are the fanout's
recipients on chain, and the owner approved showing them on the card
(2026-10-28). Light and dark come from one page state. The figures are live,
so the anchor's number grows a little every day; re-capture when the card's
components change (the timeline lanes, the fate bars, the stat tiles, the fate
palette or patterns in `format.js` / `patterns.jsx`), not for the numbers.
