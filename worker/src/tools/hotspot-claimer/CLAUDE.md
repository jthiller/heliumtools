# Hotspot Reward Claimer

Permissionless tool that lets anyone look up a Helium Hotspot's pending rewards (IOT, MOBILE, HNT) and claim them to the designated recipient. The treasury wallet pays transaction fees; rewards go to the hotspot owner (or their custom rewards destination).

## Architecture

### Worker (API)

Entry point: `index.js` → routes to handlers under `handlers/`.

**Endpoints:**
- `GET /lookup?entityKey=<base58>` — Resolve entity key to hotspot metadata (name, network, location, owner)
- `GET /rewards?entityKey=<base58>` — Fetch pending rewards across IOT/MOBILE/HNT via Helium Rewards Oracle
- `GET /wallet?address=<solana-address>` — List all hotspots for a wallet via Helium Entity API
- `POST /claim { entityKey }` — Build, sign, and broadcast claim transaction(s)

**Services:**
- `entity.js` — Derives on-chain keyToAsset PDA, fetches metadata from Entity API + DAS, merges into hotspot info. `extractEntityApiInfo()` shared between single-hotspot and wallet lookups.
- `oracle.js` — Queries Helium Rewards Oracle (`lazy_distributor` program) for each token's pending rewards. Parses on-chain `RecipientV0` account for custom destination. Walks oracle URLs to get current reward amounts.
- `transaction.js` — Builds Solana transactions for `distributeCompressionRewardsV0` instruction. Handles compressed NFT proof, Address Lookup Tables, oracle signatures, and transaction broadcasting.
- `common.js` — Shared Solana RPC helpers (`fetchAccount`, `fetchAsset` via DAS `getAsset`).
- `rateLimit.js` — IP-based rate limiting via KV with sliding window counters.

### Frontend

- `pages/public/src/hotspot-claimer/HotspotClaimer.jsx` — Single-file React component with Hotspot and Wallet tabs
- `pages/public/src/lib/hotspotClaimerApi.js` — API client for all worker endpoints

## Key Concepts

### Entity Key Resolution Flow
1. Base58-decode entity key → SHA-256 hash
2. Derive `keyToAsset` PDA: seeds `["key_to_asset", dao, hash]` under Entity Manager program
3. Fetch on-chain account → extract asset pubkey
4. Parallel fetch: DAS `getAsset` (owner, compression) + Entity API `/v2/hotspot/<keyToAssetKey>` (name, network, location)
5. Entity API is authoritative for metadata; DAS is fallback

### Rewards Oracle
- Each token (IOT, MOBILE, HNT) has a `lazy_distributor` account with oracle URLs
- Oracles are queried via HTTP with the asset ID to get `currentRewards`
- On-chain `RecipientV0` account tracks claimed amounts and optional custom `destination`
- `oracleIndex` must match the oracle's position in the lazy distributor's oracle array — preserved through filtering

### Claim Transaction
- Instruction: `distributeCompressionRewardsV0` (Anchor discriminator from `global:distribute_compression_rewards_v0`)
- Args: `data_hash`, `creator_hash`, `root`, `index` (from compressed NFT proof) + `currentRewards` per oracle
- Oracle accounts are `isSigner: true, isWritable: true` (required by `#[account(mut)]` on-chain)
- Uses Address Lookup Table (`HELIUM_COMMON_LUT`) to compress account list
- Payer wallet signs and pays SOL fees; rewards go to recipient's ATA

### Rate Limits (config.js)
| Limit | Value | Scope |
|-------|-------|-------|
| `MAX_LOOKUPS_PER_MINUTE` | 30 | Per IP, lookup/rewards endpoints |
| `MAX_CLAIMS_PER_IP_HOUR` | 10 | Per IP, claim endpoint |
| `MAX_CLAIMS_PER_HOTSPOT_HOURS` | 24 | Per hotspot, cooldown after claim |
| `MAX_CLAIMS_PER_DAY_GLOBAL` | 100 | Total claims across all users |
| `MAX_RECIPIENT_INITS_PER_DAY` | 1 | ATA creation budget (costs ~0.002 SOL each) |

## Environment / Secrets

- `SOLANA_RPC_URL` — Helius staked endpoint (never log or expose)
- `HOTSPOT_CLAIM_PAYER_WALLET_PRIVATE_KEY` — Treasury wallet base58 private key (never log or expose)
- `KV` binding — Cloudflare KV namespace for rate limit counters and claim cooldowns

## On-Chain Programs

| Program | ID |
|---------|----|
| Lazy Distributor | `1azyuavdMyvsivtNxPoz6SucD18eDHeXzFCUPq5XU7w` |
| Rewards Oracle | `rorcfdX4h9m9swCKgcypaHJ8NGYVANBpmV9EHn3cYrF` |
| Entity Manager | `hemjuPXBpNvggtaUnN1MwT3wrdhttKEfosTcc2P9Pg8` |
| Sub-DAOs | `hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR` |
| Bubblegum (cNFT) | `BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPe` |
| SPL Account Compression | `cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK` |

## Past Bugs

- **Buffer.from hex encoding**: `Buffer.from(hexString)` defaults to UTF-8. Must pass `"hex"` as second arg for hex-encoded `data_hash`/`creator_hash`.
- **Oracle isWritable**: The Helium rewards oracle program declares oracle accounts with `#[account(mut)]`. Setting `isWritable: false` causes Anchor error `0x7d0` (ConstraintMut). Must be `true`.
- **Oracle index mismatch**: After filtering null oracle results, array indices no longer match the on-chain oracle positions. Fix: preserve `oracleIndex` from the original `Promise.all` mapping.

## Structured Logging

All events are `console.log(JSON.stringify({...}))`, viewable via `wrangler tail`:
- `event: "reward_lookup"` — entityKey, owner, network, name, per-token pending amounts
- `event: "wallet_lookup"` — wallet address, hotspots_count
- `event: "claim"` — entityKey, owner, network, name, success flag, per-token results (amount, tx, error)

```bash
# Tail all production logs
cd worker && npx wrangler tail --env production --format json

# Filter to claims only
cd worker && npx wrangler tail --env production --format json | grep '"event":"claim"'
```
