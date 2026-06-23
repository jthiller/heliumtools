# Multi-Gateway

Frontend dashboard that lists gateways and renders a per-gateway packet
inspector — an RSSI-over-time scatter chart, a spectrum waterfall, an events bar
(joins/downlinks), and a packet table, all driven by an SSE feed fanned out
through a Durable Object. It also builds the on-chain issue and onboard
transactions (`handlers/issue.js`) to register a gateway to a Solana wallet.

Packet data comes from an upstream LoRaWAN aggregator host (default
`hotspot.heliumtools.org`, `lib/host.js`); see "Upstream / Fork". This is the
only consumer of the issue/onboard instruction builders in
`worker/src/lib/helium-solana.js`, and the only tool in the repo backed by a
Durable Object.

## Upstream / Fork

The packet data comes from a **self-hosted instance of an open-source LoRaWAN
aggregator**, not from heliumtools-owned code. The deployment runs a fork:

- **Upstream**: [`helium/multi-gateway`](https://github.com/helium/multi-gateway).
  Per its README: "A multi-gateway aggregator for the Helium LoRaWAN network. It
  accepts connections from multiple LoRaWAN gateways via the Semtech UDP protocol,
  manages per-gateway keypairs, and routes packets to the Helium packet router
  over gRPC." Written in Rust. Its README documents a REST API (`GET /gateways`,
  `GET /gateways/{mac}`, `POST /gateways/{mac}/sign`, `GET /metrics`) with optional
  `X-API-Key` auth (separate read/write keys) and states one region runs per
  instance. The README does not document an SSE/events stream.
