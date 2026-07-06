# veHNT Positions Analyzer

Analyzes veHNT (vote-escrowed HNT) positions for any Solana wallet. Shows
each position's locked HNT, veHNT voting power, lockup kind/remaining,
landrush status, delegation, pending delegation rewards, and recent voting
activity.

## Architecture

### Worker (API)

Entry: `index.js` → `handlers/`.

**Endpoints:**
- `GET /positions?wallet=<solana-base58>` — return decoded positions + totals
- `POST /claim { positionMint, wallet }` — build unsigned `claim_rewards_v1`
  transactions. User signs via connected wallet adapter and broadcasts
  client-side. **No treasury subsidy** — see "Claim signer" below.

**Services:**
- `decode.js` — Manual Borsh decoders for PositionV0, DelegatedPositionV0,
  RegistrarV0, DaoEpochInfoV0, SubDaoEpochInfoV0. No Anchor dependency in
  worker; offsets verified against helium-program-library master.
- `discovery.js` — Helius DAS `searchAssets` with `tokenType: "fungible"`
  and a server-side `grouping` filter on the HNT position collection PDA.
  Position NFTs are SPL tokens (decimals=0, supply=1), so Helius
  classifies them as fungible; `getAssetsByOwner` with default
  `showFungible:false` would miss them.
- `compute.js` — veHNT formula (baseline + locked) × genesis_multiplier
  with landrush detection; `resolveEpochReward` classifies each unclaimed
  epoch (v1_hnt / v0_dnt / v0_blocked / position_vehnt_zero / …);
  `computePendingRewards` sums across unclaimed epochs.
  **Cross-tool consumer:** the Vote tool's `services/circulating.js` imports
  `computeVeHnt` (and `decodeRegistrar` / `LOCKUP_KIND` from `decode.js`) to sum
  total network veHNT for its participation denominator — keep these pure and
  in sync with voter-stake-registry; if a third consumer appears, hoist them to
  a shared lib.
- `cache.js` — KV read-through for registrar (24h), DAO (24h), past-epoch
  DaoEpochInfoV0 (30d — immutable). `batchCachedAccounts` avoids
  per-account fan-out by collapsing N-sequential RPCs into one
  getMultipleAccounts call.

## Key Concepts

### Position discovery
Every HNT position is an NFT in the registrar's collection PDA, derived as
`["collection", registrar]` under the VSR program. We call Helius DAS
`searchAssets` with `tokenType: "fungible"` and a server-side `grouping`
filter on that collection. For each matching mint we derive
`positionKey = ["position", mint]` under VSR.

**Why fungible?** veHNT position NFTs are SPL tokens with decimals=0 and
supply=1. Helius DAS classifies anything with SPL Token metadata as
"fungible", so `getAssetsByOwner` with default `showFungible:false`
excludes them. Matches helium-program-library's
`getPositionKeysForOwner` in voter-stake-registry-sdk.

### veHNT formula
Mirrors `PositionV0::voting_power` in `voter-stake-registry`:

```
baseline   = amount * baseline_factor / 1e9
max_locked = amount * max_extra_factor / 1e9
locked =
  None:    0
  Cliff:    max_locked * min(end_ts - curr_ts, saturation) / saturation
  Constant: max_locked * min(end_ts - start_ts, saturation) / saturation
genesis_multiplier = (curr_ts < genesis_end && mult > 0) ? mult : 1
veHNT = (baseline + locked) * genesis_multiplier
```

A position is "landrush" when `curr_ts < position.genesis_end` and the
voting-mint-config's multiplier is > 1. For HNT the multiplier is 3 during
the first ~10 days after Solana migration.

### Pending delegation rewards (post HIP-138/141)
`claim_rewards_v1` reads `DaoEpochInfoV0` (not `SubDaoEpochInfoV0`) and
pays in HNT (not DNT). For each unclaimed epoch `e`:

```
share = position_vehnt(epoch_start_ts) * dao_epoch_info[e].delegation_rewards_issued
        / dao_epoch_info[e].vehnt_at_epoch_start
```

Unclaimed epochs are `(last_claimed_epoch, current_epoch)` minus bits set
in `claimed_epochs_bitmap`. v1 response flags `pendingRewardsApprox:
"current-vehnt"` — for Cliff lockups we approximate historical veHNT with
the current value. Error is usually < 1% for recent epochs.

**Two gates zero a v1 epoch's payout** — `claim_rewards_v1` enforces both,
so an estimate that ignores them over-reports (the estimate must match what
the claim actually transfers, not what the position's veHNT alone implies).
Neither exists in `claim_rewards_v0`, so both apply only to the `v1_hnt`
branch of `resolveEpochReward`:

1. **Expiration** — `delegated_vehnt_at_epoch = expiration_ts > epoch_start_ts
   ? voting_power : 0`. A delegation's `expiration_ts` is pinned to the
   proxy-season end at delegate time; once an epoch starts at/after it the
   share is 0. Epochs past expiry surface as reason `v1_expired`.
2. **Vote-participation forfeit** — after sizing the reward the chain BURNS
   it (instead of transferring) when the epoch's DAO `recent_proposals`
   snapshot holds four real proposals and the position was eligible on fewer
   than two (voted on it within the snapshot window, or the proposal was
   still in progress — created < 1 week before the epoch start). See
   `epochIsForfeit` in `compute.js`, mirrored verbatim from the Rust. Epochs
   that would burn surface as reason `v1_forfeit`.

Both gates fail open on missing *decode* data: a DAO snapshot without four
real proposals can't forfeit, and an absent/undecodable `expiration_ts`
(i.e. `null` — the only case the gate skips) is treated as not-expired. This
is not about the on-chain value: `expiration_ts` is an always-present `i64`,
and a decoded **0** pays **0** for every epoch, exactly as the chain's
`expiration_ts > epoch_start_ts` gate does (0 is never > a positive epoch
start). The forfeit rule reads `DaoEpochInfoV0.recent_proposals` (a fixed
`[RecentProposal; 4]`, newest-first) and `PositionV0.recent_proposals` —
both now decoded in `decode.js`. Claiming a forfeited/expired epoch is still
valid on-chain (it marks the epoch claimed and unblocks undelegate/withdraw),
so `claim.js` still builds txns for every unclaimed epoch off the bitmap.

### Claim signer
`claim_rewards_v1` requires `position_authority` (NFT owner) to sign OR
the TUKTUK signer (`8m6iyXwcu8obaXdqKwzBqHE5HM2tRZZfSXV5qNALiPk4`), which
is not open to us. Therefore:

- Worker **builds unsigned** `VersionedTransaction`s with the user's
  wallet as both `position_authority` and `payer`.
- Frontend signs via `@solana/wallet-adapter-react`'s `useWallet()` and
  broadcasts via `Connection.sendRawTransaction`.
- If the queried wallet ≠ connected wallet, the UI hides Claim and shows
  a helium.vote deep-link instead.

## On-Chain Programs

| Program | ID |
|---|---|
| Voter Stake Registry | `hvsrNC3NKbcryqDs2DocYHZ9yPKEVzdSjQG6RVtK1s8` |
| Helium Sub-DAOs | `hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR` |
| SPL Governance | `hgovkRU6Ghe1Qoyb54HdSLdqN7VtxaifBzRmh9jtd3S` |
| Circuit Breaker | `circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g` |

## References

- `programs/voter-stake-registry/src/state/{position,voting_mint_config}.rs`
- `programs/helium-sub-daos/src/state.rs`
- `programs/helium-sub-daos/src/instructions/delegation/claim_rewards_v1.rs`
- `packages/voter-stake-registry-sdk/src/pdas.ts`
