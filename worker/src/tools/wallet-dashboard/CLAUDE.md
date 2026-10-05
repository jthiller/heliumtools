# Wallet Dashboard

Read-only, full-screen overview of any Helium wallet. Aggregates data the other
tools already know how to fetch (fleet, balances, rewards, governance) into a
single bento-box dashboard, plus operator analytics none of them surface. No
wallet connect, no signing — an address in, a dashboard out. Shareable by URL.

## Architecture

### Worker (API) — prefix `/wallet-dashboard`

Entry point: `index.js` → handlers under `handlers/`. This tool is a thin
aggregation layer; it reuses primitives from other tools rather than
re-implementing on-chain logic.

**Endpoints:**
- `GET /summary?wallet=` — token balances (HNT/MOBILE/IOT/DC/SOL) + USD prices +
  portfolio total + fleet stats (counts by network/device, geo, onboarding-DC).
  KV-cached ~60s. No per-Hotspot list, and no onboard dates (see `/onboarded`).
- `GET /fleet?wallet=` — full per-Hotspot rows for the map + exportable table.
  KV-cached ~120s (shared with `/summary` and `/onboarded` so the Entity API is
  hit once). Rows carry no onboard date.
- `GET /transactions?wallet=&before=&limit=` — categorized recent transactions,
  paginated by signature cursor.
- `POST /rewards { owner, hotspots:[{entityKey,assetId}] }` — batched (≤50) pending
  + lifetime rewards. Reuses the claimer's `getBulkPendingRewards` but **caches**
  per-batch in KV (~15 min; rewards distribute ~daily) and is **cache-first** so
  reloads don't consume the rate limit. The client fans the fleet out to this in
  batches of 50. Lifetime/earning-vs-idle analytics derive from it.
- `POST /onboarded { wallet, entityKeys:[...] }` — batched (≤50) on-chain onboard
  dates, `{ results: { [entityKey]: iso | null }, cached }`. Cache-first per
  Hotspot (`wd:onb:<entityKey>`, ~90 days — the date never changes; a cached
  null retries daily); a fully cached batch spends no rate-limit token. Misses
  use their own window (`ONBOARDED_RATE_LIMIT`, `rl:wd:onb`). The client fans the
  fleet out to this in batches of 50; the timeline, first/latest onboarded, the
  table column, and IoT "Setting up" all derive from it. See the gotcha below.

**Served by OTHER tools/services, called directly from the client:**
- Governance: `GET /ve-hnt/positions?wallet=`
- IoT connectivity: `GET https://api-iot.heliumtools.org/v1/gateways/{address}`
  (helium-iot-service, a separate deployment — source at
  `jthiller/helium-iot-service`). One GET per IoT Hotspot (there is no batch
  endpoint by design); the service is keyless, CORS-open, and edge-cached ~5 min
  specifically to absorb per-row dashboard bursts, so the worker does NOT proxy
  or cache it.
- (The shared `POST /hotspot-claimer/wallet/rewards` is intentionally NOT used by
  the dashboard — it must stay live/uncached for actual claims. The dashboard owns
  the cached `/rewards` path above instead.)

**Services:**
- `services/fleet.js` — fetches Helium Entity API (`/v2/wallet/<addr>`; 404 ⇒
  empty fleet) and maps the full per-Hotspot shape, reading the `hotspot_infos.iot`
  and `.mobile` sub-objects directly so dual-network Hotspots keep all metadata.
  The cached entry (`wd:fleet:v2:*`) also holds an internal `infoAccounts` map
  (entity key → its IoT/Mobile info-account addresses, from the sub-objects'
  `address`) for `/onboarded`; handlers never return it.
  IoT data-only vs full is inferred from the onboarding fee (`< IOT_DATA_ONLY_FEE_MAX`
  ⇒ data-only). Coordinates are NOT taken from the Entity API lat/long (sparsely
  populated) — the client decodes the H3 `location`.
