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
  RegistrarV0, DaoV0, DaoEpochInfoV0. No Anchor dependency in worker;
  offsets verified against helium-program-library master.
- `discovery.js` — Helius DAS `getAssetsByOwner` filtered by the HNT
  position collection PDA. Pagination capped at 10k/wallet.
- `compute.js` — veHNT formula (baseline + locked) × genesis_multiplier
  with landrush detection; pending rewards sum across unclaimed epochs;
  daily-reward approximation from the most recent fully-issued epoch.
- `cache.js` — KV read-through for registrar (24h), DAO (24h), past-epoch
  DaoEpochInfoV0 (30d — immutable), daily rate (10m).

## Key Concepts

### Position discovery
Every HNT position is an NFT in the registrar's collection PDA, derived as
`["collection", registrar]` under the VSR program. We call
`getAssetsByOwner` then filter for that collection. For each matching
mint we derive `positionKey = ["position", mint]` under VSR.

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