- **Fork (what this deployment runs)**:
  [`jthiller/multi-gateway`](https://github.com/jthiller/multi-gateway), a fork of
  the above; its README documents the same endpoints and does not state what was
  changed. The frontend footer links upstream as "Built on helium/multi-gateway"
  and the fork as "Source" (`MultiGateway.jsx`).

### What the worker actually calls

The worker injects `X-API-Key` (from `env.MULTI_GATEWAY_API_KEY`) on every
upstream call and does not forward it to clients:
- `GET /gateways` and `GET /gateways/:mac` (`index.js`, `lib/findGateway.js`)
- `GET /gateways/:mac/packets` (`index.js`) — initial backfill the chart paints
  before the live stream takes over
- the per-region `/events` SSE stream (`hub.js`) — `data:` envelopes of the form
  `{ type: "uplink" | "downlink" | "gateway_connect" | "gateway_disconnect", ... }`;
  for uplink/downlink the client spreads `data.metadata` into the packet
  (`packetWorker.js`), reading `rssi`, `spreading_factor`, `dev_addr`, `fcnt`,
  `frame_type`, `frequency`, `timestamp`
- `POST /gateways/:mac/add` (`handlers/issue.js`, with the write key) — the
  response is parsed for `unsigned_msg` + `gateway_signature`

`/events`, `/gateways/:mac/packets`, and `/gateways/:mac/add` are not in the
upstream README's endpoint list. Code comments in `hub.js` / `index.js` state the
upstream caps each region at `MAX_SSE_CONNECTIONS=20`; that is the in-code
rationale for the Durable Object fan-out below (the cap lives in the upstream, not
in this repo).

### Region / port map

`regions.js` maps six regions to distinct ports on one host (the upstream runs one
region per instance, so each port is a separate instance):

| Region   | Port |
|----------|------|
| US915    | 4468 |
| EU868    | 4469 |
| AU915    | 4470 |
| AS923_1  | 4471 |
| KR920    | 4472 |
| IN865    | 4473 |

`lib/host.js` resolves the host (`MULTI_GATEWAY_HOST` env override, default
`hotspot.heliumtools.org`). All region calls fan out in parallel and merge
(`/gateways` sums; `findGateway` / `/packets` returns the first region that has
the mac). Region calls use plain `http://` (`index.js`, `lib/findGateway.js`,
`hub.js`).

## Architecture

### Worker (API) — prefix `/multi-gateway`

Entry point: `index.js` (prefix-routed from `worker/src/index.js`). All requests
require `MULTI_GATEWAY_API_KEY`; the worker injects it as `X-API-Key` on every
upstream call and never forwards it to clients.

**Endpoints:**
- `GET /gateways` — fan out to all regions, concat `gateways[]`, sum
  `total`/`connected`.
- `GET /gateways/:mac/packets` — 16-hex-char mac; first region with the gateway
  wins, else 404. Initial backfill the chart paints before SSE takes over.
- `GET /events` — **WebSocket** upgrade (not raw SSE). Forwarded to the
  `MultiGatewayHub` Durable Object's `/ws` path. See "Durable Object" below.
- `POST /onchain { pubkeys: string[] }` — batch (≤50) on-chain status. For each
  gateway pubkey derives `keyToAsset` + `iotInfo` PDAs and reports
  `{ onchain, iot_onboarded, has_location }`. `has_location` reads byte 41 of the
  IotInfo account (the location Option discriminant). Uses `fetchAccount` from
  the **hotspot-claimer** tool (`../hotspot-claimer/services/common.js`).
- `POST /gateways/:mac/issue { owner }` — build the issue transaction (see
  On-Chain flow). Returns `already_issued` if the keyToAsset PDA already exists.
- `POST /gateways/:mac/onboard { owner, location, elevation, gain }` — build the
  onboard transaction. `location` is an H3 res-12 cell hex string; `gain` is dBi
  × 10; `elevation` is meters. Returns `already_onboarded` if IotInfo exists.
- `GET /ouis` — Helium OUI → DevAddr-range catalog (KV cached, see `oui-cache.js`).
  Lets the table label which operator a DevAddr belongs to.

**Cron:** `oui-cache.js` `refreshOuiCache` runs once daily at 00:00 UTC
(scheduled in `worker/src/index.js`).

**Files:**
- `index.js` — prefix router + `/gateways` and `/packets` fan-out (`fetchUpstream`
  parses JSON, treats non-JSON as an error).
- `hub.js` — the `MultiGatewayHub` Durable Object (see below).
- `regions.js` — the region→port table above (single source of truth).
- `oui-cache.js` — calls the Helium IoT config service over **gRPC-web**
  (hand-rolled varint + gRPC framing, no protobuf lib) to list OUIs and their
  DevAddr constraints, merges human names from the `helium/well-known`
  `ouis.json` list, caches in KV (`oui-devaddr-map`, 24h TTL). Note: gRPC-web
  needs HTTP/2 and **fails in `wrangler dev`** (Miniflare is HTTP/1.1) — works in
  production where Cloudflare negotiates HTTP/2.
- `lib/host.js` — upstream host resolver.
- `lib/findGateway.js` — parallel per-region `GET /gateways/:mac` probe; returns
  `{ port, data }` of the first hit. Used by issue/onboard to locate the gateway
  and read its `public_key`.
- `handlers/onchain.js` — batch on-chain status (above).
- `handlers/issue.js` — issue + onboard transaction builders (below).

### Durable Object: `MultiGatewayHub` (`hub.js`)

One DO instance globally (addressed by the fixed name `"hub"`) holds **at most
one upstream SSE per region** and fans every event out to all connected browser
WebSockets. Without it, each browser tab opened 6 outbound SSE fetches (one per
region) and ~4 dashboards saturated the fork's per-region cap of 20.

- **Bindings/migration**: `MULTI_GATEWAY_HUB` binding + `new_sqlite_classes`
  migration in `worker/wrangler.jsonc` (declared in both top-level and
  `env.production`); re-exported from `worker/src/index.js`.
- **Wire protocol (client ↔ DO)**: client connects to `/multi-gateway/events`
  (upgraded to `/ws`). The DO re-emits each upstream SSE `data:` payload verbatim
  as one WS text frame (`{type:"uplink"|"downlink"|"gateway_connect"|...}`), plus
  `{type:"sse_status", status:"connected"|"unavailable"}` health frames. The
  client treats the WS as an EventSource-shaped object (`SseLikeSocket` in
  `pages/public/src/lib/multiGatewayApi.js`) so the worker change was invisible to
  the rest of the client.
- **Hibernation model**: client sockets use the WebSocket Hibernation API
  (`acceptWebSocket`), so Cloudflare may evict the DO while sockets stay attached.
  On wake the constructor re-inits empty `upstreams`/`lastBroadcastStatus` Maps;
  `setTimeout` handles are lost but `storage.setAlarm` survives. Every wake
  signal (`webSocketMessage/Close/Error`, `alarm`, inbound fetch) re-calls
  `ensureUpstreams()` so any client activity heals the DO.
- **Alarm heartbeat**: `armHeartbeat()` sets an alarm `ALARM_HEARTBEAT_MS=15000`
  out while subscribers exist; `alarm()` re-ensures upstreams (retrying any region
  that died on an upstream bounce/EOF). With no subscribers, `armTeardown()` sets a
  short `IDLE_TEARDOWN_MS=2000` alarm and `alarm()` then closes all upstreams to
  free the per-region cap slot. A quick reconnect during nav pushes the alarm back
  out so upstreams stay warm.
- **Subscriber accounting** is `state.getWebSockets().length` — no persisted
  subscriber state.
- `broadcastStatusIfChanged()` surfaces "connected" once any region is open and
  "unavailable" only when every region is down. On "unavailable" the client keeps
  the WebSocket open and clears its stale-reconnect watchdog (`packetWorker.js`),
  relying on the DO's heartbeat to push a "connected" frame when a region recovers
  — it does not close the socket or back off.

### Frontend (`pages/public/src/multi-gateway/`)

`MultiGateway.jsx` is the shell: gateway list, inspector card, on-chain
onboarding wizard, fleet map (deck.gl/MapLibre), and the upstream/fork footer
links. It's `memo`'d so the 1Hz `nowTick` heartbeat doesn't re-render the whole
tree.

- `packetWorkerClient.js` — main-thread API for the packet Web Worker.
  Request/response calls (`subscribePackets`/`unsubscribePackets`) are matched by
  `requestId`; broadcasts (`subscribed_packet`, `cached_packets`, `sse_uplink`,
  `gateway_connect`, …) go to every `onWorkerEvent` listener. The worker is
  spawned lazily and lives for the page lifetime.
- `packetWorker.js` — the Web Worker that owns the **entire ingest pipeline** off
  the main thread: the SSE/WebSocket EventSource, one `segmentation.js` segmenter
  per subscribed mac, and the IDB cache. A backgrounded tab still absorbs SSE,
  segmentation never jams the UI, and reload hydrates from IDB before the network
  fetch lands. Handles its own reconnect (EventSource gives up after a non-2xx;
  mobile tab suspension can silently stall it — `reconnectSse` rebuilds; a
  `STALE_RECONNECT_MS=15000` watchdog covers stuck states).
- `packetCache.js` — IndexedDB cache (one record per mac, ≤500 packets), run
  inside the worker. On subscribe it emits `cached_packets` before the fetch
  resolves so the chart paints instantly, then the authoritative batch overwrites
  it. Every IDB op is bounded by `IDB_TIMEOUT_MS=1000` because Safari has a
  long-standing bug where IDB transactions inside a Worker stall silently — the
  cache is best-effort, never load-bearing.
- `segmentation.js` — pure module (no React) that groups uplinks into **tracks**
  approximating individual physical devices (below).
- `airtime.js` — LoRa time-on-air per Semtech AN1200.13 (mirrors
  avbentem/airtime-calculator); pure visualization, no duty-cycle enforcement.
  Parses Helium's `SF10BW125`-style `spreading_factor` field.
- `filters.js` — single `packetMatchesFilters(pkt, {visibleTypes, netIdFilter,
  trackFilter})` predicate shared by the scatter, spectrum, and table so all three
  gate the stream identically.
- `PacketScatter.jsx` — hand-rolled `<canvas>` RSSI-over-time scatter (below).
  Exports `PLOT_RIGHT`, `plotLeftFor(width)`, `PULSE_DURATION_MS`,
  `formatTimeTick`, `colorForNetIdShade`, `ColoredSelect`, `swatchColorForNetId`.
- `EventsBar.jsx` — SVG bar of joins (violet) / downlinks (sky) that aren't
  track-correlatable. **Imports `plotLeftFor`, `PLOT_RIGHT`, `PULSE_DURATION_MS`,
  `formatTimeTick` from `PacketScatter.jsx`** and takes the same `xDomain` prop, so
  its time axis lines up to the pixel with the scatter above it.
- `SpectrumChart.jsx` — SVG waterfall: X = frequency (MHz, packets drawn at
  `[freq − bw/2, freq + bw/2]` so a 500 kHz tx physically overlaps neighboring 125
  kHz channels), Y = wall-clock time, newest at bottom. X axis is piecewise:
  widely-separated bands (e.g. US915 uplinks ~902–915 vs downlinks ~923–928) get a
  fixed-width visual break (`CLUSTER_GAP_MHZ=5`). RSSI maps to opacity.
- `SolanaProvider.jsx` — wallet-adapter (`Phantom`, `Solflare`) + `ConnectionProvider`
  for the on-chain onboarding steps. RPC URL from `VITE_SOLANA_URL`.

All three time-series surfaces (scatter, events bar, table) share one `hover`
state so hovering a dot highlights the matching table row and event marker.
Sibling components rendered per-mac use unique keys (`scatter-${mac}`,
`events-${mac}`) to avoid leaking old DOM on Hotspot switch.

## Key Concepts

### Client-side segmentation (`segmentation.js`)
Two devices can share a DevAddr, so identity is inferred from **frame-counter
(fcnt) continuity**, not DevAddr alone:
- `FCNT_GAP_MAX=64` — max forward fcnt jump to stay on the same track; wrap near
  the 16-bit top is accepted within `FCNT_WRAP_WINDOW=16`.
- RSSI is a **tie-breaker only** — a candidate is rejected outright if it differs
  by more than `RSSI_HARD_LIMIT_DBM=15` from the track mean; otherwise it nudges
  the score by `RSSI_WEIGHT=0.1` (10 dB ≈ one fcnt slot).
- `DUP_WINDOW_MS=2000` dedups multi-channel copies of the same `(dev_addr, fcnt)`;
  the stronger-RSSI copy is kept. `MAX_TRACKS_PER_DEVADDR=4` (lowest-count track
  evicted). `DEDUPE_CAP=500`.
- **Joins and downlinks aren't track-correlatable** (joins have no dev_addr;
  downlinks use a separate counter) so they're bucketed into synthetic `joins` /
  `downlinks` tracks and rendered in the EventsBar, never the scatter.
