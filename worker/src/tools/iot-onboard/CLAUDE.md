# IoT Hotspot Onboarding

Connect to a Helium IoT Hotspot over Web Bluetooth, configure it, and register
it on Solana. The browser pairs with the Hotspot's `gateway-config` firmware,
reads diagnostics / configures WiFi, then asks the on-board ECC chip to sign an
`AddGatewayV1` transaction. The worker forwards that signature to the Helium
onboarding server (`onboarding.dewi.org`), which returns ready-to-broadcast
Solana transactions for the two-step **Issue** (create the compressed-NFT entity)
→ **Onboard** (register on the IoT network + assert location) flow. Requires a
connected Solana wallet (the tool is wrapped in `SolanaProvider`); no other
account is used.

## Architecture

This tool has two halves: a **BLE layer** that lives entirely in the browser, and
an **on-chain layer** that the worker proxies to an external service. The worker never touches Bluetooth and never builds onboarding
transactions itself — it is a thin proxy + on-chain status reader.

### Worker (API) — prefix `/iot-onboard`

Entry point: `index.js` → handlers under `handlers/`. Registered in
`worker/src/index.js` (`{ prefix: "/iot-onboard", handler: handleIotOnboardRequest }`),
which also wires the cron export `refreshOnboardFees`.

**Endpoints:**
- `GET /fees` — current on-chain onboarding fees (`full` / `data_only`, each
  `{ base, location }` in DC), KV-cached. Served straight from `getOnboardFees`.
- `POST /lookup { onboarding_key?, gateway_pubkey? }` — runs three things in
  parallel: (1) maker info from the onboarding server + maker DC balance on-chain,
  (2) on-chain issued/onboarded/has-location status, (3) fee fetch. Returns
  `{ maker, onchain, suggested_mode, fees }`. `suggested_mode` is `"full"` when the
  maker's DC covers the full PoC cost, else `"data_only"`.
- `POST /issue { owner, gateway_pubkey, add_gateway_txn }` — forwards the
  base64 BLE-signed `AddGatewayV1` to `onboarding.dewi.org/api/v3/transactions/create-hotspot`.
  Short-circuits with `{ already_issued: true }` if the keyToAsset PDA already
  exists. Returns the server's `solanaTransactions` re-encoded as base64.
- `POST /onboard { owner, gateway_pubkey, user_pays?, location?, elevation?, gain? }`
  — forwards to `onboarding.dewi.org/api/v3/transactions/iot/onboard`. Requires the
  entity to already be issued (keyToAsset present). `location` is an H3 res-12 cell
  as a **hex** string client-side, converted to **decimal** here before forwarding
  (the onboarding server wants decimal u64). Returns base64 `solanaTransactions`.

**The worker does NOT build issue/onboard transactions locally.** Both `/issue`
and `/onboard` are pure pass-throughs to `onboarding.dewi.org/api/v3`; that
service performs ECC verification and constructs the Solana instructions. (See
**Related tools** — `multi-gateway` does the opposite.)

**Handlers / services:**
- `handlers/lookup.js` — `fetchMakerInfo()` hits `GET /hotspots/<onboarding_key>`
  (5s `AbortController` timeout, 404 ⇒ no maker), converts the maker's Helium
  address to a Solana pubkey, reads its DC ATA balance directly off the SPL token
  account (`readBigUInt64LE(64)`). `fetchOnchainStatus()` reads the `keyToAsset` and
  `iotInfo` PDAs: account-exists ⇒ `issued` / `onboarded`; `has_location` is byte 41
  of `IotHotspotInfoV0` (`disc(8)+asset(32)+bump(1)+Option<u64> tag`) being `1`.
- `handlers/issue.js` — pass-through to `/transactions/create-hotspot`; surfaces the
  server's `errorMessage`. 15s request timeout.
- `handlers/onboard.js` — pass-through to `/transactions/iot/onboard`; builds the
  payload conditionally (see `user_pays` logic below). 15s request timeout.