- `services/balances.js` — derives each SPL token's canonical ATA and reads them
  in one `getMultipleAccounts` (NOT `getTokenAccountsByOwner` — that would let a
  spam/airdrop wallet's thousands of token accounts bloat the response) + `getBalance`
  (native SOL). An ATA's existence doubles as the `ataEstablished` flag; a missing
  ATA reports a 0 balance.
- `services/prices.js` — every token price comes from the Jupiter Price API v3
  by mint, through the shared client `worker/src/lib/jupiter.js`
  (`fetchJupiterUsdPrices(env, mints)`, the keyed `api.jup.ag` host with
  `JUPITER_API_KEY` when set, one request for HNT/MOBILE/IOT/SOL; SOL is priced
  as wrapped SOL — hnt-price uses the same client) + DC fixed (100,000 DC = $1). The lib throws only on network/HTTP
  failure; this service stays best-effort and nulls out whatever is missing.
  Pyth Hermes was the
  primary source for HNT/MOBILE/SOL until 2026-08, dropped when unauthenticated
  Hermes access was retired (Pyth pro migration) — these are display-only prices,
  so Jupiter alone suffices. CoinGecko is intentionally avoided (blocks Worker
  egress IPs). KV-cached ~60s.
- `services/transactions.js` — Helius enhanced-transactions REST API (api-key
  parsed from `SOLANA_RPC_URL`), falling back to `getSignaturesForAddress`.
- `services/onboarded.js` — onboard dates from chain via the shared
  `hotspotInfoCreatedAt` (`worker/src/lib/helium-solana.js`, one
  `getSignaturesForAddress` per info account), ≤8 in flight, earliest across a
  dual-network Hotspot's accounts. Caches per entity key (`wd:onb:*`).

### Frontend
- `pages/public/src/wallet-dashboard/WalletDashboard.jsx` — bento shell; the
  wallet lives in the route (`/wallet-dashboard/:address`).
- `pages/public/src/wallet-dashboard/FleetMap.jsx` — deck.gl + MapLibre map
  (adapted from the Hotspot Map tool).
- `pages/public/src/wallet-dashboard/cards/*.jsx` — one component per bento tile.
- `pages/public/src/wallet-dashboard/useFleetIotStatus.js` — progressive
  per-IoT-Hotspot fan-out to api-iot (concurrency 8, chunked state flushes);
  returns `statusByKey` + the feed's `dataThrough`.
- `pages/public/src/wallet-dashboard/useFleetOnboarded.js` — progressive fan-out
  to `/onboarded` (batches of 50, concurrency 2, waits out 429s up to 3×,
  time-throttled flushes). `WalletDashboard.jsx` merges the dates into the rows
  as `onboardedAt` (`withOnboardedAt` in `format.js`: ISO, `null` = unknown,
  `undefined` = loading) for every display surface, and derives
  `onboardingStats` (first/latest, per-month timeline) client-side. The scan
  hooks keep the raw `fleet.hotspots` — the merged array changes identity per
  flush and would restart them.
- `pages/public/src/lib/walletDashboardApi.js` — API client.
- `pages/public/src/lib/iotStatusApi.js` — api-iot.heliumtools.org client
  (`fetchGatewayStatus`; 404 ⇒ `{ notFound: true }`).

## Gotchas

- **Never read Entity API `is_active`** — it is always `false`. Earning/idle is
  derived from rewards (zero lifetime ⇒ idle). See the repo memory note. IoT
  *connectivity* (Active/Inactive) is a separate signal from api-iot (below) —
  the two coexist: connectivity says "connected recently", earning says "has
  ever rewarded".
- **Never read Entity API `created_at` as a date.** It's the indexer's
  row-insert time, and the IoT table was bulk re-indexed on 2025-08-05 (every
  sampled IoT Hotspot reads 2025-08-05 16:29–16:41 UTC; the on-chain info
  accounts of the same Hotspots date to April–May 2023). The Mobile sub-object's
  value was close to chain for natively onboarded Hotspots, but nothing
  guarantees it survives the next re-index. `fleet.js` keeps it only as a
  presence signal in `getNetworks`.
- **What the onboard date is** (`/onboarded`, defined once in
  `hotspotInfoCreatedAt`): the block time of the first
  successful transaction on the Hotspot's IoT/Mobile info account — the account
  the onboard instruction creates (matched each sampled asset's cNFT mint to the
  minute). Failed attempts are skipped. A full 1000-signature page means the
  oldest is out of reach ⇒ null (cached a day) rather than paging; real info
  accounts see a handful of txns. **L1-era Hotspots** have no on-chain
  onboarding: their info accounts were created by the L1→Solana migration
  (genesis, April 2023, or later for a wallet seeded lazily), so their date is
  the migration date. Every surface shows `ONBOARDED_NOTE` (`format.js`) saying
  so. For per-day earnings that's the right span anyway (lifetime is the Solana
  reward oracles' total).
- **`/onboarded` budget + trust.** Helius won't batch historical methods, so a
  miss costs one subrequest per info account: batches are ≤50 Hotspots (≤100
  RPC calls if all dual-network). Info addresses come from the wallet's own
  Entity API fleet (the sub-objects' `address`), never the client. (The shared
  `entityKeyHash` couldn't derive them anyway: Mobile WiFi entity keys, ~366
  chars, exceed its 64-char guard. hotspot-map derives with its own
  `services/pda.js`, bounded by `isValidEntityKey`'s 500-char cap.) A key not in that wallet's fleet resolves null and is **not** cached
  (the cache is per Hotspot, wallet-independent — caching it would poison the
  real owner's entry); a failed lookup isn't cached either.
- **IoT status semantics** (api-iot.heliumtools.org): `status: 0` = active =
  "connected to the Helium Packet Router during the most recent reported day".
  Liveness lands once per UTC day, anchored to `dataThrough` (the feed's newest
  event timestamp), never wall-clock — do NOT present it as "online right now";
  the UI shows "as of `dataThrough`". A Hotspot onboarded *after* `dataThrough`
  hasn't been reported on yet ⇒ render "Setting up", not "Inactive"
  (`iotStatusOf` in `format.js` owns this derivation, from `onboardedAt`; a
  not-active verdict stays "pending" until the row's date lands, so the IoT
  figures count as done only when both scans are). 404s and failed lookups
  render "Unknown" — never mislabeled inactive. Mobile-only Hotspots have no
  IoT status ("—").
- The reward fan-out runs client-side with bounded concurrency, in batches of 50
  to the cached `/rewards` endpoint. Because rewards distribute ~daily, results are
  KV-cached (~15 min) and the endpoint is cache-first, so reloads are free and don't
  trip the rate limit. (Each `/rewards` batch of 50 stays well under the worker
  subrequest cap — one full server-side fan-out of a large fleet would not.)
- `/summary` keeps to a few subrequests (balances + prices + fleet); it does NOT
  fan out rewards or onboard dates server-side (Cloudflare subrequest cap).

## Environment

- `SOLANA_RPC_URL` — Helius staked endpoint (never log or expose). The Helius
  `api-key` is parsed from it for the enhanced-transactions REST API.
- `KV` binding — data caches (`wd:summary:*`, `wd:fleet:v2:*`, `wd:rw:*`, `wd:onb:*`,
  `wd:prices`) and rate-limit counters (`rl:wd:*`, `rl:wd:onb:*`).

## WebMCP

The /wallet-dashboard page registers agent tools `open-wallet-dashboard`, `get-wallet-summary`, `get-wallet-fleet` (capped at 200 rows), `get-wallet-rewards` (fleet-wide pending totals via the cached `/rewards` batches — shares `useFleetRewards`' exported `eligibleRewardHotspots`/`REWARDS_BATCH_SIZE` so batches stay cache-stable; capped at 100 Hotspots), `get-wallet-onboarding` (on-chain onboard dates via `/onboarded` — first/latest, per-month counts, per-Hotspot dates; batches from `useFleetOnboarded`'s `onboardedBatches`, capped at 200 Hotspots; `/summary` and `/fleet` carry no dates, and their tool descriptions point here), and `get-wallet-transactions` from `pages/public/src/wallet-dashboard/webmcpTools.js`. Framework + conventions: `pages/public/src/webmcp/CLAUDE.md`.