- Each ingested packet is tagged with `_trackId`; `_netId` is cached on the packet
  (resolved via `devAddrToNetId`) so downstream render doesn't re-parse.

### `_id` / `_new` packet flags
The parent assigns a monotonic `_id`; `_new: true` marks SSE-delivered packets
(they pulse on the chart), `_new: false` marks initial-fetch and cached packets.
`PULSE_DURATION_MS=700` is shared between scatter and events bar.

### Canvas scatter (`PacketScatter.jsx`)
Single `requestAnimationFrame` loop reads from a `stateRef` so prop churn doesn't
tear it down. `xMax` is anchored to `Date.now()` each frame for smooth live-time
scrolling; `xMin` is the earliest visible packet. Dot color: NetID picks the hue
family (all Helium NetIDs share one emerald hue family via `colorForNetIdShade`;
non-Helium NetIDs map deterministically via djb2), frame type
picks the shade (confirmed darker). Hover uses a proportionally-damped
Catmull-Rom band with sticky `pointInBand()` tracking.

### NetID / operator decode (`pages/public/src/lib/lorawan.js`)
`devAddrToNetId(devAddr)` counts leading 1-bits for the LoRaWAN type, extracts
NwkID per a fixed bit-width table, assembles the 24-bit NetID.
`netIdToOperator(netId)` maps to a hard-coded operator table (`KNOWN_NET_IDS` in
`lorawan.js`, attributed in-file to the LoRa Alliance NetID allocations). The four Helium NetIDs are `000024`, `00003C`, `60002D`,
`C00053`.