- `handlers/fees.js` — trivial wrapper returning `getOnboardFees(env)`.
- `services/fees.js` — reads onboarding fees by decoding two on-chain Solana
  accounts directly (no fee HTTP API): `SubDaoV0` (for `onboarding_dc_fee` at byte offset 304, and
  `onboarding_data_only_dc_fee` found by skipping the `emission_schedule` Vec) and
  `RewardableEntityConfigV0` (IoT config location fees, located by scanning for the
  `min_gain=10`/`max_gain=150` marker). KV-cached under `iot-onboard:fees:v1` with a
  **7h TTL** (deliberately longer than the 6h cron so the cache never gaps). Falls
  back to hard-coded HIP defaults (`full {1M, 100k}`, `data_only {50k, 50k}`,
  `stale: true`) when RPC is unavailable. `refreshOnboardFees()` is the cron entry —
  the worker runs it 4×/day (00/06/12/18 UTC, per `wrangler.jsonc`).

### Frontend (`pages/public/src/iot-onboard/`)

- `IotOnboard.jsx` — single-page component. `StartPage` → pair → connected view
  with three panels: `DiagnosticsPanel`, `WifiPanel`, `OnboardPanel`. The onboard
  panel is a step machine: `lookup → issue → location → onboard → done`, seeded from
  the `/lookup` on-chain status (e.g. already-issued jumps straight to `location`).
  Location step uses a MapLibre map + H3 res-12 hex overlay (`h3-js latLngToCell`),
  auto-fetches ground elevation from `api.open-elevation.com`, and supports browser
  geolocation. `signAndBroadcast()` inspects `message.header.numRequiredSignatures`:
  if the user's wallet is among the required signers it signs via the wallet adapter,
  otherwise the wallet isn't a required signer and the txn is broadcast raw via
  `sendRawTransaction` (the code comment attributes this to a maker-paid txn).
- `useHotspotBle.js` — the entire Web Bluetooth state machine (status, pubkey,
  onboarding key, diagnostics, WiFi, `writeAddGateway`). Pure hook; no worker calls.
- `bleProto.js` — protobufjs (`light` build) message definitions for the BLE
  characteristics: `diagnostics_v1`, `wifi_services_v1`, `wifi_connect_v1`,
  `wifi_remove_v1`, `add_gateway_v1`. Also defines `StaleFirmwareError`.
- `bleTypes.js` — the GATT `SERVICE_UUID` and the characteristic UUID map.
- `pages/public/src/lib/iotOnboardApi.js` — API client (`fetchOnboardFees`,
  `lookupHotspot`, `requestIssue`, `requestOnboard`). Dev proxies `/api/iot-onboard`,
  prod hits `https://api.heliumtools.org/iot-onboard`.

## Key Concepts

### BLE layer (Web Bluetooth)

- **GATT service UUID:** `0fda92b2-44a2-4af2-84f5-fa682baa2b8d`. All characteristic
  UUIDs are in `bleTypes.js` (`PUBKEY`, `ONBOARDING_KEY`, `DIAGNOSTICS`,
  `ETHERNET_ONLINE`, `WIFI_*`, `ADD_GATEWAY`, `ASSERT_LOC`, `LIGHTS`).
- **Reads must be sequential.** Parallel `readValue()` calls cause
  "GATT operation failed for unknown reason". The connect path reads pubkey →
  onboarding key → diagnostics → ethernet → SSID one at a time (`safeRead`).
- **Not all characteristics exist on every firmware variant.** Each read is wrapped
  in try/catch (`safeRead` logs `"<label>: not available"` and returns `null`) so a
  missing characteristic doesn't abort the whole connect.
- **Silent-disconnect detection.** `gattserverdisconnected` doesn't always fire on a
  session timeout, so a 3s interval polls `device.gatt.connected` as a backup. A ref
  flag (`intentionalDisconnectRef`) distinguishes a user-initiated disconnect (which
  also triggers the event) from an unexpected drop.
