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
  portfolio total + fleet stats (counts by network/device, geo, timeline,
  onboarding-DC). KV-cached ~60s. No per-Hotspot list.
- `GET /fleet?wallet=` — full per-Hotspot rows for the map + exportable table.
  KV-cached ~120s (shared with `/summary` so the Entity API is hit once).
- `GET /transactions?wallet=&before=&limit=` — categorized recent transactions,
  paginated by signature cursor.
- `POST /rewards { owner, hotspots:[{entityKey,assetId}] }` — batched (≤50) pending
  + lifetime rewards. Reuses the claimer's `getBulkPendingRewards` but **caches**
  per-batch in KV (~15 min; rewards distribute ~daily) and is **cache-first** so
  reloads don't consume the rate limit. The client fans the fleet out to this in
  batches of 50. Lifetime/earning-vs-idle analytics derive from it.

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
  IoT data-only vs full is inferred from the onboarding fee (`< IOT_DATA_ONLY_FEE_MAX`
  ⇒ data-only). Coordinates are NOT taken from the Entity API lat/long (sparsely
  populated) — the client decodes the H3 `location`.
- `services/balances.js` — derives each SPL token's canonical ATA and reads them
  in one `getMultipleAccounts` (NOT `getTokenAccountsByOwner` — that would let a
  spam/airdrop wallet's thousands of token accounts bloat the response) + `getBalance`
  (native SOL). An ATA's existence doubles as the `ataEstablished` flag; a missing
  ATA reports a 0 balance.
- `services/prices.js` — Pyth Hermes multi-feed (HNT/MOBILE/SOL) + Jupiter Price
  API v3 (by mint) fallback for IOT (no Pyth feed) + DC fixed (100,000 DC = $1).
  CoinGecko is intentionally avoided (blocks Worker egress IPs). KV-cached ~60s.
- `services/transactions.js` — Helius enhanced-transactions REST API (api-key
  parsed from `SOLANA_RPC_URL`), falling back to `getSignaturesForAddress`.

### Frontend
- `pages/public/src/wallet-dashboard/WalletDashboard.jsx` — bento shell; the
  wallet lives in the route (`/wallet-dashboard/:address`).
- `pages/public/src/wallet-dashboard/FleetMap.jsx` — deck.gl + MapLibre map
  (adapted from the Hotspot Map tool).
- `pages/public/src/wallet-dashboard/cards/*.jsx` — one component per bento tile.
- `pages/public/src/wallet-dashboard/useFleetIotStatus.js` — progressive
  per-IoT-Hotspot fan-out to api-iot (concurrency 8, chunked state flushes);
  returns `statusByKey` + the feed's `dataThrough`.
- `pages/public/src/lib/walletDashboardApi.js` — API client.
- `pages/public/src/lib/iotStatusApi.js` — api-iot.heliumtools.org client
  (`fetchGatewayStatus`; 404 ⇒ `{ notFound: true }`).

## Gotchas

- **Never read Entity API `is_active`** — it is always `false`. Earning/idle is
  derived from rewards (zero lifetime ⇒ idle). See the repo memory note. IoT
  *connectivity* (Active/Inactive) is a separate signal from api-iot (below) —
  the two coexist: connectivity says "connected recently", earning says "has
  ever rewarded".
- **IoT status semantics** (api-iot.heliumtools.org): `status: 0` = active =
  "connected to the Helium Packet Router during the most recent reported day".
  Liveness lands once per UTC day, anchored to `dataThrough` (the feed's newest
  event timestamp), never wall-clock — do NOT present it as "online right now";
  the UI shows "as of `dataThrough`". A Hotspot created *after* `dataThrough`
  hasn't been reported on yet ⇒ render "Setting up", not "Inactive"
  (`iotStatusOf` in `format.js` owns this derivation). 404s and failed lookups
  render "Unknown" — never mislabeled inactive. Mobile-only Hotspots have no
  IoT status ("—").
- The reward fan-out runs client-side with bounded concurrency, in batches of 50
  to the cached `/rewards` endpoint. Because rewards distribute ~daily, results are
  KV-cached (~15 min) and the endpoint is cache-first, so reloads are free and don't
  trip the rate limit. (Each `/rewards` batch of 50 stays well under the worker
  subrequest cap — one full server-side fan-out of a large fleet would not.)
- `/summary` keeps to a few subrequests (balances + prices + fleet); it does NOT
  fan out rewards server-side (Cloudflare subrequest cap).

## Environment

- `SOLANA_RPC_URL` — Helius staked endpoint (never log or expose). The Helius
  `api-key` is parsed from it for the enhanced-transactions REST API.
- `KV` binding — data caches (`wd:summary:*`, `wd:fleet:*`, `wd:rw:*`, `wd:prices`) and
  rate-limit counters (`rl:wd:*`).