## On-Chain Onboarding

Two-step Solana flow, both built server-side in `handlers/issue.js` using
`worker/src/lib/helium-solana.js` (multi-gateway is the **only consumer** of
`buildIssueInstruction` / `buildOnboardInstruction` — `iot-onboard` delegates to
the Helium onboarding server instead). Note both steps register the gateway as a
**data-only IoT Hotspot** (1M-DC tier; no PoC) — `buildOnboardInstruction`
supports a `full` mode but this tool always builds data-only.

**Issue** (`POST /issue`):
1. `findGateway` locates the gateway and its `public_key`.
2. The worker calls the fork's `POST /gateways/:mac/add` (with the **write**
   key `MULTI_GATEWAY_WRITE_API_KEY`, falling back to `MULTI_GATEWAY_API_KEY`) to
   get `{ unsigned_msg, gateway_signature }`.
3. If the `keyToAsset` PDA already exists ⇒ `already_issued: true`, nothing to do.
4. Build `issue_data_only_entity_v0` (Entity Manager program) reading
   `collection`/`merkleTree` from the on-chain `DataOnlyConfig` account at
   `CONFIG_COLLECTION_OFFSET`/`CONFIG_MERKLE_OFFSET`.
5. Serialize and POST to the Helium **ECC verifier**
   (`https://ecc-verifier.web.helium.io/verify`) with the add-txn's
   `unsigned_msg` + `gateway_signature`; the verifier returns the partially-signed
   wire txn (the ECC keypair lives on the gateway, off-chain). Returns base64 for
   the wallet to sign.