- **WiFi connect uses notifications.** `connectWifi` subscribes to the
  `WIFI_CONNECT` characteristic, writes the encoded credentials, then listens for
  status notifications (it sets `connecting`, then each notification value, stopping on a terminal state: `connected` / `failed` / `timeout` / `invalid`) until
  a terminal state or 60s timeout.
- **`DataView` slicing.** Bytes are extracted as
  `new Uint8Array(view.buffer, view.byteOffset, view.byteLength)` — never the raw
  `.buffer`, which includes the full backing ArrayBuffer.

### ADD_GATEWAY write+poll-read (the crux of issue)

`useHotspotBle.writeAddGateway(owner, payer)` is NOT a notify flow — it's
**write, then poll-read**:
1. Encode `add_gateway_v1 { owner, amount:0, fee:0, payer }` (protobuf). `owner`
   and `payer` are **Helium-format** base58 strings — the firmware runs
   `libp2p_crypto:b58_to_bin` on them. `IotOnboard.handleIssue` builds the Helium
   address from the connected Solana wallet via `new Address(0,0,1, walletPubkey.toBytes()).b58`
   (`@helium/address`), using it for both owner and payer.
2. `char.writeValue(payload)`, then poll `char.readValue()` every 500ms for up to 60s.
3. ECC signing takes seconds; the firmware returns ASCII `init` / `processing`
   intermediate strings (skipped) before writing the signed binary `AddGatewayV1`.
4. The signed bytes are returned base64-encoded (what the onboarding server expects)
   and passed to `POST /issue`.

### StaleFirmwareError + firmware recovery image

If the polled response is a short (`< 20 byte`) ASCII alpha/underscore string
(regex `/^[a-z_]+$/i`) that isn't `init`/`processing` (e.g. an error token), the
firmware predates the Helium→Solana migration and can't produce a Solana-valid
signature. `writeAddGateway` throws `StaleFirmwareError` (carrying the raw
response). `IotOnboard.jsx` renders a `StaleFirmwareBanner` with recovery steps;
for known re-flashable makers (`RAKwireless`, `CalChip Connect`) it links a
recovery firmware image plus a balenaEtcher link. That image lives in a public
Cloudflare R2 bucket but is referenced by a **hard-coded public `*.r2.dev` URL in
the frontend** (`MNTD_FIRMWARE_URL` in `IotOnboard.jsx`) — the worker is not
involved (it has no R2 binding); the browser fetches the `.img` directly.

### On-chain layer (issue + onboard)

- **External service.** Both transaction-building steps are proxied to
  **`https://onboarding.dewi.org/api/v3`** (`ONBOARDING_API_BASE` in `config.js`):
  `/hotspots/<onboarding_key>` (maker lookup), `/transactions/create-hotspot`
  (issue), `/transactions/iot/onboard` (onboard). That service does the ECC
  verification and returns ready-to-broadcast `solanaTransactions`.
- **Maker DC + `user_pays` logic.** `/lookup` checks the maker's on-chain DC against
  the **full** PoC cost (`fees.full.base + fees.full.location`). When the maker has
  enough DC, the client omits `payer` on `/onboard` so the maker covers **both DC
  and SOL fees**. When the maker is short, the client sets `user_pays: true`, the
  worker adds `payer: owner`, and the user's wallet covers DC (and SOL). The frontend
  derives `userPays = !lookupData?.maker?.dc_sufficient`.
- **Full vs data-only.** *Full* (PoC-eligible) costs the full base + location DC and
  earns coverage rewards; *data-only* (lower fee) is data-transfer-only. The UI shows
  the mode selector only when the maker can't cover DC (otherwise the maker pays and
  full is implied). Modeled in fees as `full` / `data_only` `{ base, location }`.
- **Helium → Solana address conversion.** Helium addresses are
  `[version(1), net_type(1), ed25519_pubkey(32), checksum(4)]`; the Solana pubkey is
  bytes `[2, 34)` — `bs58.decode(addr).slice(2, 34)`. Used in `lookup.js` to resolve
  the maker's DC ATA.
- **On-chain status PDAs.** `keyToAssetKey(gateway_pubkey)` present ⇒ issued;
  `iotInfoKey(gateway_pubkey)` present ⇒ onboarded; both derived in
  `worker/src/lib/helium-solana.js`.

