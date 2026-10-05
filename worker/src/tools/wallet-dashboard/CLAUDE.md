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
- IoT connectivity + traffic: `https://api-iot.heliumtools.org` (helium-iot-service,
  a separate deployment — source at `jthiller/helium-iot-service`, API reference in
  its `docs/API.md`). Keyless and CORS-open, so the browser calls it directly and the
  worker does NOT proxy or cache it. Request budget, per page load:
  - `GET /v1/gateways/{address}` — **one per IoT Hotspot** (no batch endpoint by
    design). The ONLY endpoint the service builds for per-row dashboard bursts
    (edge-cached ~5 min). Carries connectivity (`status`, liveness `dataThrough`)
    AND the 30-day `utilization` block (`packets30d`, `ouis[]`, its own data-day
    `dataThrough`) — the dashboard's whole fleet-level traffic picture is free.
  - `GET /v1/iot/utilization` — once per page (5-min memo): the published build's
    `daysComplete` / `missingDays` (lower-bound note, missing chart days) and
    per-OUI network totals.
  - `GET /v1/gateways/{address}/iot/utilization?series=1` (~2 KB) — **only for a
    Hotspot the user opens** (table row chevron / map panel), and skipped when the
    gateway record already says 0 messages. Never fan it out across the fleet.
  - `GET /v1/gateways/{address}/iot/coverage` — **only when the user turns on the
    selected Hotspot's modeled-coverage toggle** on the map.
- OUI names: `https://raw.githubusercontent.com/helium/well-known/refs/heads/main/lists/ouis.json`
  (~5 KB, CORS-open), once per session, only when a detail view opens
  (`lib/wellKnownOuis.js`, ported from World Explorer — same short-name and
  duplicate-id rules). Unnamed OUIs read "OUI {id}"; the utilization API is
  ids-only by design. A failed load rejects (never memoized) so the UI can tell
  "list unavailable" from "OUI not listed" and never claims the latter wrongly.
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

### Frontend
- `pages/public/src/wallet-dashboard/WalletDashboard.jsx` — bento shell; the
  wallet lives in the route (`/wallet-dashboard/:address`).
- `pages/public/src/wallet-dashboard/FleetMap.jsx` — deck.gl + MapLibre map
  (adapted from the Hotspot Map tool).
- `pages/public/src/wallet-dashboard/cards/*.jsx` — one component per bento tile.
- `pages/public/src/wallet-dashboard/useFleetIotStatus.js` — progressive
  per-IoT-Hotspot fan-out to api-iot via `scanGatewayStatuses` (lib; concurrency 8 —
  the WebMCP tool runs the same loop), with throttled state flushes; returns
  `statusByKey` (full gateway records incl. the utilization block) and the newest
  liveness `dataThrough`.
- **One derivation per scan flush:** the shell's `aggregateIotStatus` (format.js)
  computes every row's verdicts once (`rows`: `iotRowOf` → status, traffic,
  health, messages, liveness anchor, hex) plus the health `groups` and fleet
  counts. The hero, IoT card, table, map and agent tools all read that object —
  never re-derive per row. "Most actionable first" is `iotActionRank` (table Status
  sort and the agent tool share it).
- `pages/public/src/wallet-dashboard/useIotLookups.js` — lazy, cached lookups:
  `useUtilizationIndex`, `useWellKnownOuiNames`, `useHotspotTrafficDetail`,
  `useHotspotCoverage` (null key ⇒ idle, no request).
- `pages/public/src/wallet-dashboard/cards/IotStatusCard.jsx` — "IoT connectivity &
  traffic": Hotspots-with-traffic headline, the four health states (rows filter
  the table), completeness note. Rendered only for wallets with IoT Hotspots, at
  the start of the second analytics row (the first row never reflows).