**Onboard** (`POST /onboard`):
1. Read `keyToAsset` (must exist), `iotInfo` (must NOT exist), `DataOnlyConfig`.
2. DAS `getAsset` + `getAssetProof` (the cNFT proof), latest blockhash, and the
   merkle tree account (for `getCanopyDepth`) in parallel.
3. Build `onboard_data_only_iot_hotspot_v0` with the H3 `location` (Option<u64>),
   `elevation` (Option<i32>, m), `gain` (Option<i32>, dBi×10). Returns base64 for
   the wallet to sign + pay (DC fee payer = owner).

**Frontend signing** (`MultiGateway.jsx`): `sendTransaction` via wallet-adapter,
then `confirmAndVerify` from the **dc-mint** tool. `handleOnboardWithWallet`
converts the entered lat/lng to an H3 res-12 cell via `latLngToCell(..., 12)` and multiplies the
entered antenna gain by 10. The DC balance check uses `ONBOARD_DC_COST=100000`
(100,000 DC / $1); when short, the user mints DC through `DcMintModal`.

## Related tools

- **dc-mint** — `MultiGateway.jsx` imports `DcMintModal`
  (`../dc-mint/DcMintModal.jsx`), `DC_MINT` (`../dc-mint/constants.js`), and
  `confirmAndVerify` (`../dc-mint/solanaUtils.js`) for the on-chain steps (confirm
  tx, top up DC before onboard).