## Gotchas

- **`/issue` and `/onboard` are NOT idempotent on the dewi side** — the worker
  guards them with on-chain pre-checks (keyToAsset / iotInfo) and returns
  `already_issued` / `already_onboarded` so a re-run doesn't double-submit.
- **`location` encoding mismatch** — the client sends H3 as hex, the onboarding
  server wants decimal. `onboard.js` does `BigInt("0x" + location).toString()`. Don't
  forward the hex string raw.
- **`gain` units** — the UI takes dBi (e.g. `1.2`) and sends `Math.round(gain * 10)`
  (dBi × 10) to the worker, matching the on-chain integer representation.
- **Maker lookup is best-effort** — a 5s timeout or 404 yields a null/zero-balance
  maker rather than failing the whole lookup; the UI then defaults to user-pays /
  data-only so the Issue button is never stranded.
- **Fee cache TTL > cron interval on purpose** — 7h TTL vs 6h cron. Shrinking the TTL
  below the cron interval would create windows where `/fees` falls back to defaults
  (`stale: true`).

## Environment / Secrets

- `SOLANA_RPC_URL` — Helius staked endpoint, used for maker DC reads, PDA status
  reads, and on-chain fee decoding (never log or expose).
- `KV` binding — onboarding-fee cache (`iot-onboard:fees:v1`).
- No R2 binding. The recovery firmware image is a hard-coded public `*.r2.dev`
  URL in the frontend (see "StaleFirmwareError" above), not served by the worker.
- No secrets are sent to `onboarding.dewi.org` — it's an unauthenticated public API.

## External Dependencies

- **Helium onboarding server** — `https://onboarding.dewi.org/api/v3`. Builds and
  ECC-verifies the issue + onboard Solana transactions. We do not run or fork this.
- **`api.open-elevation.com`** — client-side ground-elevation autofill on the
  location step (best-effort, failure is silently ignored).
- **CARTO basemaps** (`basemaps.cartocdn.com`) — MapLibre tile styles for the
  location map.
- **balenaEtcher** (`https://etcher.balena.io/`) — linked for SD-card firmware
  reflashing in the stale-firmware recovery path.

## Related tools

- **multi-gateway** (`worker/src/tools/multi-gateway/handlers/issue.js`) — the
  **contrast case**. multi-gateway builds the issue/onboard Solana instructions
  **locally** via `buildIssueInstruction()` / `buildOnboardInstruction()` in
  `worker/src/lib/helium-solana.js` (it has the merkle tree / proof / canopy depth to
  do so), whereas **iot-onboard delegates entirely to `onboarding.dewi.org`** and
  builds nothing on-chain. If you need to understand the raw instruction layout, read
  multi-gateway's `issue.js` and `helium-solana.js`; the BLE + maker-paid flow
  lives in this tool.
- **hotspot-claimer** (`worker/src/tools/hotspot-claimer/services/common.js`) —
  iot-onboard reuses its `fetchAccount()` RPC helper for all on-chain reads. The
  "Done" step also deep-links into the claimer (`/hotspot-claimer?mode=hotspot&key=`).
- **hotspot-map** (`pages/public/src/hotspot-map/`) — the "Done" step deep-links to
  it (`/hotspot-map?keys=`) to show the freshly onboarded Hotspot on the map.
- **Shared Helium×Solana library** (`worker/src/lib/helium-solana.js`) —
  `keyToAssetKey`, `iotInfoKey`, `ataAddress`, `DC_MINT`, `IOT_SUB_DAO_KEY`,
  `REWARDABLE_ENTITY_CONFIG_KEY`.

## References

- gateway-config firmware (the BLE GATT peer): the protobuf field shapes in
  `bleProto.js` mirror its `add_gateway_v1` / `wifi_*` messages.
- Helium onboarding server API: `https://onboarding.dewi.org/api/v3`.
- `@helium/address` — Helium B58 address construction for the `add_gateway` owner/payer.