- `pages/public/src/wallet-dashboard/IotTrafficDetail.jsx` + `IotTrafficChart.jsx` —
  one Hotspot's daily delivered messages as a stacked bar per OUI (operator),
  well-known names, per-OUI table. Hosted in a panel below the fleet table's
  scroll box (opened from a row's chevron; focus moves in and back) and, compact,
  in the map's detail panel.
- `pages/public/src/lib/walletDashboardApi.js` — API client.
- `pages/public/src/lib/iotStatusApi.js` — api-iot.heliumtools.org client
  (`fetchGatewayStatus`, `fetchUtilizationIndex`, `fetchGatewayUtilizationDetail`,
  `fetchGatewayCoverage`; 404 ⇒ `{ notFound: true }`).
- `pages/public/src/lib/wellKnownOuis.js` — helium/well-known OUI names.

## Gotchas

- **Never read Entity API `is_active`** — it is always `false`. "Ever rewarded" /
  "Never rewarded" (formerly Earning/Idle) is derived from rewards (zero lifetime ⇒
  never rewarded). See the repo memory note. IoT *connectivity* (Active/Inactive)
  and IoT *traffic* (30-day messages) are separate signals from api-iot (below) —
  they coexist: connectivity says "connected on the latest reported day", traffic
  says "delivered messages in the last 30 days", rewarded says "has ever earned".
- **IoT status semantics** (api-iot.heliumtools.org): `status: 0` = active =
  "connected to the Helium Packet Router during the most recent reported day".
  Liveness lands once per UTC day; its `dataThrough` is an ISO timestamp marking
  the END of the 24h window, so the UI names the data day via `livenessDay()`
  ("2026-10-04T00:00Z" ⇒ "Oct 3") — never "online right now". A Hotspot created
  *after* `dataThrough` hasn't been reported on yet ⇒ render "Setting up", not
  "Inactive" (`iotStatusOf` in `format.js` owns this derivation). 404s and failed
  lookups render "Unknown" — never mislabeled inactive. Mobile-only Hotspots have
  no IoT status ("—").
- **IoT traffic semantics.** The gateway record's `utilization` block counts
  *delivered LoRaWAN messages* (the service calls them uplinks) over the 30 data
  days ending its own `dataThrough` (a `YYYY-MM-DD` data day, a different field from
  the liveness anchor). Data-transfer rewards are based on them, but a count is NOT a
  reward amount, NOT DC, and NOT unique device messages — multi-buy counts one device
  message at every Hotspot that delivered it, so fleet sums are labelled "summed
  across your Hotspots" and the IoT card leads with a Hotspot COUNT. `iotTrafficOf`
  owns the states: `null` sent `no-store` ⇒ "unavailable" (transient; never cached
  client-side), `null` sent cacheable ⇒ "unpublished", `packets30d: 0` ⇒ a real zero.
  A scan mixing ok + unpublished rows counts the latter as unavailable.
- **Health** = connectivity × traffic (`iotHealthOf`): Inactive · had traffic (most
  actionable), Active · no traffic, Inactive · no traffic, Active · with traffic
  (neutral tone — a 30-day total can't confirm traffic is still flowing; the
  per-Hotspot daily chart can).
- **Completeness is not guaranteed.** The service's 28-of-30-days publish gate can be
  forced past, so `daysComplete < 30` happens: totals are then lower bounds. The
  gateway block doesn't say; the index (`/v1/iot/utilization`) does, and its
  `missingDays` are applied only when its `dataThrough` equals the rows' — a missing
  day is drawn as "no data", never 0. Detail `daily[]` rows are sparse (zero-filled
  client-side in `deriveTrafficDetail`).
- **Browser cache.** Edge HITs come back `max-age=14400, stale-while-revalidate=86400`
  (misses `max-age=60`), so a returning visitor's browser can hold records ~a day
  old. The UI shows day RANGES (`livenessRange` / `trafficRange`) when rows disagree
  rather than forcing revalidation.
- **Per-OUI chart colors** follow the OUI's rank within that Hotspot (5 validated
  categorical slots, rest folded into gray "Other"; the slots avoid the dashboard's
  reserved IoT green / Mobile violet / Inactive rose). Light-mode aqua/yellow/magenta
  are < 3:1 on white, so the per-OUI table with numbers is the chart's required table
  view — don't remove it.
- **Modeled coverage** (map toggle, selected ACTIVE Hotspot with a service `hex`
  only — inactive Hotspots are never modeled and return `[]`) is a model, not a
  measurement: always show the terrain attribution, never km² / overlap figures.
  Cells below −130 dBm are dropped (model v3's median cell is ~−131). A footprint whose
  cells don't include the Hotspot's own res-8 parent is from a previous assertion
  (rebuilt nightly). Fleet-row `gain` is tenths of a dBi.
- **Service access risk.** helium-iot-service has a deferred CORS lockdown
  (`ALLOWED_ORIGINS`, see its CLAUDE.md "Deferred: CORS lockdown") whose planned list
  does not include `https://heliumtools.org`; enabling it as written would break every
  IoT surface here (the existing status scan included). `/v1/gateways*` may also
  start enforcing `x-api-key`. Either change needs a coordinated update on the service.
- **FleetMap dot sizes are in pixels** (`radiusUnits: "pixels"`) — deck's default is
  meters, which clamped every dot to `radiusMinPixels` before 2026-10.
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

## WebMCP

The /wallet-dashboard page registers agent tools `open-wallet-dashboard`, `get-wallet-summary`, `get-wallet-fleet` (capped at 200 rows), `get-wallet-rewards` (fleet-wide pending totals via the cached `/rewards` batches — shares `useFleetRewards`' exported `eligibleRewardHotspots`/`REWARDS_BATCH_SIZE` so batches stay cache-stable; capped at 100 Hotspots), `get-wallet-iot-status` (per-IoT-Hotspot connectivity, 30-day messages and health; reads the page's finished scan for the wallet on screen — no per-Hotspot requests, only the 5-min-memoized utilization index — otherwise scans up to 200 IoT Hotspots), `get-iot-hotspot-traffic` (one Hotspot's daily messages per OUI with well-known names; answers a known zero from the gateway record without a detail request), and `get-wallet-transactions` from `pages/public/src/wallet-dashboard/webmcpTools.js`. The health filter, map encoding and coverage footprint are UI-only and intentionally not exposed (`get-wallet-iot-status` already returns health; the footprint is a model for visual context). Framework + conventions: `pages/public/src/webmcp/CLAUDE.md`.