- **hotspot-claimer** — the worker's `handlers/onchain.js` reuses `fetchAccount`
  from `worker/src/tools/hotspot-claimer/services/common.js`. See
  `worker/src/tools/hotspot-claimer/CLAUDE.md`.
- **shared/geo** — `MultiGateway.jsx` calls `fetchGeo()` from
  `pages/public/src/lib/sharedApi.js` (worker `GET /shared/geo`) to seed the
  location-assertion form with the requester's CF-derived lat/lng.
- **iot-onboard** — solves the same on-chain problem (issue → onboard) but
  delegates txn building to `onboarding.dewi.org`; multi-gateway builds the txns
  locally via the shared lib. The two are independent; do not converge them
  without care.
- **`worker/src/lib/helium-solana.js`** — multi-gateway is the sole consumer of
  `buildIssueInstruction` / `buildOnboardInstruction` (and the related PDA/offset
  exports). Changes there affect this tool only.

## On-Chain Programs

Used by the issue/onboard instruction builders in `helium-solana.js`:

| Program | ID |
|---------|----|
| Entity Manager | `hemjuPXBpNvggtaUnN1MwT3wrdhttKEfosTcc2P9Pg8` |
| Helium Sub-DAOs | `hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR` |
| Bubblegum (cNFT) | `BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY` |
| SPL Account Compression | `cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK` |
| Data Credits | `credMBJhYFzfn7NxBMdU4aUqFggAjgztaCcv2Fo6fPT` |
| Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |
| SPL Noop (log wrapper) | `noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV` |
| ECC Verifier (signer) | `eccSAJM3tq7nQSpQTm8roxv4FPoipCkMsGizW2KBhqZ` |

ECC verification HTTP endpoint: `https://ecc-verifier.web.helium.io`.

## Environment / Secrets

- `MULTI_GATEWAY_API_KEY` — read-side key for the fork's REST + SSE surface
  (never log or expose). Absent ⇒ the API returns 500.
- `MULTI_GATEWAY_WRITE_API_KEY` — write-side key for `POST /gateways/:mac/add`
  during issue; falls back to `MULTI_GATEWAY_API_KEY` if unset (never log or
  expose).
- `MULTI_GATEWAY_HOST` — upstream host override; default `hotspot.heliumtools.org`
  (a public hostname, not a secret).
- `SOLANA_RPC_URL` — Helius staked endpoint for on-chain reads and DAS (never log
  or expose).
- `MULTI_GATEWAY_HUB` — Durable Object binding (`MultiGatewayHub`).
- `KV` binding — OUI/DevAddr catalog cache (`oui-devaddr-map`, 24h TTL).
- Frontend: `VITE_SOLANA_URL` for the wallet-adapter connection.

## Gotchas

- **gRPC-web OUI fetch fails in `wrangler dev`** (Miniflare is HTTP/1.1; the
  Helium config service needs HTTP/2). `getOuiCache` falls back to a live fetch on
  a KV miss, so a cold dev cache yields an empty OUI catalog locally.
- **`/events` is a WebSocket, not SSE.** The client wraps it in an
  EventSource-shaped `SseLikeSocket`; the DO emits both SSE-style data frames and
  `sse_status` control frames on the same socket. Don't reintroduce per-tab SSE —
  it re-saturates the fork's per-region cap of 20.
- **DO state is wiped on hibernation.** Anything that must survive must be an
  alarm (`storage.setAlarm`), not a `setTimeout`. Any new wake path must
  `ensureUpstreams()`.
- **Scatter and events bar must keep the same `px-2` inset and the same `xDomain`
  prop**; EventsBar imports the scatter's `plotLeftFor`/`PLOT_RIGHT` so the axes
  align. Changing one without the other tears the alignment.
- **IDB cache is best-effort** (Safari worker-transaction stall bug). Never treat
  `cached_packets` as authoritative — the network batch always overwrites it.
