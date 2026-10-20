# Wallet Dashboard

Read-only, full-screen overview of any Helium wallet. Aggregates data the other
tools already know how to fetch (fleet, balances, rewards, governance) into one
sectioned page: Summary, Earnings, Hotspots (one list of IoT and Mobile
Hotspots, with a per-Hotspot detail), Health, Map, Wallet and About. Adds
operator analytics none of them surface, and live Mobile network activity read
in the browser from Helium's public tables. No wallet connect, no signing: an
address in, a dashboard out. The wallet is the path and the view (filters,
sort, the open Hotspot) is the query, so a link shares the exact view.

## Architecture

### Worker (API) — prefix `/wallet-dashboard`

Entry point: `index.js` → handlers under `handlers/`. This tool is a thin
aggregation layer; it reuses primitives from other tools rather than
re-implementing on-chain logic.

**Endpoints:**
- `GET /summary?wallet=` — token balances (HNT/MOBILE/IOT/DC/SOL) + USD prices +
  portfolio total + fleet stats (counts by network/device, geo, onboarding-DC).
  KV-cached ~60s. No per-Hotspot list, and no onboard dates (see `/onboarded`).
- `GET /fleet?wallet=` — full per-Hotspot rows for the Hotspot list, the map and
  About. KV-cached ~120s (shared with `/summary` so the Entity API is hit once).
  Rows carry no onboard date.
- `GET /transactions?wallet=&before=&limit=` — categorized recent transactions,
  paginated by signature cursor.
- `POST /rewards { owner, hotspots:[{entityKey,assetId}] }` — batched (≤50) pending
  + lifetime rewards. Reuses the claimer's `getBulkPendingRewards` but **caches**
  per-batch in KV (~15 min; rewards distribute ~daily) and is **cache-first** so
  reloads don't consume the rate limit. The client fans the fleet out to this in
  batches of 50. Unclaimed, Lifetime earned and "Never rewarded" derive from it.
- `POST /onboarded { hotspots:[{entityKey,networks}] }` — batched (≤50) on-chain
  onboard dates per network:
  `{ results: { [entityKey]: { [network]: iso | null } }, cached }`, via lib
  `onboardedAtFor` (cache-first per info account in the shared `onb:*` cache, a
  batched existence check, then signature lookups); a fully cached batch spends
  no rate-limit token.
  Misses use their own window (`ONBOARDED_RATE_LIMIT`, `rl:wd:onb`). The client
  fans the fleet out to this in batches of 50; the identity row's onboard range,
  the list's Onboarded column and `month` filter, About's timeline and fees card,
  the detail's Details and IoT "Setting up" all derive from it. See the gotchas
  below.

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
    Hotspot the user opens** (the detail's IoT section), and skipped when the
    gateway record already says 0 messages. Never fan it out across the fleet.
  - `GET /v1/gateways/{address}/iot/coverage` — **only when the user turns on
    modeled coverage for one Hotspot** (the map panel's toggle, or the detail's
    Location section).
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

Everything below is under `pages/public/src/wallet-dashboard/` unless a path says
otherwise. The shell runs every data hook, derives each aggregate once per flush
and hands the sections stable props (aggregates, hook states, refs and
`useCallback` handlers); every section is `React.memo`. The redesign's plan,
judged design and copy rules live outside the repo; the code comments cite them
as IMPL_PLAN, JUDGE and the design files (`WdSummary`, `WdHotspots`, …).

#### Shell, URL and data hooks

- `WalletDashboard.jsx`: the shell. The wallet lives in the route
  (`/wallet-dashboard/:address`; `?wallet=` redirects there by replace, keeping
  the other parameters). It runs the data hooks and derives, each in a `useMemo`
  on the hook states: `aggregateRewards`, `aggregateIotStatus`, `aggregateMobile`,
  then `aggregateHotspotList` (with the previous result as `prev`),
  `deriveFleetPlaces`, `mobileFreshness`, `deriveMoney`, `filterRows` and
  `useHotspotOrder`. It renders the seven sections in order, each in a `.wd-zone`
  wrapper; Health, Map and About only for a wallet with Hotspots (or while the
  fleet loads and `/summary` doesn't say it has none). It owns the cross-section
  handlers (`onOpenDetail` from the list, `onOpenHotspot` from Summary, Health,
  About and the map panel, `onShowStatus`, `onShowOnMap`, `onFilter`, `onPlace`,
  `onClearFilter`, and the failed-only `onRetryRewards` / `onRetryIot` /
  `onRetryMobile`), the refs (`listRegionRef`, `detailRegionRef`, `listApiRef`),
  `mapSelect`, `detailMode` and the memoized detail element, the agent tools'
  refs, and `document.title` ("BMJiAP…Cc84Hd · Wallet Dashboard · Helium Tools").
  The root carries `data-wd-settled="true"` once `hotspotList.settled.all`.
- `wallet-dashboard.css`: the dashboard's own stylesheet, imported by the shell so
  it ships in the lazy chunk only. The `--wd-*` tokens on `:root` (light, and dark
  under `prefers-color-scheme`; a `<dialog>` and portaled InfoTips see them), the
  status marks `.wd-st-*` (shape and color, never color alone), the live dot
  `.wd-live`, `.wd-hatch` (missing data everywhere), `.wd-skel`, the `.wd-zone`
  entrance, scroll margins below the 64 px app bar, the sticky table header, the
  dialog classes and the container queries (`wd-detail`, `wd-hmod`). It also
  paints `html` and `body` with the canvas color while `.wd-root` is mounted, so
  dark mode has no seam on overscroll. `tailwind.config.js` maps the tokens to the
  `wd` color group (`text-wd-ink-2`, `bg-wd-caution-surface`, …) and a `wd-*`
  font-size group; nothing else in the theme changed. Boxes use `shadow-soft`,
  never a border; `--wd-iot` and `--wd-mobile` mark networks only, status colors
  mark status only, money is ink.
- `AppBar.jsx`: the sticky glass app bar, 64 px at every width: a skip link to
  `#wd-main`, the brand, and with a wallet on screen the address form
  (`role="search"`; it pushes `/wallet-dashboard/<address>`, so Back returns to
  the previous wallet). Below 768 px the form folds to a 44 px "Look up another
  wallet" link to the lookup page.
- `LookupPage.jsx`: the page with no wallet in the route, or with an invalid one
  (the value prefilled, with a `role="alert"` error). Its "Recent wallets" list is
  `recentWallets.js`: the last 8 valid wallets viewed, newest
  first, in this browser's localStorage (`heliumtools:wallet-dashboard:recent:v1`,
  `{ address, viewedAt, hotspots }`; `hotspots` is the fleet count from the
  `/summary` that recorded the view). The shell records a wallet only once its
  own summary loads, so a well-formed string that isn't a real address (the
  worker 502s on it) never pushes a real wallet off the list, and every entry's
  count is from that view. The lookup screen links each one and can remove one
  or clear the list (focus moves to the neighbouring row's remove button, or the
  address input when none is left; a status region announces it). Another tab's
  changes arrive via `storage` events. Separate from the Mobile paint cache's own
  recent list, which only bounds that cache.
- `useWalletData.js`: `useWalletSummary`, `useWalletFleet`, `useGovernance` and
  `useWalletTransactions` (the latter adds `loadMore`, `loadingMore`,
  `loadMoreError`), each `{ data, loading, error, retry }` scoped to its wallet: a
  late answer for another wallet is dropped, and state that belongs to another
  wallet reads as loading. Also `useResetOnChange(value, reset)`, the per-wallet
  reset that runs during render without re-keying a component (a re-keyed root
  would replay the entrance).
- `urlState.js`: `useDashboardUrlState`, `parseUrlParams` and `dashboardSearch`
  (see "URL state and history" below).
- `useFleetRewards.js`: the progressive reward fan-out to the cached `/rewards`
  (`eligibleRewardHotspots`: rows with an asset ID, sorted by entity key so batch
  composition is stable and cache hits repeat; batches of `REWARDS_BATCH_SIZE`,
  3 in flight). `rewardsByKey` values are the rewards, or null when the batch
  failed; an absent key is still loading. `retryFailed()` re-requests only the
  failed batches, as they were composed, merges the answers and moves `progress`
  back by the retried part only; `retrying` stays true meanwhile, so figures that
  settled stay settled.
- `useFleetIotStatus.js`: progressive
  per-IoT-Hotspot fan-out to api-iot via `scanGatewayStatuses` (lib; concurrency 8 —
  the WebMCP tool runs the same loop), with throttled state flushes; returns
  `statusByKey` (full gateway records incl. the utilization block) and the newest
  liveness `dataThrough`. `retryFailed()` looks up again only the failed (null)
  entries, with `failed` and `retrying` as for rewards.
