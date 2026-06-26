# Vote (Governance Proposal Viewer)

A **blind page** (intentionally *not* linked from the landing page) that shows
live vote activity and outcomes for a Helium governance proposal. Built for vote
`4zLh9V1wiZJ3GffytCnqQA9FX1VQSM3kXxx22RpzPXWo`, but works for any proposal.

Everything is read directly from **our own Solana RPC** (`SOLANA_RPC_URL`),
mirroring how heliumvote.com queries on-chain — the browser never talks to an
RPC or an external indexer.

- **Blind URL:** `https://heliumtools.org/vote/<proposalId>` (and `/vote` alone
  falls back to the default proposal above).

## Architecture

### Worker (API) — prefix `/vote`

Entry: `index.js` (rate limit + dispatch) → `handlers/`.

**Endpoints (all GET, read-only):**
- `GET /vote/proposal?id=<pubkey>` — decode `ProposalV0`; returns the
  authoritative outcome: choices with accumulated veHNT `weight` + percentages,
  leading/winning choice, derived status, timing, and the best-effort off-chain
  body. KV-cached ~15s. `id` defaults to the page's proposal.
- `GET /vote/votes?id=<pubkey>` — the live voter roster via `getProgramAccounts`
  on the VSR program, filtered to `VoteMarkerV0` accounts for this proposal.
  Returns per-voter choice + weight, per-choice aggregates, unique-voter count.
  KV-cached ~20s.
- `GET /vote/activity?id=<pubkey>&limit=&before=` — time-ordered recent
  transactions on the proposal account via `getSignaturesForAddress` (the only
  pure-RPC source of per-vote *timing*; markers carry no timestamp). Head is
  KV-cached ~15s; `before` pages are one-shot.

**Services:**
- `services/rpc.js` — thin JSON-RPC helpers (`getAccount`, `getProgramAccounts`,
  `getSignaturesForAddress`) over `SOLANA_RPC_URL`.
- `services/decode.js` — manual Borsh decoders for `ProposalV0` and
  `VoteMarkerV0` (no Anchor in the worker). A small `Reader` cursor handles the
  variable-length proposal layout (nested Vec/String/Option/enum).
- `services/content.js` — best-effort fetch of the proposal's off-chain `uri`
  body (size-capped, long KV cache, degrades to null).
- `utils.js` — `parseProposalId`, `weightToVeHnt`, `tallyChoices`,
  `deriveStatus`, `proposalTiming`.
- `config.js` — program ID, discriminators, default proposal, cache TTLs, caps.

### Frontend
- `pages/public/src/vote/Vote.jsx` — single page: status pill, outcome bars,
  voter roster, live activity feed, collapsible details. Auto-refreshes every
  20s while the tab is visible (no wallet connect; not wrapped in
  `SolanaProvider`). Route registered in `main.jsx` as `/vote` and
  `/vote/:proposalId` — **deliberately absent from `Landing.jsx`** (blind page).
- `pages/public/src/lib/voteApi.js` — API client.

## On-Chain Data Model (verified against source)

| Account | Program | ID |
|---|---|---|
| `ProposalV0` | proposal (modular-governance) | `propFYxqmVcufMhk5esNMrexq2ogHbbC2kP9PU1qxKs` |
| `VoteMarkerV0` | voter-stake-registry (VSR) | `hvsrNC3NKbcryqDs2DocYHZ9yPKEVzdSjQG6RVtK1s8` |

- **`ProposalV0`** (after 8-byte disc): `namespace` Pubkey, `owner` Pubkey,
  `state` enum, `created_at` i64, `proposal_config` Pubkey,
  `max_choices_per_voter` u16, `seed` Vec\<u8\>, `name` String, `uri` String,
  `tags` Vec\<String\>, `choices` Vec\<Choice\>, `bump_seed` u8. The account is
  fixed-size-allocated and right-padded with zeros — parse forward, ignore slack.
  - `Choice` = `weight` **u128 LE** (accumulated veHNT, the authoritative
    tally), `name` String, `uri` Option\<String\>.
  - `ProposalState` (Borsh enum = 1-byte index + fields): `0 Draft`,
    `1 Cancelled`, `2 Voting{start_ts:i64}`, `3 Resolved{choices:Vec<u16>,
    end_ts:i64}`, `4 Custom{name,bin}`. `Resolved.choices` holds the **winning
    choice indices**.
- **`VoteMarkerV0`**: `voter` Pubkey (offset 8), `registrar` (40),
  `proposal` (**72** — the memcmp filter offset), `mint` (104, the position NFT),
  `choices` Vec\<u16\>, `weight` u128, `bump_seed` u8,
  `_deprecated_relinquished` bool, `proxy_index` u16, `rent_refund` Pubkey.
  **No timestamp field.**

### Outcome / status (mirrors heliumvote `getDerivedProposalState`)
- `percent[i] = weight[i] * 10000 / totalWeight / 100`.
- `voting` → **active**; `cancelled` → **cancelled**; `draft` → **draft**.
- `resolved` with >2 choices → **completed**; binary → **passed** if the single
  winner's name starts with `For`/`Yes` (or >1 winner), **failed** if no winner
  or the winner starts with `Against`/`No`.

## Gotchas
- **u128 weights are 16 bytes LE** — decode with BigInt, format via
  `weightToVeHnt` (÷1e8; HNT registrar mint has 8 decimals).
- **`VoteMarkerV0.weight`/`bump`/`proxy_index` come *after* the variable
  `choices` Vec** — never hard-offset past byte 136; parse the vec first.
- **Markers are closed after a proposal resolves**, so `getProgramAccounts` can
  return few/none for resolved proposals. Always treat `ProposalV0.choices[].weight`
  as the authoritative final tally; the roster is the *live* "who voted what".
- **memcmp uses the base58 of the 8-byte discriminator** plus the proposal at
  offset 72 (exactly heliumvote's `useVotes`). Query the **VSR** program, not the
  modular-governance `nft_voter`/`token_voter` (different layout).
- **`VoteMarkerV0.mint` is the position NFT mint, not the voter** — the voter is
  the separate `voter` field.

## Environment
- `SOLANA_RPC_URL` — Helius staked endpoint (never log/expose). No new vars.
- `KV` — caches (`vote:proposal:*`, `vote:votes:*`, `vote:activity:*`,
  `vote:content:*`) and the rate-limit counter (`rl:vote:*`).
