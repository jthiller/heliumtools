# Wallet Dashboard

Read-only, full-screen overview of any Helium wallet. Aggregates data the other
tools already know how to fetch (fleet, balances, rewards, governance) into a
single bento-box dashboard, plus operator analytics none of them surface and
live Mobile network activity read in the browser from Helium's public tables.
No wallet connect, no signing — an address in, a dashboard out. Shareable by URL.

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
  KV-cached ~120s (shared with `/summary` so the Entity API is hit once). Rows
  carry no onboard date.
- `GET /transactions?wallet=&before=&limit=` — categorized recent transactions,
  paginated by signature cursor.
- `POST /rewards { owner, hotspots:[{entityKey,assetId}] }` — batched (≤50) pending
  + lifetime rewards. Reuses the claimer's `getBulkPendingRewards` but **caches**
  per-batch in KV (~15 min; rewards distribute ~daily) and is **cache-first** so
  reloads don't consume the rate limit. The client fans the fleet out to this in
  batches of 50. Lifetime/earning-vs-idle analytics derive from it.
- `POST /onboarded { hotspots:[{entityKey,networks}] }` — batched (≤50) on-chain
  onboard dates per network:
  `{ results: { [entityKey]: { [network]: iso | null } }, cached }`, via lib
  `onboardedAtFor` (cache-first per info account in the shared `onb:*` cache, a
  batched existence check, then signature lookups); a fully cached batch spends
  no rate-limit token.
  Misses use their own window (`ONBOARDED_RATE_LIMIT`, `rl:wd:onb`). The client
  fans the fleet out to this in batches of 50; the timeline, first/latest
  onboarded, the table column, and IoT "Setting up" all derive from it. See the
  gotchas below.

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
- Mobile network activity: Helium's public Mobile **Apache Iceberg** tables, read in
  a Web Worker (`mobile/`, icebird + hyparquet). Both hosts are anonymous and CORS-open,
  so the browser reads them directly and this Cloudflare Worker does NOT proxy or cache
  them:
  - REST catalog `https://catalog.mobile.helium.io/api/catalog/v1/mobile/namespaces/<ns>/tables/<t>`
    — table heads, one GET per table per check (`?snapshots=refs`, the current
    snapshot only; `cache: "no-cache"` so an unchanged table is a 304).
  - Bucket `s3://mobileoracles-mainnet/<key>` ⇒ `https://mobileoracles-mainnet.helium.io/<key>`
    — manifest lists, manifests and Parquet data files, all immutable (snapshot- and
    UUID-named).

  Only for wallets with at least one Mobile Hotspot. Every data file is read **whole,
  once, for every key** (see the gotchas), so the cost is per page, not per Hotspot, and
  the same files serve every wallet. Byte budget per page:

  | Table | Window | First load, cold cache | While visible |
  |---|---|---|---|
  | `rewards.data_transfer` | last 7 UTC days published | 7 files, ~20 MB | 1 file/day (~2.85 MB, ~01:02 UTC) |
  | `hotspots.usage_stats` | latest UTC day | 1 file, ~3.1 MB | 1 file/day (~01:38 UTC) |
  | `hotspots.bans` | whole table | ~15 files, ~0.33 MB | rare |
  | `hotspots.heartbeats` (WiFi) | last 60 min | ~4 files, ~17 MB | ~4.4 MB per ~16-min commit |
  | `hotspots.invalid_heartbeats` (WiFi) | last 60 min | ~4 files, <0.1 MB | ~17 KB per commit |
  | `hotspots.speedtest_avgs` (WiFi) | last 24 h | ~65 files, ~11 MB | ~0.1 MB per commit |

  Plus manifests (~0.3–0.6 MB per live table on a first plan, then each commit's new
  manifest list and manifest). Measured on BMJi… (8 WiFi Hotspots): a cold first check
  is ~53 MB in ~330 requests (a data-only fleet skips the WiFi tables: ~23 MB), a reload
  downloads no data (extracts cache), an unchanged check is six catalog requests. After
  the daily compaction (~02:05 UTC) the speedtest window re-reads the previous day as
  one compacted file (~9 MB). Hidden tabs don't poll (the first check still runs if the
  page opens hidden). Switching wallets, clearing the wallet or loading one without
  Mobile Hotspots cancels the running check, downloads included. The agent tool's
  off-screen check costs the same and shares the caches; its worker finishes writing
  them (at most 5 s) before it's terminated.
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
- `pages/public/src/wallet-dashboard/useFleetOnboarded.js` — progressive onboard
  scan via `scanOnboardDates` (lib/walletDashboardApi.js: batches of 50, two in
  flight, optionally waiting out 429s — the WebMCP tools run the same loop, without
  the waits), time-throttled flushes, IoT Hotspots first. Returns
  `onboardedByKey` (entityKey → `{ iot?, mobile? }`, ISO | null; absent =
  loading), which the shell passes like `rewardsByKey` — to `aggregateIotStatus`
  (which reads the IoT date), the table and the analytics card (which show the
  earliest network's, `onboardedAtOf`) — plus `onboardingStats` (first/latest,
  per-month timeline), null until every date is in.
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
- `pages/public/src/wallet-dashboard/mobile/` — the Mobile activity engine (the
  Iceberg source above; gotchas below):
  - `useMobileActivity.js` — the hook, `useMobileActivity(wallet, hotspots)`
    (`hotspots` undefined = fleet loading, `[]` = loaded). Starts only when the fleet
    has a Mobile Hotspot; returns the contract below. A section the live check doesn't
    have yet (or couldn't load) shows the saved paint's, listed in `cachedSections`.
    The hook owns the Mobile clock: `asOf` moves only when a window label or `stale`
    could change (one timer for the next `nextWindowFlip` or stale threshold, a post
    that freezes or thaws a window, the page shown or hidden), so the shell memoizes
    `aggregateMobile(hotspots, activity, activity.asOf)` on the hook's state object,
    which changes only on the hook's own updates (never on a rewards or IoT flush).
    `mobileFleetOf(hotspots)` (the fleet's Mobile keys and counts) is shared with the
    agent tool.
  - `mobileClient.js` — main thread: ONE lazy worker per page (reused across wallet
    switches, terminated on unmount; one that never answered is replaced at the next
    due check), a check every 2 min while visible plus, for a fleet with WiFi
    Hotspots, a re-assemble every 30 s (the 60-min window slides), paused while
    hidden, a check on becoming visible if the last is > 2 min old. Stopping (a wallet
    switch, a cleared wallet, a fleet without Mobile Hotspots) posts `stop`, which
    cancels the check. Merges the worker's patch posts (a plain merge) and saves each
    finished check as the instant paint. `checkMobileOnce` is a one-shot check in a
    worker of its own (the agent tool's off-screen path; no schedule, no paint): it
    answers on the final state, then lets the worker finish writing its caches
    (`settled`, at most 5 s); on its time limit it stops the check and answers with
    the partial state. (The agent tool shares and briefly reuses whole off-screen
    calls, fleet fetch included; see WebMCP.)
  - `mobileWorker.js` — worker entry. In: `start` (`once` for a one-shot), `refresh`,
    `assemble`, `stop`. Out: session-tagged `state` posts, the first per session the
    full state and later ones patches (the small fields, `tables` with each sliding
    window's `until` among them, plus the sections whose object changed), progress
    only during a wallet's first check, and `settled` after a one-shot. A tick that
    lands mid-check joins it (one final post).
  - `engine.js` — per-table check: file-set diff, one retry, failures isolated per
    table, an 80 MB per-table cap; per table `checkedAt` (last attempt), `okAt` (last
    success) and, for a sliding table, `until`; assembly (sliding windows end now only
    while fresh, see the gotchas), each section cached by its sig (the table's file
    set, plus the in-window row count for a sliding table) so an unchanged one keeps
    its identity and `reassemble` returns null when nothing moved; arrivals, diffed
    only for tables whose file set moved. Heads load in parallel, and once a table is
    planned the next one plans while its files download. A wallet switch or `stop()`
    aborts a per-run signal that reaches every catalog, manifest and data fetch. Files
    a current plan still shows are never evicted for age (`keepSet`). `settle()`
    resolves once its cache writes have.
  - `iceberg.js` (catalog heads, planning from manifests, whole-file reads through
    icebird; a cancelled manifest load isn't reused), `tables.js` (per table: window,
    columns, row normalization, row id, assembly into the contract, `retainMs`,
    `fullMetadata`, and `format`, the row shape's version; worker-only),
    `tableMeta.js` (what the page needs too, kept out of `tables.js` so the dashboard
    bundle doesn't carry the specs: `TABLE_META` (sliding window lengths, `wifiOnly`),
    `TABLE_NAMES`, `SLIDING_TABLES`, `WIFI_TABLES`, `windowLength`,
    `CHECK_INTERVAL_MS`, `FRESH_MS`, `DAY_MS`, `isWindowCurrent` and `metersBetween`,
    which the map shares), `storage.js` (byte cache with its download scheduling, and
    the extracts cache), `paintCache.js` (localStorage paint), `slimCompressors.js`
    (ZSTD + GZIP only).
- `pages/public/src/wallet-dashboard/mobileFormat.js` — `aggregateMobile(hotspots,
  activity, now)`, the **one derivation per Mobile update** (like `aggregateIotStatus`):
  `rows` (Map entityKey → verdicts), per-issue `groups` and `counts`, fleet `rewards`
  and `usage` (with `coverage`, see the gotchas), `windows` (each sliding section's
  wording from `windowText`, with its `until`), `issueText` (each issue worded for
  those windows), `loaded` per table, `failed` per table (its check failed with no
  data in), and `known` per issue (its count is real: its table is in, or it's a WiFi
  issue and the fleet has no WiFi Hotspots). A field is null while its table hasn't
  loaded (unknown, never "no"). Issues, most actionable first (`MOBILE_ISSUE_ORDER`,
  ranked by `mobileActionRank`): `banned` (latest ban row is a ban; the only serious
  one, rose), then the WiFi health signals (amber): `noHeartbeat` (none in the
  heartbeat window), `lowTrust` (latest location trust < 1), `lowSpeedtest` (latest
  24-h multiplier < 1), `rejectedHeartbeats` (any in the window). `MOBILE_ISSUES` is
  static metadata: each entry's color and `tone` (`warn` or `caution`), `wifi`, the
  `table` and `window` behind it, and `text(w)`, which words the label, chip and hint
  for that window; surfaces take the wording from `issueText`. The card, table
  filter, map panel and agent tool all read the aggregate. Also `isMobileHotspot` /
  `isHeartbeatEligible` (the key rules in the gotchas), `nextWindowFlip` (the hook's
  timer), and the panel's formatters (`fmtLocationSource`, `fmtReason`, …).
- `pages/public/src/wallet-dashboard/cards/MobileActivityCard.jsx` — "Mobile activity":
  latest-day HNT headline (USD at that day's price, "Data for Oct 13 (UTC)"), 7-day bars
  (a missing day is a hatch, never 0; screen-reader table) with a fixed two-line readout
  (a bar's day, HNT, USD and "N Hotspots rewarded", or the 7-day total and "No data for
  N days"; it never changes height), "Rewarded data" (the rewards table's bytes for the
  HNT day, the bytes that HNT paid for), users served (from the usage report, with its
  own day when that isn't the HNT day and "From 5 of 6 rewarded Hotspots" when the
  report misses some), WiFi health ("X of Y WiFi
  Hotspots with a heartbeat in the last 60 min", or "in the 60 min to 3:42 PM" once
  frozen; issue rows filter the table; name callouts), a live status pill ("Live",
  "Updating", "Paused"; "· checked …" from `sm` up), "Couldn't load …" notes in place of
  skeletons for failed tables, and a footnote that heartbeats, location trust and
  speedtests are WiFi health signals that HNT from data transfer doesn't depend on. Only
  for wallets with Mobile Hotspots. Second analytics row: with IoT and Mobile cards
  both, they take halves and Operator + Timeline move to a third row in halves; with one
  network card, thirds; with neither, Operator + Timeline in halves. The first row
  never reflows.
- `FleetMap.jsx` Mobile overlay — for a selected WiFi Hotspot with heartbeats in the
  window: its asserted H3 cell, reported positions (fixes within 15 m grouped; hollow
  rings; tooltips give the heartbeat's own distance from asserted), lines to the
  positions more than 25 m away, an arrival pulse at new positions, and at most one
  camera ease per selection: decided on live heartbeats only (`heartbeatsLive`, never
  the saved paint), only when positions sit > 25 m out, and used up by a user pan or
  zoom. A compact
  "Mobile" section in the detail panel: "Earned Oct 13 (UTC)" (HNT · rewarded bytes),
  "Users Oct 13 (UTC)" (the count, or "Not reported" without a usage row), the latest
  heartbeat, speedtest and ban, windows named as on the card, and "Couldn't load" for
  a failed table. `FleetTableCard.jsx`: the table's one filter is
  `{ kind: "iot" | "mobile", key }` (lifted to the shell, reset per wallet), Mobile issue
  chips beside the IoT ones (a `role="group"`), and the Status cell adds the top Mobile
  issue (no new columns; CSV unchanged). The Status sort ranks both networks on IoT's
  scale, a Mobile issue by its `tone`: a `warn` one (a ban) with IoT's most urgent
  state, a `caution` one (the WiFi signals) with the amber states, a Mobile row with
  no issue as healthy; ties by IoT rank, then `mobileActionRank`.
- `pages/public/src/wallet-dashboard/arrivalMotion.jsx` (`useArrivalFlashes`,
  `CountUp`), the generic `ArrivalFlash` in `cards/primitives.jsx`, and
  `lib/useReducedMotion.js` (on `lib/useMediaQuery.js`, like `useDarkMode`) —
  arrival motion (count-ups, one-shot flashes, the live dot's ping, bars growing in,
  the map pulse). Only `arrivals.seq` increments animate: never the first load, a
  cached paint, or a window re-assemble. Everything is off under
  `prefers-reduced-motion`. The 7-day bars and the IoT traffic chart share
  `useDayCursor.js` (arrow keys, Home/End, Escape).

**`useMobileActivity` contract** (plain objects, so it serializes to the paint):

```js
{
  wallet,                     // the wallet these results belong to (ignore if !== current)
  phase: "idle" | "loading" | "live" | "paused" | "error",
  paused: boolean,            // the page is hidden (no checks run)
  checked: boolean,           // a check for this wallet finished on this page (the paint doesn't count)
  stale: boolean,             // the last finished check is older than FRESH_MS
  asOf: number,               // ms the window labels and `stale` are evaluated at (the hook's clock)
  cachedAt: number | null,    // the saved paint's checkedAt (while any section is cached)
  cachedSections: string[],   // the sections shown from the saved paint (TABLE_NAMES order)
  checkedAt: number | null,   // ms of the latest table check attempt, ok or not
  tables: { [name]: { state: "loading"|"ok"|"error", error?: string,
                      checkedAt?: number /* last attempt */, okAt?: number /* last success */,
                      until?: number /* sliding tables once planned: the window's end */ } },
  rewards: {                  // rewards.data_transfer
    days: [{ day: "YYYY-MM-DD", state: "ok"|"loading"|"failed"|"missing", hnt, bytes,
             priceUsd: number|null, hotspots /* of yours rewarded */ }],   // newest first, 7
    byKey: { [entityKey]: { [day]: { hnt, bytes } } },
  } | null,
  usage: { day, byKey: { [entityKey]: { users } } } | null,
  // Sliding sections (60 min, 60 min, 24 h): each window ends at
  // `tables[name].until` (now while fresh, else the table's okAt; see the gotchas).
  heartbeats: { byKey: { [entityKey]: { count, lastAt, trust, distance, source, assertedCell,
                         points: [{ lat, lon, n, lastAt, trust, distance, source }] } } } | null,
  invalidHeartbeats: { byKey: { [entityKey]: { count, lastAt, reasons: { [reason]: n } } } } | null,
  speedtests: { byKey: { [entityKey]: { down, up, latency, multiplier, samples, at } } } | null,
  bans: { byKey: { [entityKey]: { banned, at, reason, message } } } | null,  // keys with ban rows only
  arrivals: { seq, byTable: { [name]: entityKey[] /* keys with new rows */ } },
}
```

`phase` is for display: `idle` (no wallet, fleet not loaded, or no Mobile Hotspots),
`loading` (a loaded Mobile fleet whose check hasn't started or finished yet, or `stale`
data on a visible page, until the next check finishes), `paused` (page hidden; also
during a hidden first check), `error` (the worker crashed, or every table failed), else
`live`. Readiness is `checked` (the agent tool waits on it, and on `stale` while
visible); `paused` and `stale` are flags of their own. `asOf` is not the current time:
it moves only when a window label or `stale` could change (see the hook above), so
`aggregateMobile(hotspots, activity, activity.asOf)` names the windows exactly as the
page shows them. The WiFi sections are null for a fleet without WiFi Hotspots (the
engine skips those tables). `arrivals.seq` increments only on a live check that brought
new rows: never the first or cached load, never a compaction rewrite. Section shapes
are `tables.js`'s `assemble` outputs, and a section an update didn't change keeps its
object identity (the window ends live in `tables`, so a section changes only when its
rows do). A section shown from the saved paint keeps the paint's `tables[name].until`.

## Gotchas

- **Never read Entity API `is_active`** — it is always `false`. "Ever rewarded" /
  "Never rewarded" (formerly Earning/Idle) is derived from rewards (zero lifetime ⇒
  never rewarded). See the repo memory note. IoT *connectivity* (Active/Inactive)
  and IoT *traffic* (30-day messages) are separate signals from api-iot (below) —
  they coexist: connectivity says "connected on the latest reported day", traffic
  says "delivered messages in the last 30 days", rewarded says "has ever earned".
- **Never read Entity API `created_at` as a date.** It's the indexer's
  row-insert time, and the IoT table was bulk re-indexed on 2025-08-05 (every
  sampled IoT Hotspot reads 2025-08-05 16:29–16:41 UTC; the on-chain info
  accounts of the same Hotspots date to April–May 2023). The Mobile sub-object's
  value was close to chain for natively onboarded Hotspots, but nothing
  guarantees it survives the next re-index. `fleet.js` keeps it only as a
  presence signal in `getNetworks`.
- **What the onboard date is** — see `hotspotInfoCreatedAt` (lib/helium-solana.js):
  the block time of the oldest successful transaction on the Hotspot's IoT/Mobile
  info account. **L1-era Hotspots** show their L1→Solana migration date, not their
  original deployment; every surface shows `ONBOARDED_NOTE` (`format.js`) saying
  so. For per-day earnings that's the right span anyway (lifetime is the Solana
  reward oracles' total).
- **`/onboarded` budget + trust.** Helius won't batch historical methods, so a
  miss costs one subrequest per *existing* info account: batches are ≤50
  Hotspots (≤100 lookups if all dual-network). Misses are first checked for
  existence in one batched `getMultipleAccounts`, so an account that doesn't
  exist — what any made-up entity key derives to — reads null without a
  signature lookup or a KV write. The info accounts are derived from each entity
  key (lib `hotspotInfoAccounts`, which accepts ~366-char Mobile WiFi keys),
  never taken from the client — so the RPC can't be pointed at arbitrary
  accounts, and the shared per-account cache is right whoever asks. A failed
  lookup reads null and isn't cached.
- **IoT status semantics** (api-iot.heliumtools.org): `status: 0` = active =
  "connected to the Helium Packet Router during the most recent reported day".
  Liveness lands once per UTC day; its `dataThrough` is an ISO timestamp marking
  the END of the 24h window, so the UI names the data day via `livenessDay()`
  ("2026-10-04T00:00Z" ⇒ "Oct 3") — never "online right now". A Hotspot onboarded
  *after* `dataThrough` hasn't been reported on yet ⇒ render "Setting up", not
  "Inactive" (`iotStatusOf` in `format.js` owns this derivation, from the
  Hotspot's IoT onboard date — not its earliest network's). A not-active verdict
  stays "pending" until that date lands (`awaitingDate` counts those rows; the
  hero withholds its IoT Active share meanwhile, since the resolved rows skew
  active), so the IoT figures (the card's and `iotStateRef`'s `done`) are final
  only once no IoT row is pending; `get-wallet-iot-status`'s own scan reads dates
  for just those rows. 404s and failed lookups render "Unknown" — never mislabeled
  inactive. Mobile-only Hotspots have no IoT status ("—").
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
  fan out rewards or onboard dates server-side (Cloudflare subrequest cap).

### Mobile activity (browser-direct Iceberg)

- **Keys.** A fleet row's `entityKey` (Entity API `entity_key_str`) is byte-for-byte
  the tables' key string. Mobile WiFi indoor/outdoor Hotspots have 366-char RSA keys
  (`1trSuse…`); WiFi data-only Hotspots have 51-char ed25519 keys. Gate Mobile surfaces
  on `networks.includes("mobile")`, never `deviceType` (a dual-network row carries its
  IoT deviceType), and leave out ecc_compact keys (`11…`, e.g. CBRS radios): they never
  appear in these tables, so counting them would read as Hotspots that earned nothing
  (`isMobileHotspot`). Heartbeat eligibility is the RSA keys (length > 100,
  `isHeartbeatEligible`): only WiFi indoor/outdoor Hotspots heartbeat and speedtest.
- **Health signals don't change HNT.** Data-transfer HNT is paid per rewarded byte
  (the same rate per byte whatever a Hotspot's multipliers; a Hotspot with no heartbeat
  all day can be the fleet's top earner). Location trust, the speedtest multiplier and
  heartbeats are WiFi health signals: the UI and agent tool present them that way (amber,
  hints saying data-transfer HNT doesn't use them), never as lost earnings. Only a ban is
  serious (rose).
- **Stale PoC tables.** `rewards.proof_of_coverage` and `rewards.covered_hexes` stopped
  updating on 2026-07-06: don't use them. The HNT shown is data-transfer rewards only
  (`rewards.data_transfer`: `dc_transfer_reward` in bones, 1e-8 HNT; `price` is HNT/USD
  ×1e8 for that epoch). A Hotspot absent from a day earned nothing that day; a day absent
  from the table is "no data", never 0.
- **Rewarded data vs usage.** "Rewarded data" is the rewards table's `rewardable_bytes`
  for the HNT's day: the bytes that HNT paid for, same table and day as the headline.
  `usage_stats` is a separate report that misses some rewarded Hotspots and whose bytes
  drift from the rewards table's, so it supplies users served only (the only usage
  column read): summed across Hotspots (a user served by two counts twice), with its
  own day label, and coverage ("From 5 of 6 rewarded Hotspots", `usage.coverage`) when
  it lacks rows for some of the day's rewarded Hotspots. A Hotspot without a usage row
  is not reported (null, "Not reported"), never 0 users. Its per-carrier breakdown isn't
  read: carrier ids are anonymized (`carrier_N`), with no names.
- **`?snapshots=refs` answers HTTP 400** for some tables (`usage_stats` and the PoC
  reward tables among them): `iceberg.js` falls back to full metadata, and skips
  straight to it for a table flagged `fullMetadata` in `tables.js` (`usage_stats`,
  ~30 KB) so no page logs a 400.
- **BigInt.** Snapshot ids exceed 2^53: metadata is parsed with icebird's lossless
  `parseIcebergJson` and ids are compared as strings. hyparquet returns int64 as BigInt
  and timestamptz as `Date`; `tables.js` normalizes rows to numbers and ms (`toNum`,
  `toMs`) because rows go to IndexedDB, the page and localStorage.
- **Windows and compaction.** Rewards: the 7 UTC days ending at the newest day
  published (newest read first, the other six backfill after the live tables). Usage:
  the latest UTC day. Heartbeats and rejected heartbeats: 60 min by
  `received_timestamp`, sliding with the clock ("in the last 60 min", never "online
  now"). Speedtests: the newest average per Hotspot in 24 h by `timestamp`. Bans: the
  whole table, newest row per `pubkey` by `received_timestamp` (`report_timestamp` is
  broken upstream; `is_ban: false` is an unban). Trino compacts the previous UTC day's
  partition into one file at ~02:03–02:08 UTC. Each check plans the window from the
  current snapshot and diffs the file SET (no lineage walk, so the ~24 h snapshot
  history doesn't matter): new files are extracted, files no longer in the plan
  dropped. A compacted file holds the same rows, so arrivals (a multiset row-id diff)
  never fire for it.
- **Sliding windows freeze rather than drain.** Each table keeps `checkedAt` (last
  attempt) and `okAt` (last success). A sliding window ends at now only while its table
  is fresh: last check ok and within `FRESH_MS` (two check intervals plus a minute,
  5 min). Otherwise (a failed or overdue check, a hidden or sleeping page) it stays
  frozen at `okAt`, so an outage never turns into false "no heartbeat" verdicts. Each
  sliding table's `tables[name]` entry carries its window's end as `until`, and so do
  the saved paint's `tables`. Every surface names the window from it (`windowText` /
  `isWindowCurrent`, through `aggregateMobile`'s `windows`): "in the last 60 min"
  while current, else "in the 60 min to 3:42 PM" (with the date when not today); the
  agent tool gives each window's end. No post announces a window going stale, so the
  hook moves `asOf` at `nextWindowFlip` (and when `stale` flips) and the shell
  re-derives on it.
- **Whole-file reads only.** The key column is 67–92% of every file, keys are
  unordered, and Parquet stats truncate the 366-char keys (manifest bounds at 16
  chars), so range reads and key pruning save nothing. Only time pruning works.
- **Downloads** (`storage.js`) are scheduled by size: one file of 2 MB or more at a time
  beside small ones, five at most, so on a slow link each large file finishes (and is
  cached) before the next starts. A download is abandoned only when no bytes
  arrive for 20 s (and after 10 min in any case), with a `TimeoutError` that reads "The
  request timed out."; a cut-short download keeps its bytes in memory (24 MB of them at
  most) and resumes with a `Range` request on the retry. A download shared by several
  callers stops only when none still waits for it. Files bound for Cache Storage are
  fetched `cache: "no-store"`, so the browser's HTTP cache doesn't keep a second copy.
- **Cancellation.** A wallet switch, a cleared wallet or a wallet without Mobile Hotspots
  stops the check: the engine aborts a per-run signal that reaches every catalog,
  manifest and data fetch, so nothing downloads for a wallet no longer on screen.
- **Cache layers and their keys** (every storage call has a timeout, 3 s for Cache
  Storage (6 s for a file write) and 1 s for IndexedDB; a store whose reads, or whose
  writes, fail three times in a row with no success of that kind is skipped for the
  session, falling back to memory or the network):
  - the HTTP cache: catalog heads revalidate (`cache: "no-cache"`, weak ETag ⇒ 304);
  - per worker in memory: a byte LRU (32 MB, files ≤ 12 MB) and decoded manifest lists /
    manifests by path;
  - Cache Storage `wd-iceberg-v1`: whole files keyed by bucket URL, each stored with
    `x-wd-table` / `x-wd-expire-at` headers, plus an index at
    `https://wd-iceberg.invalid/index.json` (url, bytes, table, expireAt, lastUsed).
    Budget `min(250 MB, 10% of the storage quota)` (100 MB when the quota can't be
    read). Each flush (after a check) re-syncs the index with the cache (files it
    doesn't list are adopted with their real expiry from the headers), evicts every file
    past its expiry unless a current plan still shows it, then least recently used while
    over budget, and saves the index. A file's expiry is its newest row plus `retainMs`
    (the table's window plus slack; window + 20 min for the sliding tables). Sliding
    tables' manifest lists stay in memory only. Shared by every wallet and every tab;
  - IndexedDB `wd-iceberg`, store `extracts`: key `[walletKeysHash:table:v<format>,
    fileUrl]` (a hash of the wallet's sorted Mobile keys, then the table and its row
    `format` from `tables.js`) → that wallet's normalized rows from that file, purged
    past their expiry after each check. **Bump a table's `format` whenever its normalized
    row shape changes**, so old extracts are never read as the new shape;
  - localStorage `heliumtools:wallet-dashboard:mobile:v2:<wallet>` (main thread only)
    → the last finished check for instant paint, `{ wallet, checkedAt, tables, <the six
    sections>, keys }` (`tables` keeps each sliding window's `until`; the hook lists the
    sections it paints in `cachedSections` until the live check replaces them), ≤ 50 KB
    with keys stored once, trimmed in steps for large fleets (down to the 7 daily
    totals), five most recent wallets (`…:v2:recent`). A section whose table failed
    keeps its saved copy (with its saved `tables` entry), and a check with nothing to
    paint keeps the older entry. Bump the `v2` prefix when the saved shape changes.
- **CORS dependency on the bucket.** The bucket's CORS (`ACAO: *`, `range` allowed,
  Content-Length/Content-Range/ETag exposed) is what makes the browser path work; the
  catalog is CORS-open too. If either drops CORS, every Mobile table fails ("Couldn't
  check" on the card; the saved paint still shows) and there is no Worker fallback. Any
  change there needs a coordinated update here.
- **Worker bundling.** The worker builds in Vite's default IIFE format, so its import
  graph must stay free of dynamic imports (IIFE can't code-split; `worker.format: "es"`
  would change the other `?worker` users too). `hyparquet-compressors` is aliased to
  `mobile/slimCompressors.js` by a **regex** (`/^hyparquet-compressors$/`): a string
  alias also rewrites the subpath it imports and breaks the build. The real package
  pulls in Brotli's dictionary and a Snappy WASM module compiled at import time.
- **Large fleets.** The 366-char keys repeat in every `byKey` map, so a 1,656-Hotspot
  fleet's full state is ~2.3 MB. The worker posts it once per session; every later post
  is a patch with the small fields (`tables` carries the windows' ends) and only the
  changed sections, about 0.7 KB for a check that changed nothing. `aggregateMobile`
  takes ~2 ms and re-runs only on the hook's own updates (a worker post, its `asOf`
  clock, the page shown or hidden); `writePaint` runs once per finished check and
  serializes each section once.
- **Delete files.** These tables are append-only, so the engine doesn't apply Iceberg
  delete files; it warns in the console if one ever appears.
- **Two tabs** each poll and can overwrite the shared Cache Storage index; every flush
  re-syncs it from the cache's own entries (with their headers), so nothing is lost or
  kept past its expiry.

## Environment

- `SOLANA_RPC_URL` — Helius staked endpoint (never log or expose). The Helius
  `api-key` is parsed from it for the enhanced-transactions REST API.
- `KV` binding — data caches (`wd:summary:*`, `wd:fleet:*`, `wd:rw:*`, `wd:prices`,
  plus lib's shared onboard-date cache `onb:*`) and rate-limit counters
  (`rl:wd:*`, `rl:wd:onb:*`).

## WebMCP

The /wallet-dashboard page registers agent tools `open-wallet-dashboard`, `get-wallet-summary`, `get-wallet-fleet` (capped at 200 rows), `get-wallet-rewards` (fleet-wide pending totals via the cached `/rewards` batches — shares `useFleetRewards`' exported `eligibleRewardHotspots`/`REWARDS_BATCH_SIZE` so batches stay cache-stable; capped at 100 Hotspots), `get-wallet-onboarding` (on-chain onboard dates via `/onboarded` — first/latest, per-month counts, per-Hotspot dates; through the shared `scanOnboardDates` (no 429 waits — partial results instead), capped at 200 Hotspots; `/summary` and `/fleet` carry no dates, and their tool descriptions point here), `get-wallet-iot-status` (per-IoT-Hotspot connectivity, 30-day messages and health; reads the page's finished scan for the wallet on screen — no per-Hotspot requests, only the 5-min-memoized utilization index — otherwise scans up to 200 IoT Hotspots), `get-iot-hotspot-traffic` (one Hotspot's daily messages per OUI with well-known names; answers a known zero from the gateway record without a detail request), `get-wallet-mobile-activity` (the Mobile picture from `aggregateMobile`: latest-day and 7-day data-transfer HNT with the rewarded bytes it paid for, users served with the usage report's coverage, issue counts over every Mobile Hotspot (null while a count's table isn't in, never 0), each table's state with its `checkedAt` / `okAt` / `error`, each sliding window's end and whether it's current (a frozen one is named by its end), notes saying which sections are the saved paint (`cachedSections`, dated by `cachedAt` or the section's own `tables[name].until`) or a failed table's last good check, and per-Hotspot rows most actionable first (`mobileActionRank`), filterable by `issue`, 50 by default and at most 200; windows and null counts come from the aggregate's `windows` and `known`; when the wallet is on screen it reads the page's state and aggregate through `getMobileState`, waiting up to 45 s for the hook's `checked` (on a visible page, also not `stale`; at once if the worker failed), so nothing is downloaded twice, except when that tab is hidden (`paused`) with its last check older than `FRESH_MS` (hidden tabs don't poll) or the page's fleet failed (`{ wallet, fleetError }`, no wait); otherwise it fetches the fleet and runs one check with `checkMobileOnce`, its own short-lived worker over the same engine and caches, with a 60 s limit after which it returns what it has (per wallet, a running off-screen call, fleet fetch included, is shared and a finished one reused for 30 s after it finishes); its description states that check's byte cost), and `get-wallet-transactions` from `pages/public/src/wallet-dashboard/webmcpTools.js`. The health and Mobile issue filters, map encoding, Mobile map overlay, arrival motion and coverage footprint are UI-only and intentionally not exposed (`get-wallet-iot-status` and `get-wallet-mobile-activity` already return health and issues; the footprint is a model for visual context). Framework + conventions: `pages/public/src/webmcp/CLAUDE.md`.

## Landing preview

The `/` card (`pages/public/src/pages/landing/previews/wallet-dashboard.js`) lays the portfolio ticket (address row, Explorer link and the Portfolio value figure from `cards/HeroCard.jsx`, the anchor) in front of the lower-left corner of the Mobile activity sheet (the top of `cards/MobileActivityCard.jsx`: the latest-day data-transfer HNT headline over its 7-day bars). `scripts/tool-previews/capture/wallet-dashboard.mjs` opens `/wallet-dashboard/<wallet>` by URL, with no wallet connect and no mocks: the `nyc` wallet's bento at a 1040 px layout gives `hero.png`, and the `large` wallet, its map panned to the Great Lakes–East Coast band, gives `mobile-activity.png` (and `fleet-map.png`, spare source material the card doesn't use); `BASE` must serve the Mobile engine's deps (script header): to capture a change that isn't deployed, run `npm install` in `pages/public` and use the local dev server, since `BASE=https://heliumtools.org` shows production. Re-capture and re-bake when the hero's address row or portfolio value, the Mobile activity headline or bar chart, or the `.wd-grid` layout and `h2` card titles the script finds cards by change (`pages/public/src/pages/landing/CLAUDE.md`).