- `useFleetOnboarded.js`: progressive onboard
  scan via `scanOnboardDates` (lib/walletDashboardApi.js: batches of 50, two in
  flight, optionally waiting out 429s — the WebMCP tools run the same loop, without
  the waits), time-throttled flushes, IoT Hotspots first. Returns
  `onboardedByKey` (entityKey → `{ iot?, mobile? }`, ISO | null; absent =
  loading), which the shell passes to `aggregateIotStatus` (which reads the IoT
  date), `aggregateHotspotList` (each row's `onboarded`, the earliest network's
  date via `onboardedAtOf`, and its `month` via `onboardMonthOf`) and About, plus
  `onboardingStats(onboardedByKey, hotspots)` (first and latest, and the monthly
  timeline zero-filled from the first to the last month, each
  `{ month, count, iot, mobile }`), null until every date is in. A failed batch
  reads unknown (`{}`) for its Hotspots, the same as "no date on chain", so the
  hook also counts them (`failed`, from the scan's per-batch `failedBatches`) and
  `retry()` looks up only those again, in place (`done` stays true, `retrying`
  while it runs). Data status's onboard row is then an error ("8 of 10
  Hotspots, 2 couldn't be read"), and About says "Couldn't read onboard dates"
  with that Retry rather than "No onboard dates found."
- `useIotLookups.js`: lazy, cached lookups:
  `useUtilizationIndex`, `useWellKnownOuiNames`, `useHotspotTrafficDetail`,
  `useHotspotCoverage` (null key ⇒ idle, no request).
- `pages/public/src/lib/walletDashboardApi.js`: API client.
  `lib/veHntApi.js`: `/ve-hnt/positions`. `lib/iotStatusApi.js`:
  api-iot.heliumtools.org client (`fetchGatewayStatus`, `fetchUtilizationIndex`,
  `fetchGatewayUtilizationDetail`, `fetchGatewayCoverage`; 404 ⇒
  `{ notFound: true }`); its `DATA_DAY_RE` lives in the pure `lib/dataDay.js` and
  is re-exported, so no derivation module reaches `lib/api.js` (whose
  `import.meta.env` breaks in Node). `lib/wellKnownOuis.js`: helium/well-known
  OUI names. `lib/urlCompression.js`: `encodeKeys`, the Hotspot Map's `?keys=`
  encoding, for "Open full map".

#### Derivations, one per data set

Pure modules (no React, no fetch, nothing that reaches `lib/api.js`, no Vite-only
syntax), so the WebMCP tools reuse them and a Node harness runs them on captured
fixtures.

- `statusRegistry.js`: the status registry, the one cross-network vocabulary of
  Hotspot states. Tiers, most severe first (`TIER_ORDER`, `TIERS`: each tier's
  `.wd-st-*` mark, its sr-only word and its text tone): Serious, Check, Quiet,
  Info, Unknown, OK, plus Checking. `STATES` gives every state key its tier,
  network, row label, window line(s), chip and filter label, hint and CSV key:
  - Serious: `banned`, `inactiveTraffic` ("Inactive, had traffic").
  - Check: `noRewardedData` ("No rewarded data", 7 days), `activeQuiet` ("Active,
    no traffic"), `inactiveQuiet` ("Inactive, no traffic"), `inactive` (traffic not
    known), and the WiFi signals `noHeartbeat`, `lowTrust`, `lowSpeedtest`,
    `rejectedHeartbeats`.
  - Quiet: `neverRewarded`, `noLocation`.
  - Info: `settingUp`.
  - Unknown: `iotUnknown` (a 404), `iotFailed` ("Couldn't check"), `noStatus` ("No
    status reported": CBRS radios and Hotspots on no network), `mobileFailed`.
  - OK: `heartbeatOk`, `rewardedDays`, `activeTraffic` ("Active, had traffic"),
    `active`. Checking: `checking`.

  Also `makeState`, `stateRank` (the tier's rank × 100 plus the `STATE_ORDER`
  index; OK states are deliberately unlisted, so they tie and a Status sort falls
  through to Unclaimed), `compareStates`, `needsALook` (Serious + Check),
  `statusCtx` (the window and day labels, built once per derivation),
  `DERIVED_FILTERS` (`needs`, `ok`, `mobileOk`), `STATUS_FILTERS` (every value the
  `status` parameter accepts) and `HEALTH_KEY_TO_FILTER` (each Health row's list
  filter of the same predicate). Windows come from the aggregates, never from the
  clock, so a frozen Mobile window is named by its end on every surface.
- `format.js`: formatters (each takes an `empty` word whose default is a word such
  as "Unavailable", "Unknown" or "Not reported", never a dash; `fmtHnt(v, mode)`
  with `"list"` 2 decimals and a "<0.01" floor, `"stat"` 4 below 0.1, `"day"` 4
  below 1; `fmtUtcDate`, `fmtUtcMonth`, `shortAddress` with a real "…"), the IoT
  derivations (`iotStatusOf`, `iotTrafficOf`, `iotHealthOf`, `iotRowOf`,
  `aggregateIotStatus`, `iotActionRank` on `stateRank`, `deriveTrafficDetail`),
  `aggregateRewards`, `onboardingStats` and `onboardMonthOf`, the notes
  (`ONBOARDED_NOTE`, `IOT_MESSAGES_NOTE`, `IOT_CONNECTIVITY_NOTE`), the coverage
  helpers, `DEVICE_LABEL` / `deviceLabelOf` ("Unknown device" for a null or
  unlisted type, also the `device=unknown` facet) and `IOT_HEALTH` (now only each
  health key's `csv` value; the registry owns the rest). `aggregateIotStatus`'s
  `groups` cover every verdict a surface names: the four health keys, `active` and
  `inactive` (traffic not known), `settingUp`, `unknown` (404) and `failed`; its
  counts add `failed` and `notFound`.
- `mobileFormat.js`: `aggregateMobile` (see the Mobile engine below).
- `hotspotList.js`: `aggregateHotspotList`, the unified list: one `HotspotRow` per
  Hotspot, IoT and Mobile together (a dual-network Hotspot is one row), derived
  once per flush from rewards, `aggregateIotStatus`, `aggregateMobile` and the
  onboard dates. Each row has `states` (what it shows, most severe first; OK states
  only when no problem state applies), `top`, `tier`, `needs`, `checking`,
  `verdicts` (every state that applies, OK network verdicts included: filters and
  facet counts match on these), `netLine` ("Mobile: No status reported" for a
  dual-network row absent from the Mobile tables), `unclaimed`, `lifetime`, `day`,
  `week`, `messages`, `users`, `onboarded`, `param` (the `hotspot` URL value: the
  asset ID, else the entity key) and `sig`. A row whose `sig` is unchanged keeps
  its previous object, so memoized rows skip unrelated flushes. The result has
  `rows`, `byKey`, `byParam`, `ctx`, `settled` (`rewards`, `iot`, `mobile`,
  `verdicts` = the three, `onboard`, `all`), `counts` (`needs` is null until
  `settled.verdicts`; `byState` over verdicts; `byTier`; `devices`; `unlisted`),
  `members` (the rows behind each count), `totals` (`sumRows`) and `spark` (the
  shared sparkline scale, capped at the 95th percentile above 200 rows). Same
  module: `filterRows` (`q` matches name, entity key, asset ID, city and state;
  `status` a state key or `needs` / `ok` / `mobileOk`; `net`; `device`; `month`),
  `facetCounts` (each facet over the other facets and the search), `SORTS` /
  `parseSort` / `serializeSort` / `orderRows` (ranked rows, then labelled groups
  for rows missing the sort's value), `summaryLine`, `checkingText` (the one
  "Checking 150 of 1,659 Hotspots…" wording), `verdictsPartial` and `detailModeOf`.
- `fleetPlaces.js`: `deriveFleetPlaces(hotspots)`, once per fleet: decoded
  positions, THE site derivation (Hotspots within 1 km of each other, single link,
  built O(n) by grid bucketing, labelled with the most common city), recorded
  cities, states and countries with their duplicate spellings ("FL" and "Florida"),
  the single `region` when one applies, `unasserted`, and `caption()` ("10 Hotspots
  at 2 sites · 8 Mobile, 2 IoT", "26 Hotspots in 19 cities in Piemonte, Italia ·
  all IoT"). Places are shown as recorded.
- `mobileFreshness.js`: `mobileFreshness(activity, mobile)`, the one derivation of
  how fresh the Mobile picture is: `state` (`none`, `checking`, `saved`, `live`,
  `updating`, `paused`, `error`, `frozen`), `word`, `dotClass`, `checkedAt` (the
  newest successful table check, never a failed attempt), `dataAt`, `savedAt`,
  `asOf` ("As of 3:42 PM" beside figures shown from the saved paint), `from`,
  `note` (the one sentence every surface shows when Mobile data couldn't update),
  `failedTables`, `earningsNote` (Earnings' own note when the earnings or
  users-served figures on screen couldn't update: "Couldn't update earnings and
  users served. Showing data from 5:38 PM."), `line` and `srLine`. Never "Live"
  over a saved paint.
- `money.js`: `deriveMoney(...)`, the wallet's money figures, read by Summary and
  Earnings (so they are equal): `walletValue` (token balances at current prices,
  the split, zero tokens, veHNT locked and expired captions), `unclaimed` (Hotspots
  plus veHNT, claimable vs can't claim yet, legacy tokens, scan state), `earned`
  (`kind` mobile / iot / none; the latest UTC day with USD at that day's price, the
  fleet's 7 days, or IoT activity) and `lifetime` (claimed and unclaimed, lower
  bound). No false zeros: "loading" until a first answer, "scanning" (so far, with
  a denominator), "failed".
- `copy.js`: strings more than one section shows (`UNCLAIMED_NOTE`, `NEW_TAB_SR`,
  `needsLine`, `couldntCheck`, `rewardsFromScope`, `lowerBoundClause`,
  `LOWER_BOUND_NOTE`, `USERS_NOTE`, `noDailyNote`, `DATA_ONLY_NOTE`,
  `WIFI_SIGNALS_NOTE`, `HOTSPOTS_ONLY_NOTE`, `CLAIM_LABEL`, `healthScope`,
  `FLEET_UNAVAILABLE`, …) and the link rule (below).
- `map/selectedOverlay.js`: a selected WiFi Hotspot's heartbeat geometry (its
  asserted res-12 cell, reported positions grouped within 15 m, lines to those
  more than 25 m out, the one distance wording), drawn by both the fleet map and
  the detail's mini map. `map/basemap.js`: the Carto Positron / Dark Matter style
  URLs, the attribution and the overlay colors read from the `--wd-*` tokens.
- View models over those, each pure: `summary/dataStatus.js` (`deriveDataStatus`),
  `health/iotModule.js` and `health/mobileModule.js`, `about/aboutModel.js`,
  `wallet/activityModel.js`, `map/mapEncoding.js`, `map/useSiteClusters.js`'s
  helpers and `hotspots/csv.js`.

**One derivation per data set.** Every surface (sections, the map, the detail, the
agent tools) reads these objects and never re-derives a row:
- IoT verdicts: `aggregateIotStatus` (`rows`, `groups`, counts), once per scan
  flush.
- Mobile verdicts: `aggregateMobile`, once per hook update.
- A Hotspot's states, tier and "need a look": `aggregateHotspotList`, worded by
  the registry. "N of M need a look" is `counts.needs` through `copy.needsLine`;
  "No issues" only when nothing failed or froze (`verdictsPartial`), else "0 of 10
  need a look".
- Status filters match `row.verdicts`, and every count that links to the list uses
  the same predicate as the filter it sets: Health rows through
  `HEALTH_KEY_TO_FILTER` (its "No issues" is `mobileOk`, `isWifiNoIssue`),
  Summary's reason chips, About's device, city, never-rewarded and unasserted
  rows, and a timeline month (`onboardMonthOf`). So a count and the list's result
  line agree (a city's search can also match its other spellings; About's row
  says how many it shows).
- Money: `deriveMoney`. Sites and captions: `deriveFleetPlaces`. Mobile
  freshness: `mobileFreshness`. "Checking …" lines: `checkingText`. Heartbeat
  geometry: `selectedOverlay`. Shared wording: `copy.js`.

#### Sections

Fleet-size tiers live inside the sections: a wallet with no Hotspots shows "No
Hotspots in this wallet." and no Health, Map or About; one Hotspot makes the
detail the Hotspots section's body (`detailMode` "inline") and About one line; up
to 10, Health names Hotspots; from 200, Health's counts get percentages; above
200, the list's arrival flashes are off and the sparkline scale is capped.

- **Summary** (`sections/SummarySection.jsx`, `summary/IdentityRow.jsx`,
  `summary/DataStatus.jsx` + `summary/dataStatus.js`, `summary/MoneyBand.jsx`,
  `summary/FleetStatusLine.jsx`): the page's h1 (the short address, the full one
  for screen readers) with Copy wallet address, the fleet caption
  (`places.caption()` plus "Onboarded {first} to {latest} (UTC)" and the onboard
  InfoTip), and the actions: the Data status chip, Copy link (`location.href`, so
  filters, sort and the open Hotspot travel) and Solscan. The Data status chip is
  the page's one freshness signal ("Live · checked 1m ago", "Checking 150 of
  1,659", "Saved from 3:42 PM, checking", "2 sources couldn't load", "Couldn't
  check · data from 7:42 PM"); it opens a non-modal popover listing every source
  (balances and prices, rewards, onboard dates, IoT status and messages, Mobile,
  veHNT, activity) with what it covers and its state. The money band (a `dl`, four
  columns at 1280 px and up, 2x2 below): Wallet value (52 px USD, token split bar
  and legend), Unclaimed (with "Claim Hotspot rewards"), Earned on the latest UTC
  day for a wallet with Mobile Hotspots (USD at that day's price, a static 7-bar
  mini chart) or "IoT activity" for an IoT-only one, and Lifetime earned ("≥" for a
  lower bound). The fleet status line says how many need a look with reason chips
  linking to `?status=<key>&sort=status`. A failed `/summary` shows one alert with
  Retry while the rest keeps loading; a failed fleet settles every fleet figure.
- **Earnings** (`sections/EarningsSection.jsx`, `earnings/DailyHntCard.jsx`,
  `earnings/EarningsFacts.jsx`, `earnings/UnclaimedCard.jsx`,
  `earnings/LifetimeCard.jsx`): "HNT per day", the fleet's HNT from Mobile data
  transfer per UTC day for 7 days through `ui/DayBars` (a fixed readout above the
  bars; a missing day is hatched, a failed one an outlined well, a loading one
  pulses, none is 0; the total counts only days with data; an sr-only table with
  USD and rewarded data); beside it Rewarded data, Users served (its own day) and
  Hotspots rewarded. When the latest Mobile check couldn't update the earnings
  or users-served tables, `freshness.earningsNote` shows under the chart's total
  and in Summary's Earned column, each with a Retry. An IoT-only or empty wallet
  gets a note that there is no per-day chart. Then Unclaimed (Hotspots split into "Claimable now" and "Can't
  claim yet", legacy IOT and MOBILE, veHNT, each with its own claim link) and
  Lifetime earned (Claimed and Unclaimed, legacy, "At least" for a lower bound).
- **Hotspots** (`sections/HotspotsSection.jsx`, `hotspots/Toolbar.jsx`,
  `hotspots/StatusChips.jsx`, `hotspots/HotspotTable.jsx`, `hotspots/HotspotRow.jsx`,
  `hotspots/StatusCell.jsx`, `hotspots/Pager.jsx`, `hotspots/HotspotListPhone.jsx`,
  `hotspots/FilterSheet.jsx`, `hotspots/csv.js`, `hotspots/useHotspotOrder.js`): the
  unified list. Default order "Unclaimed, most first". Toolbar: search, Network
  (only with both networks), Device (two or more types), Sort, and the exports
  (Copy entity keys, Copy names, Download CSV, of the current filter in the order
  shown; disabled with the reason while loading or empty). Status chips with
  faceted counts (Needs a look, the problem states by tier, No issues, then Quiet,
  Info and Unknown after a gap; dashed placeholders while a source is checked).
  The desktop table has two header rows under the "HNT from Mobile data transfer"
  band (Hotspot, Status, Unclaimed, Earned {day}, 7 days with a sparkline,
  Lifetime, Onboarded from 1280 px); with the IoT network filter, or a wallet with
  no Mobile daily HNT, the band gives way to "Messages" (30 days). Status cells show
  the top state's mark, label and window, "Also: …" and "+N more". Labelled groups
  at the end hold rows missing the sort's value; `tfoot` totals say "so far" while
  scanning and "Hotspots only. Unclaimed at the top includes veHNT." when veHNT is
  pending. Below 768 px the list is a `ul` of four-line rows with a filter sheet
  (`<dialog>`), chosen by `matchMedia` (never both in the DOM). The result line
  (`role="status"`) announces user changes only ("Showing 3 of 10 Hotspots: No
  heartbeat (60 min)"). Rows don't move while data fills in (`useHotspotOrder`,
  see the gotchas). Paging, not virtualization: 100 rows on desktop and 50 on
  phones, "Show 100 more" and "Show all"; the section fills `listApiRef` with
  `ensureRendered(key)` and `focusRow(param)`. CSV (`hotspots/csv.js`): the
  original columns first in their order and vocabularies, new columns appended
  (`status_tier`, `status_states`, `unclaimed_hnt`, `hnt_7d`, the Mobile health
  columns, `onboarded_at_iot` / `onboarded_at_mobile`, …); unknown numbers are
  blank, only state columns say "pending"; the formula-injection guard stays; the
  file is `hotspots-<first 6 of the wallet>-<day>.csv`.
- **Hotspot detail** (`detail/HotspotDetail.jsx`, `detail/DetailDialog.jsx`,
  `detail/DetailNav.jsx`, `detail/DetailHeader.jsx`, `detail/DetailStatus.jsx`,
  `detail/DetailEarnings.jsx`, `detail/MobileHealth.jsx`,
  `detail/LocationSection.jsx`, `detail/LocationMap.jsx`, `detail/DetailFacts.jsx`,
  `detail/parts.jsx`, plus `IotTrafficDetail.jsx` and `IotTrafficChart.jsx`): one
  Hotspot, presented by `detailModeOf`: `inline` (a one-Hotspot wallet), `aside`
  (1280 px and up, a sticky 440 px column beside a narrowed table), `drawer` (768
  to 1279, a modal `<dialog>` from the right) or `fullscreen` (below 768). One
  renderer at a time. Sticky bar (Close, "6 of 10, by Unclaimed", Previous / Next
  through the filtered order); header (name as the focus target, network and
  device, place, Copy entity key, Solscan, Show on map, Update location for IoT),
  the ban block and the Mobile freshness note; Status (every state with its full
  window); Earnings (Unclaimed with claim state and USD at today's price, Lifetime,
  the Mobile 7-day bars, users served, Legacy tokens, Claim rewards, the reward
  destination when it isn't this wallet); the IoT section (connectivity, Messages
  delivered, the per-OUI stacked chart and table); Mobile WiFi health (or a
  data-only Hotspot's ban); Location (a 240 px MapLibre mini map drawn from
  `selectedOverlay`, positions list, modeled coverage toggle with
  `ui/CoverageNotes`, cell, gain and elevation); Details (onboarded per network in
  UTC with the L1 note, onboarding fee, asset ID). `DetailDialog` provides a
  `PortalTarget` so InfoTips render inside the modal, and mounts the detail only
  while open (its WebGL context is released on close); `LocationMap` stays one
  instance across Previous / Next. A detail the viewer opens or steps, or an
  agent's `open-wallet-dashboard` opens, focuses its heading (an agent's open in
  the aside first scrolls the list into view, as an open from outside the list
  does). A deep link's first paint and Back or Forward take no focus in the aside
  (the dialogs focus their heading at every open); Escape closes the aside from
  inside it, or while nothing has focus and the aside is on screen.
- **IoT traffic detail** (`IotTrafficDetail.jsx` + `IotTrafficChart.jsx`): one
  Hotspot's daily delivered messages over 30 days as a bar stacked by OUI
  (operator), with well-known names, a fixed readout above the chart
  (`ui/useDaySelect`), a hatch for unreported days, and the per-OUI table (it folds
  its last columns at 520 px of detail width). Hosted only in the detail now.
- **Health** (`sections/HealthSection.jsx`, `health/HealthModule.jsx`,
  `health/StatusBar.jsx`, `health/iotModule.js`, `health/mobileModule.js`): one
  module per network the wallet has, side by side from 1024 px. IoT "Connectivity
  and traffic" (chip "Data for Oct 14 (UTC)", scan progress, "2 of 2 IoT Hotspots
  active on Oct 14 (UTC)", the Messages delivered well, the tier bar and legend,
  the positive line, rows by state, footnotes). Mobile "WiFi health" (the Live
  chip from `mobileFreshness`, "5 of 8 WiFi Hotspots sent a heartbeat in the last
  60 min", issue rows, "No issues"), or "Bans" for a data-only fleet, plus a
  Check-marked "No rewarded data" note with "View in list" when the list has any.
  Rows name up to 10 Hotspots (each opens its detail), else "Show {n} in list";
  every row links through `HEALTH_KEY_TO_FILTER`. While the fleet loads, the
  modules `summary.fleet.byNetwork` promises are reserved at their final size; a
  failed fleet reads one line ("Hotspot health is unavailable until the Hotspot
  list loads.") with the shared Retry.
- **Map** (`sections/MapSection.jsx`, `FleetMap.jsx`, `map/useSiteClusters.js`,
  `map/SiteMarkers.jsx`, `map/mapEncoding.js`, `map/markerIcons.js`,
  `map/MapLegend.jsx`, `map/MapControls.jsx`, `map/MapPanel.jsx`, `map/Loupe.jsx`,
  `map/PhoneMap.jsx`): the caption from `places`, "Open full map" (an internal
  link to `/hotspot-map?keys=…` when the URL stays at most 8 KB, else plain
  `/hotspot-map`), and a toolbar with "Color by" Network / Health and the
  close-up, filter ("Showing 5 of 10 Hotspots: Needs a look" + Clear filter) or
  checking line. `FleetMap.jsx` is deck.gl over MapLibre (Carto Positron / Dark
  Matter): site markers are HTML buttons (`map/SiteMarkers.jsx`, a ring split by
  network or by tier, the count, a need-a-look badge, a place label; one
  "Sites on the map" group with a roving tabindex), placed by a rAF loop outside
  React from a supercluster index over `places.sites` (`map/useSiteClusters.js`:
  a marker is one site or several whole sites, never part of one; a site resolves
  into its dots once it spans more than its marker, or from zoom 15). Single
  Hotspots are an `IconLayer` of prebuilt sprites (`map/markerIcons.js`; Network
  mode fill = network, ring = status, IoT size by 30-day messages; Health mode
  shape = tier), dimmed outside the list filter. A dot click selects on the map
  and opens `MapPanel` (summary, coverage toggle, "Open Hotspot details"); a URL
  `hotspot` or the detail's "Show on map" (`mapSelect`) selects and flies to the
  site close-up. The selected overlay (asserted cell, reported positions, lines,
  the arrival pulse) comes from `selectedOverlay`; the modeled coverage footprint
  is a `PolygonLayer`. `MapLegend` floats at 1280 px and up (a row below at 768 to
  1279, a `<details>` on phones) with a windows line; `MapControls` are + / − /
  Fit. The loupe (`map/Loupe.jsx`, MapLibre only) shows a dense site of 5 or more
  Hotspots one by one, for fleets of 200 or fewer, at fleet zoom, never on phones.
  Phones get `map/PhoneMap.jsx`: a static MapLibre-only preview, "Open map" (a
  full-screen `<dialog>` with the interactive map) and a "By place" list. A failed
  fleet reads one line ("The map is unavailable until the Hotspot list loads.")
  with the shared Retry, and a fleet with no asserted location says so with a link
  to those Hotspots in the list.
- **Wallet** (`sections/WalletSection.jsx`, `wallet/Balances.jsx`,
  `wallet/VeHnt.jsx`, `wallet/Activity.jsx`, `wallet/activityModel.js`): Balances
  (nonzero tokens HNT, SOL, DC, then legacy MOBILE and IOT, with price per token;
  zero tokens folded into one line, with the missing-token-account caution and the
  rewards it blocks; "Not counted: … HNT locked in veHNT."), veHNT (positions, HNT
  locked, voting power, delegations by network, unclaimed with "Claim veHNT
  rewards", lockups, the soonest delegation expiry with a caution inside 30 days),
  and Activity (transactions with plain labels, grouped by local day and then by
  what happened; a failed transaction never folds into a group; Load more keeps
  loaded rows on failure; "All transactions on Solscan").
- **About** (`sections/AboutSection.jsx`, `about/Composition.jsx`,
  `about/Places.jsx`, `about/OnboardingTimeline.jsx`, `about/OnboardingFees.jsx`,
  `about/aboutModel.js`): Composition (network split, devices including "Unknown
  device", rewarded vs never rewarded, location), Places (as recorded, with the
  duplicate-spelling note), Onboarding over time (monthly bars stacked by network,
  `ui/useDaySelect` keyboard model; a month filters the list by `month`), and
  Onboarding fees (DC first, then USD at the fixed DC price; first and latest
  onboarded; failed onboard-date lookups are said, with a Retry for just those).
  Every count is a row set the list can show, and each sets that filter, except
  the state chips under Places (display only: the list has no state facet yet,
  and a two-letter search would match entity keys). A failed fleet reads one line ("Fleet facts are unavailable until the
  Hotspot list loads.") with the shared Retry.

#### Shared UI (`ui/*`, re-exported by `ui/index.js`)

`Section` (the section root with its h2, caption, right slot and `busy`), `Card`
(`rounded-2xl bg-surface-raised shadow-soft`), `Stat`, `StatusMark` (tier shape
plus its sr-only word), `Chip` / `NetChip` / `LiveChip` (reads a `freshness`
object) / `Tag`, `NetDot`, `Controls` (`Btn`, `Btn2`, `IconBtn`, `Seg` as an ARIA
radiogroup with one tab stop, `Select`, `SearchField`), `InfoTip` (a 16 px button
with the text as its description; it portals into the nearest open `<dialog>`
through `PortalTarget`), `Skeleton`, `Pending` (the one "…" renderer, with
sr-only "Loading" or "Checking"), `Sparkline`, `DayBars` + `useDaySelect` (a day
is always shown: hover previews, click picks, Left / Right / Home / End, Escape
returns to the default), `Progress`, `TimeAgo` (one module-level minute ticker in
`ui/clock.js` shared by every instance; `fallback` is a required word),
`ArrivalFlash`, `CopyIconButton` (announces "Copied", and on a clipboard failure
"Couldn't copy. Select the text and copy it."), `ExtLink`, `Disclosure`,
`CoverageNotes` / `CoverageToggle`, `FleetError` (the shared failed-fleet line
with Retry) and `useRetryFocus` (the shell's one Retry focus keeper, see Gotchas).

Link rule (`copy.js`): only external links (Solscan, heliumvote, the terrain
tiles attribution) get "↗", open a new tab and carry ", opens in a new tab" in
their accessible name, through `ui/ExtLink.jsx`, the only renderer. Internal tool
links open in the same tab without "↗": `/hotspot-claimer?mode=wallet&wallet=…`
(Claim Hotspot rewards), `/ve-hnt?wallet=…` (Open veHNT, Claim veHNT rewards),
`/update-location`, `/hotspot-map`.

#### URL state and history (`urlState.js`)

The canonical path is `/wallet-dashboard/:address`; the view is the query:

| Param | Values | Default (omitted) |
|---|---|---|
| `hotspot` | asset ID, or the entity key of a row without one | none |
| `q` | text ≤ 100 | "" |
| `net` | `all` `iot` `mobile` | `all` (and read as `all` unless both networks are present) |
| `status` | a registry state key, `needs`, `ok`, `mobileOk` | all |
| `device` | a `DEVICE_LABEL` key in the fleet, or `unknown` | all |
| `sort` | a `SORTS` key, bare or `.asc` / `.desc` | `unclaimed` (desc), or this wallet's remembered sort |
| `month` | `YYYY-MM` (onboard month, UTC) | none |

- `useDashboardUrlState(wallet, list, { fleetLoaded })` returns `[url, setUrl,
  nav]`. `setUrl(patch, { push, focusList, announce, immediate })` replaces by
  default and keeps the history state, so a filter changed while a detail is open
  keeps `wdDetail` and Close still goes back; `q` is debounced 300 ms unless
  `immediate`; `focusList` scrolls `#hotspots` into view and focuses the list
  heading. Values that don't validate (an unknown status, a device the fleet
  doesn't have, `net` without both networks) read as the default and are dropped
  on the next write.
- `nav.openDetail(param, opener, { preferOpener, modal })` pushes `hotspot` with
  history state `{ wdDetail: true }` when no detail is open, else replaces it
  (another row, a Health name, the map panel); `nav.stepDetail(param)` replaces
  (callers first run `listApiRef.current.ensureRendered(key)`);
  `nav.closeDetail({ returnFocus })` goes back when the detail pushed, else
  replaces without `hotspot`. Back from a pushed detail keeps a view changed while
  it was open. Focus returns to the row link of the Hotspot last shown
  (`[data-hotspot-link="<param>"]`), else the opener, else the list heading; a
  modal detail also restores the opener's place in the viewport.
- A deep link to a valid `hotspot` gets the list entry inserted below it, so Back
  closes the detail and a second Back leaves the page. A `hotspot` not in the
  fleet is dropped by replace once the fleet loads.
- Remembered sort: localStorage `heliumtools:wallet-dashboard:sort:v1` (8 most
  recent wallets, every access in try/catch). The URL wins; with no `sort` the
  wallet's remembered one is written into the URL by replace, so Copy link and a
  reload carry it.
- A different wallet is a different path: every in-app wallet link (the app bar,
  Recent wallets, `open-wallet-dashboard`) goes to the bare path, so the view
  resets with it. The `?wallet=` alias keeps the other parameters.

#### Motion

`arrivalMotion.jsx` (`useArrivalFlashes`, `CountUp`), the generic
`ui/ArrivalFlash.jsx`, and `lib/useReducedMotion.js` (on `lib/useMediaQuery.js`,
like `useDarkMode`): Summary's Earned figure counts up on a rewards arrival,
Earnings' bars grow, Health's Mobile headline counts up and its issue rows wash,
the Live dot pings once, a list row's Status cell flashes (lists of 200 or fewer)
and the map pulses new heartbeat positions. Only `arrivals.seq` increments
animate: never the first load, a cached paint, or a window re-assemble. Sections
rise once on first mount (`.wd-zone`); a wallet switch never replays it.
Everything is off under `prefers-reduced-motion`.

#### Mobile activity engine (`mobile/`)

The Iceberg source above; gotchas below.
  - `useMobileActivity.js` — the hook, `useMobileActivity(wallet, hotspots, { refreshRef })`
    (`hotspots` undefined = fleet loading, `[]` = loaded). Starts only when the fleet
    has a Mobile Hotspot; returns the contract below. A section the live check doesn't
    have yet (or couldn't load) shows the saved paint's, listed in `cachedSections`.
    The hook owns the Mobile clock: `asOf` moves only when a window label or `stale`
    could change (one timer for the next `nextWindowFlip` or stale threshold, a post
    that freezes or thaws a window, the page shown or hidden), so the shell memoizes
    `aggregateMobile(hotspots, activity, activity.asOf, prev)` on the hook's state
    object, which changes only on the hook's own updates (never on a rewards or IoT
    flush). `mobileFleetOf(hotspots)` (the fleet's Mobile keys and counts) is shared
    with the agent tool. The optional `refreshRef` is set to the client's `refresh()`,
    which every Mobile "Retry" calls.
  - `mobileClient.js` — main thread: ONE lazy worker per page (reused across wallet
    switches, terminated on unmount; one that never answered is replaced at the next
    due check), a check every 2 min while visible plus, for a fleet with WiFi
    Hotspots, a re-assemble every 30 s (the 60-min window slides), paused while
    hidden, a check on becoming visible if the last is > 2 min old. Stopping (a wallet
    switch, a cleared wallet, a fleet without Mobile Hotspots) posts `stop`, which
    cancels the check. Merges the worker's patch posts (a plain merge) and saves each
    finished check as the instant paint. `refresh()` checks now: a live worker gets one
    `refresh` post (a check already running answers it), while a worker that never
    answered, crashed or reported `error` is replaced and started again. `checkMobileOnce`
    is a one-shot check in a
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

`mobileFormat.js`: `aggregateMobile(hotspots, activity, now, prev)`, the **one
derivation per Mobile update** (like `aggregateIotStatus`). `rows` (Map entityKey →
verdicts; a row whose `sig` is unchanged keeps the `prev` row's object), with each
row's `days7` (the 7 reward days, oldest first, `{ day, hnt, bytes, state }`; a row
absent from an ok, keyed day earned a real 0, and a day the saved paint kept only
as a total is "loading", never 0) and `week` (`{ hnt, bytes, daysLoaded,
daysWithHnt, keyed }`). Per-issue `groups` and `counts`, plus the `noIssue` group
(WiFi rows passing `isWifiNoIssue`, the predicate the list's `mobileOk` filter
uses). Fleet `rewards` (with `firstDay`, the oldest of the 7 days) and `usage`
(with `coverage`, see the gotchas), `windows` (each sliding section's wording from
`windowText`, with its `until`), `issueText` (each issue worded for those windows),
`loaded` per table, `failed` per table (its check failed with no data in), and
`known` per issue (its count is real: its table is in, or it's a WiFi issue and the
fleet has no WiFi Hotspots). A field is null while its table hasn't loaded
(unknown, never "no"). Issues, most actionable first (`MOBILE_ISSUE_ORDER`, ranked
by `mobileActionRank` on the registry's `stateRank`): `banned` (latest ban row is a
ban; Serious), then the WiFi health signals (Check): `noHeartbeat` (none in the
heartbeat window), `lowTrust` (latest location trust < 1), `lowSpeedtest` (latest
24-h multiplier < 1), `rejectedHeartbeats` (any in the window). `MOBILE_ISSUES` is
static metadata: `wifi`, the `table` and `window` behind each issue, and `text(w)`,
which words its label, chip and hint for that window; the registry owns the tiers,
and surfaces take the wording from `issueText`. Also `isMobileHotspot` /
`isHeartbeatEligible` (the key rules in the gotchas), `nextWindowFlip` (the hook's
timer), and the formatters (`fmtLocationSource`, `fmtReason`, `fmtMbps`,
`fmtMeters`, `fmtMultiplier`, each with an `empty` word).

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
`mobileFreshness` turns this contract into the one freshness wording (see above).

## Gotchas

- **Never read Entity API `is_active`** — it is always `false`. "Ever rewarded" /
  "Never rewarded" (formerly Earning/Idle) is derived from rewards (zero lifetime ⇒
  never rewarded, Quiet tier, only once that row's rewards answered). See the repo
  memory note. IoT *connectivity* (Active/Inactive) and IoT *traffic* (30-day
  messages) are separate signals from api-iot (below) — they coexist: connectivity
  says "connected on the latest reported day", traffic says "delivered messages in
  the last 30 days", rewarded says "has ever earned".
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
  original deployment; every surface shows `ONBOARDED_NOTE` (`format.js`, re-exported
  by `copy.js`) saying so. For per-day earnings that's the right span anyway
  (lifetime is the Solana reward oracles' total). Every displayed onboard date is
  UTC (`fmtUtcDate`).
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
  *after* `dataThrough` hasn't been reported on yet ⇒ "Setting up" (Info), not
  "Inactive" (`iotStatusOf` in `format.js` owns this derivation, from the
  Hotspot's IoT onboard date, not its earliest network's). A not-active verdict
  stays pending (the row reads "Checking…") until that date lands (`awaitingDate`
  counts those rows, and while any is pending the resolved rows skew active), so
  the IoT figures are final only once no IoT row is pending: the shell's
  `iotStatusDone`, the list's `settled.iot` (and with it every "need a look"
  figure) and `iotStateRef`'s `done` all wait for it; `get-wallet-iot-status`'s own
  scan reads dates for just those rows. A 404 reads "Unknown" (`iotUnknown`) and a
  failed lookup "Couldn't check" (`iotFailed`), both Unknown tier, never mislabeled
  inactive.
- **Mobile-only Hotspots have no IoT status.** `hasIotStatus` leaves them out of
  the api-iot scan and `iotStatusOf` returns null; their row shows its Mobile
  states, and the Messages column and IoT counts skip them. A row with neither
  network's data reads "No status reported" (`noStatus`, Unknown tier: CBRS radios,
  which are `deviceType` cbrs or a Mobile-only `11…` key, and Hotspots on no
  network, which read "Unknown device"). A dual-network row whose ecc key never
  appears in the Mobile tables keeps its IoT state as the row state, adds the line
  "Mobile: No status reported" (not counted under `noStatus`) and reads "No daily
  HNT for IoT" in the day columns.
- **IoT traffic semantics.** The gateway record's `utilization` block counts
  *delivered LoRaWAN messages* (the service calls them uplinks) over the 30 data
  days ending its own `dataThrough` (a `YYYY-MM-DD` data day, a different field from
  the liveness anchor). Data-transfer rewards are based on them, but a count is NOT a
  reward amount, NOT DC, and NOT unique device messages — multi-buy counts one device
  message at every Hotspot that delivered it, so fleet sums are labelled "summed
  across your Hotspots" and Health's IoT module leads with a Hotspot COUNT. `iotTrafficOf`
  owns the states: `null` sent `no-store` ⇒ "unavailable" (transient; never cached
  client-side), `null` sent cacheable ⇒ "unpublished", `packets30d: 0` ⇒ a real zero.
  A scan mixing ok + unpublished rows counts the latter as unavailable.
- **Health** = connectivity × traffic (`iotHealthOf`, an `IOT_HEALTH` key; the
  registry owns its tier and wording): "Inactive, had traffic" (Serious, the most
  actionable), "Active, no traffic" (Check), "Inactive, no traffic" (Check),
  "Active, had traffic" (OK, in ink, never green: a 30-day total can't confirm
  traffic is still flowing; the detail's daily chart can). An active or inactive
  row whose traffic isn't known reads bare "Active" (OK) or "Inactive" (Check).
  "Inactive, no traffic" and bare "Inactive" counting toward "need a look" is an
  owner decision. "Active, had traffic", never "Active · with traffic".
- **"Need a look"** is Serious + Check, across both networks, counted once per
  Hotspot (`counts.needs`, null until `settled.verdicts`). `settled.verdicts` waits
  on rewards, IoT (with its onboard-date hold) and Mobile, never on the onboard-date
  scan, which takes minutes on a 2,172-Hotspot fleet with 429 waits. A row whose
  sources are still pending reads "Checking…" unless it already has a Serious or
  Check state (never OK early).
- **"No rewarded data" (`noRewardedData`, Check)** applies only to a Mobile
  Hotspot (on the Mobile tables) with all 7 reward days ok and keyed, 0 HNT and 0
  bytes on each, and lifetime HNT above 0 (rewards answered), which already proves
  it earned before the window. A Mobile onboard date on or after the window's first
  day withholds it; a date still loading never holds it. Never from a trimmed paint
  (large fleets: per-Hotspot days read "…" until the live check). Worded "No
  rewarded data", never "no HNT". Health shows it as a note under the Mobile module,
  outside the WiFi tier bar, so Summary's count and Health agree.
- **No false zeros; empty values are words.** A value not known yet is "…"
  (`ui/Pending`, read as "Loading" or "Checking"), a failed one "Couldn't load",
  an unpublished one "No data", "Not reported" or "Unavailable"; never 0 and never
  a dash glyph. Totals over partial data say "so far" with a denominator. A lifetime
  whose unclaimed part couldn't be confirmed (`no_oracle_response`) is a lower
  bound ("≥ …", "At least …"). In the CSV unknown numbers are blank.
- **Stable order.** Rows never move while data fills in (`useHotspotOrder`): fleets
  of 50 or fewer wait up to 2 s for the sort's data and paint sorted; otherwise rows
  stay in name order with "Unclaimed: 150 of 1,659 Hotspots checked. Rows sort when
  it finishes." and Sort now. A finished scan re-sorts only when focus is outside
  the list and the detail ("Order is out of date. Sort now" otherwise). Every sort
  but Name and Status breaks ties on 7 days, then Lifetime, so rows sorted before
  the Mobile check and the rewards scan are both in sort again by the same rule
  when they are (a cold first load sorts by Unclaimed before the 7-day figures
  arrive); until then the order is never called out of date. A row that
  stops matching the filter stays with "No longer matches" until the next user
  action (a filter, search or sort change, Sort now, paging).
- **Paging, not virtualization**, so tab order and find-in-page work over the
  rendered rows (search, chips, CSV and totals cover every row). "Show all" renders
  the rest 100 rows per frame (each step waits for the frame that paints the last),
  and table rows are `position: relative`, so each row is its own paint layer and a
  hover or a new page repaints only those rows. Keep both if rows are restyled: on a
  2,172-row fleet they keep "Show all" under a 100 ms long task.
- **Retry re-requests only what failed.** `retryFailed` (rewards, IoT) and the
  Mobile `refresh()` never reload what loaded: the worker allows about 30
  `/wallet-dashboard` requests per 60 s per IP, nycg alone is 44 reward batches, and
  transactions are uncached. Cells that loaded never return to "…", the order isn't
  reset, and Summary never drops back to scanning.
- **Retry keeps focus nearby.** A Retry usually disappears while its retry runs,
  so the shell's `ui/useRetryFocus.js` watches a pressed one: once it's gone with
  nothing focused, its nearest remaining container takes focus (a temporary
  `tabindex="-1"`), and a Retry with the same name that comes back there (the retry
  failed again) gets focus back. It finds Retries by `button[aria-label^="Retry"]`,
  so every Retry's accessible name starts with "Retry". The outcome is said
  politely where it would otherwise be silent: Summary's status for a rewards Retry
  ("Rewards couldn't be checked for 10 Hotspots."), About's for onboard dates.
- **Per-wallet resets without re-keying.** Moving from one wallet to another keeps
  the same component instances (the `.wd-zone` entrance must not replay): each
  section resets its own per-wallet state with `useResetOnChange`, and the shell
  resets `mapSelect`, the opener memory and row reuse (`prev`). Sections a wallet
  owns (the Health modules, the Earnings chart) are keyed by wallet inside the
  section instead.
- **Section props the shell must pass.** A section treats a missing optional prop
  as "not available" (no Retry, no caption) rather than failing, so a prop a
  section documents but the shell forgets fails quietly. When adding a prop, wire it
  in `WalletDashboard.jsx` in the same change.
- **Browser cache.** Edge HITs come back `max-age=14400, stale-while-revalidate=86400`
  (misses `max-age=60`), so a returning visitor's browser can hold records ~a day
  old. Health shows day RANGES (`livenessRange` / `trafficRange`) when rows disagree,
  and each row's window names its own day, rather than forcing revalidation.
- **Completeness is not guaranteed.** The service's 28-of-30-days publish gate can be
  forced past, so `daysComplete < 30` happens: totals are then lower bounds. The
  gateway block doesn't say; the index (`/v1/iot/utilization`) does, and its
  `missingDays` are applied only when its `dataThrough` equals the rows' — a missing
  day is drawn as "no data", never 0. Detail `daily[]` rows are sparse (zero-filled
  client-side in `deriveTrafficDetail`).
- **Per-OUI chart colors** follow the OUI's rank within that Hotspot (5 categorical
  slots, the `--wd-oui-1..5` tokens, rest folded into `--wd-oui-other` gray; the
  slots avoid the dashboard's IoT green, Mobile violet and status colors). Some
  slots are < 3:1 on white in light mode, so the per-OUI table with numbers is the
  chart's required table view — don't remove it.
- **Modeled coverage** (the map panel's toggle and the detail's Location section,
  for an ACTIVE IoT Hotspot with a service `hex` only — inactive Hotspots are never
  modeled and return `[]`) is a model, not a measurement: always show the terrain
  attribution, never km² / overlap figures. Cells below −130 dBm are dropped (model
  v3's median cell is ~−131). A footprint whose cells don't include the Hotspot's
  own res-8 parent is from a previous assertion (rebuilt nightly). Fleet-row `gain`
  is tenths of a dBi.
- **Service access risk.** helium-iot-service has a deferred CORS lockdown
  (`ALLOWED_ORIGINS`, see its CLAUDE.md "Deferred: CORS lockdown") whose planned list
  does not include `https://heliumtools.org`; enabling it as written would break every
  IoT surface here (the existing status scan included). `/v1/gateways*` may also
  start enforcing `x-api-key`. Either change needs a coordinated update on the service.
- **Map sizes are in pixels** (`sizeUnits` / `radiusUnits` / `widthUnits: "pixels"`).
  deck's default is meters, which clamped every dot to `radiusMinPixels` before
  2026-10.
- **WebGL contexts.** `FleetMap` (DeckGL over react-map-gl's `MapGL`) is 2
  contexts; the detail's `LocationMap`, the loupe and the phone preview are
  MapLibre only, 1 each. Budget: desktop aside with a detail open 4, drawer or full
  screen 3 (the loupe unmounts), phones at most 2 (the preview unmounts while the map
  dialog is open; "Show on map" closes the detail first). On unmount `FleetMap`
  loses its deck context explicitly (`WEBGL_lose_context`), since a detached deck
  canvas otherwise keeps it until the browser starts dropping old contexts. Dev
  builds log a luma.gl `maxTextureDimension2D` TypeError on resize under React
  StrictMode (the Hotspot Map does too); production builds don't.
- **Landing capture hooks.** The capture script relies on `data-wd-settled`,
  `data-wd-section`, `data-wd-card`, `data-wd-col`, `canvas#deckgl-overlay` with a
  controlled `viewState`, and the dev-only `window.__wdMap`. Keep them (see
  "Landing preview").
- The reward fan-out runs client-side with bounded concurrency, in batches of 50
  to the cached `/rewards` endpoint. Because rewards distribute ~daily, results are
  KV-cached (~15 min) and the endpoint is cache-first, so reloads are free and don't
  trip the rate limit. (Each `/rewards` batch of 50 stays well under the worker
  subrequest cap — one full server-side fan-out of a large fleet would not.)
  Per-Hotspot Unclaimed can therefore lag a claim by ~15 min; no row promises
  claimability (the claimer stays the authority).
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
  heartbeats are WiFi health signals: the UI and agent tool present them that way
  (Check tier, hints saying data-transfer HNT doesn't use them), never as lost
  earnings. Only a ban is Serious.
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
  check" on the Data status chip and Health; the saved paint still shows) and there is
  no Worker fallback. Any change there needs a coordinated update here.
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

The /wallet-dashboard page registers 10 agent tools from
`pages/public/src/wallet-dashboard/webmcpTools.js`, in catalog order:
`open-wallet-dashboard`, `get-wallet-hotspots`, `get-wallet-summary`,
`get-wallet-fleet`, `get-wallet-rewards`, `get-wallet-onboarding`,
`get-wallet-iot-status`, `get-iot-hotspot-traffic`, `get-wallet-mobile-activity`
and `get-wallet-transactions`. The factory is
`makeWalletDashboardTools(navigate, getWallet, getIotState, getMobileState,
getListState)`; the shell's refs feed it (`getListState()` is
`{ wallet, list, settled, onboardFailed, onboardRetrying }`, set only once the
fleet on screen is this wallet's).
Framework + conventions: `pages/public/src/webmcp/CLAUDE.md`.

- **`open-wallet-dashboard`** navigates like a user. Params: `address` (required,
  Solana base58), and optional `hotspot` (an asset ID, or the entity key only for a
  Hotspot without one; base58, 20 to 500 characters), `status` (every registry state
  key including `checking`, plus `needs`, `ok`, `mobileOk`; its description lists
  each with its chip label by tier), `network` (`all` / `iot` / `mobile`, the URL's
  `net`), `device` (a `DEVICE_LABEL` key or `unknown`), `sort` (every `SORTS` key,
  bare or `.asc` / `.desc`), `q` (≤ 100 characters) and `month` (`YYYY-MM`). It
  builds `/wallet-dashboard/<address>` with urlState's `dashboardSearch`, leaving
  defaults out. **A `status` without a `sort` also sets `sort=status`**, as every
  status link on the page does. With that wallet on screen and its list loaded, a
  `validate` hook rejects a Hotspot not in the fleet; an entity key of a Hotspot
  with an asset ID opens it by its asset ID; a network filter (the wallet isn't on
  both networks) or a device type the wallet lacks is left out and named as
  ignored. Same wallet with a Hotspot: it pushes the list view, then the detail with
  `{ wdDetail: true }`, so Back closes the detail. Another wallet with a Hotspot:
  one navigation, and the page inserts the list entry below the deep link once the
  fleet loads. Either way the detail takes focus once it renders, as one the viewer
  opens does (the shell wraps the tools' `navigate` to note the `hotspot` asked
  for; in the aside the list scrolls into view first), so Escape closes it. The result text says what was opened ("The Hotspot list shows 5 of 10
  Hotspots: Needs a look. Sorted Status, needs a look first."), the sort (for
  another wallet, the page's default unless this browser remembers another), the
  open Hotspot (or that the page drops it once the list loads if it isn't in the
  wallet), any ignored filters, and points at `get-wallet-hotspots`. For a wallet
  not on screen (its list not loaded) it names the filters it opened with and says
  the page keeps a network filter only for a wallet on both networks and a device
  filter only for a device type the wallet has. A wallet it
  opens is recorded in Recent wallets once its summary loads; the get-* tools never
  touch the list.
- **`get-wallet-hotspots`** (read-only) reads the page's own `aggregateHotspotList`
  through `getListState()`, with `filterRows`, `orderRows`, `sumRows`, the registry,
  `deriveFleetPlaces` and `mobileFreshness`, so agent and page orders match. Params:
  `address` (defaults to the wallet on screen), `status`, `network`, `device`, `q`,
  `month`, `sort` (as above; a `status` without a `sort` sorts by Status) and `limit`
  (1 to 200, default 50). **Only for the wallet on screen**: otherwise it throws
  ("…open it with open-wallet-dashboard first, then call again"); it never navigates
  and never starts the page's scans. It waits up to 45 s (polling every 500 ms) for
  `settled.all` with no row still checking, returns at once when only a paused
  (hidden-tab) Mobile check is left, and throws when the page's fleet failed
  (pointing at Retry and `get-wallet-fleet`), when the list hasn't loaded after 45 s,
  or when the page switches wallets meanwhile. Output: `wallet`; `settled`
  (`rewards`, `iot`, `mobile`, `verdicts`, `onboardDates`, `all`); `checks` per
  source (`rewards`: state checking / retrying / done with `failed` and
  `unconfirmed`; `iot`: with `failed` and `notFound`; `mobile`: checking / paused /
  done with `freshness`; `onboardDates`: checking / retrying / done with `failed`,
  the Hotspots whose onboard-date lookup failed; `iot` and `mobile` null when the
  wallet has none); `counts` (`total`, `needsALook` null until `settled.verdicts`, `byTier`,
  `byState` over every status filter value, `networks`, `mobile` WiFi vs data-only,
  `devices`, `unlisted`); `totals` (Hotspots only: unclaimed, latest day, 7 days,
  lifetime with its lower bound, 30-day messages, each with how many Hotspots it
  sums: `unclaimedKnown`, `latestDayKnown`, `weekKnown`, `lifetimeKnown`,
  `messagesKnown`; a total over none is null, never 0, and `lifetimeLowerBound` is
  also true while any Hotspot's lifetime isn't known; Summary's Unclaimed also adds
  veHNT; from `sumRows`' counters); `windows` (IoT connectivity day and traffic end, the rewards days, each
  sliding Mobile window with its end and whether it's current); `places` (caption,
  up to 10 sites, region, unasserted); `shown` (count, filter and sort labels,
  filtered totals); `groups` (`orderRows`' labelled groups); `hotspots`; `truncated`;
  and `notes` (tiers, "need a look" = Serious + Check, states vs verdicts, windows,
  null is never 0, Hotspots-only totals, the order (the computed one; the page can
  show an older order with "Order is out of date" until the viewer sorts), plus
  conditional notes for unsettled, paused, retrying, failed with Retry (rewards,
  IoT, onboard dates), unlisted, ignored filters and freshness). Its description
  gives the size: about 1 KB a row (a Mobile WiFi row's entity key alone is 366
  characters), about 210 KB at `limit` 200.
  Each Hotspot row: `name`, `entityKey`, `assetId`, `networks`, `deviceType`,
  `deviceLabel`, `place`, `tier`, `needsALook`, `checking`, `states` (`key`, `tier`,
  `label`, `window`, `detail`, `at`), `verdicts`, `note`, `unclaimedHnt`,
  `rewardsState`, `claimable`, `claimReason`, `claimDestination`, `lifetimeHnt`,
  `lifetimeLowerBound`, `neverRewarded`, legacy amounts when above zero, either
  `noDailyHnt` (iot / cbrs / none) or `latestDayHnt`, `hnt7d`, `daysWithHnt`
  (`hntDaysLoaded` when only part of the week loaded), `messages30d` and
  `messagesState` (IoT rows), and `onboardedAt`. Its `checks` block is how an agent
  sees the failed-only Retry.
- **`get-wallet-summary`**: `/summary` as is; its total is the Wallet value (token
  balances only). `/summary` and `/fleet` carry no onboard dates, and their
  descriptions point at `get-wallet-onboarding`.
- **`get-wallet-fleet`**: `/fleet`, capped at 200 rows.
- **`get-wallet-rewards`**: fleet-wide pending totals (HNT first, legacy tokens
  apart) via the cached `/rewards` batches; it shares `useFleetRewards`' exported
  `eligibleRewardHotspots` / `REWARDS_BATCH_SIZE` so batches stay cache-stable;
  capped at 100 Hotspots. Its description notes the ~15-minute cache lag and points
  at `get-wallet-hotspots` for per-Hotspot statuses and lifetime HNT.
- **`get-wallet-onboarding`**: on-chain onboard dates, first and latest, `byMonth`
  zero-filled from the first to the last month (each `{ month, count, iot, mobile }`,
  a dual-network Hotspot once, under its earlier network) and per-Hotspot dates. New
  `source`: `"dashboard"` (the page's dates for the whole fleet once all are in; the
  per-Hotspot list capped at 200 with `truncated`, and `failedLookups` when some
  of the page's lookups failed: those read null, and About's Retry re-reads only
  them) or `"lookup"` (its own `scanOnboardDates` run with no 429 waits, up to 200
  Hotspots, with `failedBatches`).
- **`get-wallet-iot-status`**: per-IoT-Hotspot connectivity, 30-day messages and
  health. Rows carry `state` (the registry key: a health key, or `active`,
  `inactive`, `settingUp`, `iotUnknown`, `iotFailed`, `checking`), `tier` and
  `healthLabel` ("Inactive, no traffic", "Couldn't check"); `counts` adds `failed`,
  `notFound` and `needsALook` (IoT rows at Serious or Check). The description lists
  the tiers (`inactiveQuiet` and `inactive` are Check). It reads the page's finished
  scan for the wallet on screen (no per-Hotspot requests, only the 5-min-memoized
  utilization index); otherwise, or while the page re-checks failed lookups, it scans
  up to 200 IoT Hotspots itself. A note says Retry re-checks only failed lookups.
  Order is unchanged (`iotActionRank`).
- **`get-iot-hotspot-traffic`**: one Hotspot's daily messages per OUI with
  well-known names; it answers a known zero from the gateway record without a detail
  request.
- **`get-wallet-mobile-activity`**: the Mobile picture from `aggregateMobile`:
  latest-day and 7-day data-transfer HNT with the rewarded bytes it paid for, users
  served with the usage report's coverage, issue counts over every Mobile Hotspot
  (null while a count's table isn't in, never 0), each table's state with its
  `checkedAt` / `okAt` / `error`, each sliding window's end and whether it's current
  (a frozen one is named by its end), notes saying which sections are the saved paint
  (`cachedSections`, dated by `cachedAt` or the section's own `tables[name].until`)
  or a failed table's last good check, and per-Hotspot rows most actionable first
  (`mobileActionRank`), filterable by `issue` (still `MOBILE_ISSUE_ORDER`), 50 by
  default and at most 200. Rows add `tier` (the most serious issue's; ok when every
  health table answered with none; checking or unknown otherwise), `hnt7d`,
  `daysWithHnt` (null while only daily totals are known) and `hntDays` (7 entries
  `{ day, state, hnt, rewardedBytes }`, newest first). Windows and null counts come
  from the aggregate's `windows` and `known`; the description says `noRewardedData`
  is a cross-source Check state that lives in `get-wallet-hotspots`. When the wallet
  is on screen it reads the page's state and aggregate through `getMobileState`
  (adding `freshness` from `mobileFreshness`), waiting up to 45 s for the hook's
  `checked` (on a visible page, also not `stale`; at once if the worker failed), so
  nothing is downloaded twice, except when that tab is hidden (`paused`) with its last
  check older than `FRESH_MS` (hidden tabs don't poll) or the page's fleet failed
  (`{ wallet, fleetError }`, no wait); otherwise it fetches the fleet and runs one
  check with `checkMobileOnce`, its own short-lived worker over the same engine and
  caches, with a 60 s limit after which it returns what it has (per wallet, a running
  off-screen call, fleet fetch included, is shared and a finished one reused for 30 s
  after it finishes); its description states that check's byte cost, and the
  size of a full list (about 1.3 KB a row). When the wallet's fleet can't be
  loaded it says so ("couldn't load this wallet's Hotspot list …", naming the
  page's own failure and its Retry when the wallet is on screen) rather than a bare
  network error, and a failed check with nothing kept from before says the
  dashboard has no Mobile data for the wallet yet.
- **`get-wallet-transactions`**: categorized recent transactions.

UI-only, intentionally not exposed: the map's Color by mode, map selection and the
loupe, arrival motion, the coverage footprint (a model for visual context), Recent
wallets (this browser's lookup history, not wallet data) and the list's stable-order
"Sort now" state (the agent always gets the computed order, so once the figures
change under rows the viewer is reading, such as a live Mobile arrival, the page's
rows can differ until the viewer sorts). Money figures from `deriveMoney`
(Summary's Wallet value, Unclaimed with veHNT, Earned in USD) aren't reachable from
the tools: `get-wallet-summary` returns the raw `/summary`, and
`get-wallet-hotspots`' totals are Hotspots only. Agent-facing strings in this file
carry no em dashes.

## Landing preview

The `/` card (`pages/public/src/pages/landing/previews/wallet-dashboard.js`) lays the Wallet value ticket in front of the lower-left corner of the Earnings sheet:

- **The ticket (the anchor):** the Summary money band's first column, `summary/MoneyBand.jsx` `data-wd-col="value"`. It shows the "Wallet value" eyebrow, the 52 px USD figure, the token split bar and its HNT, SOL, DC and legacy MOBILE legend.
- **The sheet:** `earnings/DailyHntCard.jsx`, "HNT per day". It shows the latest UTC day's readout over the 7 day bars of `ui/DayBars.jsx`, down to the axis labels.

The card is featured (two columns wide on desktop). Its wide stage adds the Map section's fleet map on the left: `FleetMap.jsx` with the `map/SiteMarkers.jsx` site groups and their need-a-look counts, Color by Network, on the Carto basemap from `map/basemap.js`, framed from Milwaukee to Washington. The ticket runs across it and the Earnings sheet sits on the right.

`scripts/tool-previews/capture/wallet-dashboard.mjs` opens `/wallet-dashboard/<wallet>` by URL, with no wallet connect and no mocks. Every phase waits for the page to settle and fails the run (exit 1, no manifest) when it doesn't, so a half-loaded page never becomes a source capture. Its phases:

- **`nyc` (the nycgFa… wallet, 2,172 Mobile data-only Hotspots):** the Summary at a 1440 layout gives `hero.png`, the source of the Wallet value ticket (and `viewport.png`). It waits for whole rewards figures too: no Hotspot whose rewards couldn't be checked or confirmed, no lower-bound Lifetime (`ALLOW_PARTIAL=1` skips that).
- **`large` (the 9Zye… wallet):**
  - At 1440, the map card gives `fleet-map.png`. The camera is set to the Great Lakes to East Coast band at zoom 5.02 or more, inside the part of the map right of the legend.
  - The Earnings card at a 480 px layout gives `mobile-activity.png`.
  - The onboarding timeline and a dpr-3 macro of the readout are spare shots.
- **`main` (BMJi…, `?hotspot=4TEDfAAeFwXaitY12hE7nfJAuoWGTiDq9KgpC4ShQabZ`):** the map panel's "Modeled coverage" footprint (spare).

The script relies on these hooks; keep them:

- `.wd-root[data-wd-settled]`
- the data status chip (`[data-wd-card="identity"] button[aria-haspopup="dialog"]`) reading "Live" (or "All sources loaded", its words for a fleet with no Mobile check)
- `[data-wd-section=…]`
- `[data-wd-card="identity|earnings-chart|map|onboarding-timeline"]`
- `[data-wd-col="value|unclaimed|earned|lifetime"]`
- `canvas#deckgl-overlay` with a controlled `viewState`, and dev builds' `window.__wdMap.getView()/setView()`
- `[data-map-panel]` and its "Modeled coverage" button
- the legend's place: `map/MapLegend.jsx`, 14 px from the left and 262 px wide (the script's `LEGEND_RIGHT`)
- site groups merging by whole zoom: `map/useSiteClusters.js` (the script's `SITE_ZOOM`)

Capture from the dev server (run `npm install` in `pages/public` first, for the Mobile engine's deps), so that `window.__wdMap` exists. A production build has no such hook, and the script's fallback to deck's wheel zoom and drag is best effort.

Re-capture and re-bake when any of these change:

- the Wallet value column (eyebrow, figure size, split bar, legend)
- the money band's four-column layout at 1440 (the crop is its first column)
- the "HNT per day" card (title, readout, DayBars, its layout below md)
- the site markers, map legend, basemap or the Color by default
- the dashboard tokens and fonts (`wallet-dashboard.css`, Space Grotesk)
- any hook above

See `pages/public/src/pages/landing/CLAUDE.md`.
