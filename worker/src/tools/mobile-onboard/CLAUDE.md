# Mobile WiFi Onboarding

Onboards **self-serve converted WiFi networks as Mobile data-only Hotspots**
(docs.helium.com/mobile/wifi-conversion-onboarding), replicating the
`helium-wallet hotspots add mobile {token|onboard|cert}` CLI flow in the
browser, plus a **Manage** surface for previously onboarded networks (retrieve
RadSec certificates, update location) and vendor-specific AP configuration
guidance. The connected wallet pays (200,000 DC ≈ $2 + SOL fees), owns the
Hotspot cNFT, and signs everything after the one-shot gateway token.

**Carrier nuance / Helium Plus on-ramp (must stay prominent + honest in the
UI):** networks onboarded here serve **Helium Mobile / Noble Mobile, Google Fi,
and WeFi** subscribers. The larger carriers (**T-Mobile, AT&T, Telefonica**) are
enabled later, on the *same* deployment, through the **Helium Plus** enterprise
program (**https://helium.plus**). This tool is framed as the self-serve
**on-ramp** to Helium Plus, **not a gate**: everyone runs the full setup here,
validates a real deployment cheaply (~$2), then may apply to Helium Plus to add
the big carriers. Honesty guardrails (do not regress): this tool alone does NOT
enable T-Mobile/AT&T/Telefonica; the big carriers are **eligible, not
guaranteed** (deployments apply to Helium Plus, subject to review) — never
phrase them as automatic/"added later"; the self-serve carriers are
**activatable here**, not auto-live (they require configuring the AP with each
carrier's NAI realm, not just onboarding). The intro presents this as a status
**timeline** (a filled "Available now, in this tool" node over the self-serve
carriers, a hollow "Later, if eligible for Helium Plus" node over the partner
carriers, connected by a rail) — deliberately NOT two equal boxes, which read
as a pick-one control. Helium Plus is optional (self-serve carriers are a fine
permanent home); the
Hotspot/certs/AP config carry forward (not throwaway). The messaging lives at three touchpoints, escalating in warmth:
`IntroStep` (one informational "Carrier coverage" timeline + a start-here-anyway
note, no dead-end, always-enabled Start button), `ConfigureStep` (the earned
"When you're ready to expand" card, future-tense since the AP isn't validated
yet), and ambient reference lines in `VendorGuide`'s `CarrierBanner` and each
brownfield `ManageDetail`. Steps 2–5 stay silent about Helium Plus by design.

## Where it sits among the onboarding tools
- **iot-onboard** — IoT initial onboard, txns proxied to `onboarding.dewi.org`.
- **multi-gateway** — IoT issue + onboard, txns built **locally**.
- **update-location** — IoT re-assert, txn built locally.
- **mobile-onboard (this tool)** — Mobile issue + onboard + re-assert, all
  built **locally** via the shared lib (there is no dewi endpoint for mobile
  data-only onboarding), plus the cert-service proxy.

## The three CLI steps this replicates

1. **Token** (`hotspots add mobile token`) — fully client-side. Key
   primitives live in the lean `gatewayKey.js` (`@noble/curves` ed25519 +
   `@helium/address` + `angry-purple-tiger`, NO protobuf) so the key-grind
   worker can reuse them; `gatewayToken.js` builds the signed token on top:
   protobuf `blockchain_txn_add_gateway_v1 { gateway: <33-byte helium bin
   address> }`, sign the encoded message with the gateway key, wrap in a
   `blockchain_txn` envelope, base64. **Verified field numbers** (helium/proto):
   owner=1, gateway=2, owner_signature=3, gateway_signature=4, payer=5,
   payer_signature=6, staking_fee=7, fee=8; envelope oneof `add_gateway = 1`.
   `buildTokenFromPrivateKey(priv)` signs a chosen key and returns the token
   (the wizard generates keys via the grind worker and passes the chosen one
   in). The private key is
   used once and discarded — certificates are later signed by the *wallet*, so
   the gateway secret is never needed again. Do NOT reuse
   `iot-onboard/bleProto.js`'s `add_gateway_v1` — that is the BLE
   gateway-config *request* message (string owner/payer, no gateway field).
   `parseGatewayToken` (round-trip validated against a real `helium-wallet`
   token) is retained for the **resume** path only — `OnboardWizard` re-derives
   the issue payload from the draft's stored token when resuming a
   not-yet-issued Hotspot. There is no user-facing "paste a CLI token" entry
   (removed); keys are always generated in-browser here.

   **Key grinding** (`TokenStep.jsx` + `keygenWorker.js` + `animalWords.js`):
   users can reroll random keys or grind toward an `angry-purple-tiger` name.
   The name is strictly positional — `adjective color animal`, each an
   independent draw from a 256-word list — so grinding is a **per-slot
   typeahead**, NOT a free substring search (e.g. "tiger" is in both the color
   and animal lists; picking `animal: tiger` matches only names whose third
   word is tiger). `animalWords.js` imports the three real dictionaries from
   `angry-purple-tiger/lib/{adjectives,colors,animals}.js` (deduped/sorted) to
   populate the `<datalist>` pickers and validate typed words; the worker
   matches each constrained slot by exact word after splitting the name on its
   space separator. Difficulty scales per constrained slot: 1 slot ≈ 1/256
   (instant at ~4k keys/sec), 2 ≈ 1/65k (seconds), 3 ≈ 1/16.7M (many minutes) —
   the UI shows this. The grind runs in a Vite `?worker` module (`import
   KeygenWorker from "./keygenWorker.js?worker"`, mirroring multi-gateway's
   `packetWorker`): it generates identities in time-sliced batches (yielding so
   `stop`/`reroll` stay responsive), streams matches plus `progress`, and posts
   each candidate's 32-byte private key so the main thread can build the token
   for the chosen one. Match cap: **1 when all three slots are pinned** (a full
   name has exactly one possible result, so stop at the first hit), otherwise
   12 (looser targets stream a variety to pick from). A monotonic `session`
   counter halts superseded loops (fast stop→grind can't run two loops over
   shared state); `done` fires on reaching the cap, `stop` halts silently (the
   UI flips `grinding` off itself). A candidate is auto-selected as soon as it
   streams in, so **Use this key** is enabled mid-grind — clicking it stops any
   in-flight grind and proceeds (no need to wait for the cap or Stop first).
   The token is only built (key signed) when the user clicks Use this key;
   candidate private keys live only in TokenStep's transient state and are
   never persisted (the draft holds only the finished token, which contains no
   private key). TokenStep also **pre-rolls** a key when the step opens so a
   name is ready immediately (guarded by a ref so a dev StrictMode remount
   doesn't clobber the selection).
2. **Onboard** (`hotspots add mobile onboard <token> --lat --lon`) — two
   wallet-signed Solana txns: `/issue` (issue_data_only_entity_v0, ECC-verifier
   co-signed) then `/onboard` (onboard_data_only_mobile_hotspot_v0).
3. **Cert** (`hotspots add mobile cert <key> --nas-id --address`) — a signed
   JSON POST to the Nova cert service, proxied by `/cert` (no CORS upstream).

## Worker (API) — prefix `/mobile-onboard`

Entry point: `index.js` → handlers under `handlers/`. Registered in
`worker/src/index.js`; the fee refresh (`refreshMobileOnboardFees`) runs on the
6-hourly cron branch next to the iot-onboard one. Bindings: `SOLANA_RPC_URL` +
`KV` only.

**Endpoints:**
- `GET /fees` — per-device-type `DeviceFeesV1` schedule from the MOBILE
  `RewardableEntityConfigV0`, KV-cached (`mobile-onboard:fees:v1`, 7h TTL).
  Live values (2026-07): wifiDataOnly `{ dc_onboarding_fee: 200_000,
  location_staking_fee: 0 }` — the $2 is all onboarding fee; **location asserts
  are free for wifiDataOnly** (and wifiIndoor/Outdoor; cbrs pays 1M DC).
- `POST /status { gateway }` — keyToAsset + mobileInfo PDA reads →
  `{ issued, indexed, onboarded, has_location, location_dec/hex, device_type,
  num_location_asserts, fees }`. `issued` (raw kta read) flips as soon as the
  issue txn confirms; `indexed` (a DAS getAsset probe, null until issued) can
  lag it by tens of seconds and is what /onboard's asset+proof reads need —
  the wizard's post-issue poll waits for `issued && indexed`, and /onboard
  maps DAS not-found to the retryable `{ not_indexed }` as a backstop. Resume
  derives the true step from this endpoint.
- `POST /issue { owner, gateway, unsigned_msg, gateway_signature }` — mirror
  of multi-gateway's issue handler with the add-gateway material arriving from
  the client token instead of the fork's `/add`. kta exists ⇒
  `{ already_issued }`. Builds the issue ix (legacy message — the ECC verifier
  bincode-decodes it), POSTs hex tx + msg + sig to
  `https://ecc-verifier.web.helium.io/verify`, returns the co-signed txn as
  base64 for the wallet to sign + send. Input sanity: the gateway's **33-byte
  bin form** (b58check decode minus version byte and 4-byte checksum) must
  appear in `unsigned_msg` — the full b58 decode does NOT (version+checksum are
  not in the protobuf field).
- `POST /onboard { owner, gateway, location }` — kta must exist (else 400
  `{ not_indexed }` — the frontend keeps polling /status), mobileInfo must not
  (`{ already_onboarded }`), DAS ownership gate (403), proactive DC check
  (`{ dc_needed, required_dc, current_dc }` → DcMintModal), then
  `buildOnboardMobileInstruction` in a v0 message + `HELIUM_COMMON_LUT`.
  `location` is an H3 res-12 cell **hex** string (required — the CLI's
  --lat/--lon are mandatory too).
- `POST /update { owner, gateway, location }` — Manage-tab re-assert via
  `buildUpdateMobileInfoInstruction`; requires mobileInfo to exist
  (`{ not_onboarded }`). The DC pre-check uses the fee entry for the Hotspot's
  **actual device type** (`feesForDeviceType` — the Manage tab lists all of a
  wallet's Mobile Hotspots, not only wifiDataOnly).
- `POST /cert { location_data, signature, dry_run? }` — pure proxy to
  `https://api.prod.ims.nova.xyz/api/wifi/brownfield/inventory/v1/locations/residential`
  (constants in `config.js`). **The response carries the network's RadSec
  PRIVATE KEY: never log request/response bodies, never persist them.** The
  service returns an empty body on bare 4xx (krakend gateway), so the handler
  substitutes an ownership hint. Upstream 5xx maps to 502.
- `/onboard` and `/update` honor a localhost-gated `?simulate=1` (same dev aid
  as update-location's build handler).

## On-chain instructions (in `worker/src/lib/helium-solana.js`)

Both builders were written from the **helium_entity_manager IDL** (in
helium-wallet-rs `helium-lib/idls/`), whose account order deviates from the
Rust client's struct-literal order in two places — don't "fix" against
helium-wallet-rs source:

- **`buildOnboardMobileInstruction`** (onboard_data_only_mobile_hotspot_v0):
  args after the discriminator are `data_hash[32], creator_hash[32], root[32],
  index u32, location Option<u64>` (no elevation/gain). Accounts: like the IoT
  data-only onboard but **dnt_burner (owner MOBILE ATA) directly after
  dc_burner**, dnt_mint + dnt_price (`MOBILE_PRICE_KEY`, Pyth
  `DQ4C1tzvu28cwo1roN1Wm6TW35sfJEjLh517k3ZeWevx`) between dc_mint and dc, and
  **helium_sub_daos_program last**. Burns DC only (onboarding + location fee);
  the dnt accounts are required but no MOBILE is burned for wifiDataOnly;
  device_type is forced wifiDataOnly on-chain.
- **`buildUpdateMobileInfoInstruction`** (update_mobile_info_v0): args are
  `location Option<u64>` FIRST, then hashes/root/index, then a trailing
  `deployment_info Option = None` byte (None leaves any existing
  deployment_info unchanged, matching the CLI). Account order matches
  `buildUpdateIotInfoInstruction` with mobile_info / MOBILE config / MOBILE
  sub_dao swapped in.
- Shared additions: `MOBILE_REWARDABLE_ENTITY_CONFIG_KEY`,
  `mobileInfoKey()`, `MOBILE_PRICE_KEY`, `MOBILE_DEVICE_TYPES`,
  `parseMobileInfo()` (promoted from hotspot-map, which now imports it via a
  thin adapter in `hotspot-map/services/location.js`), and
  `parseMobileConfigFees()` (walks the MobileConfigV2 enum: variant u8 = 3,
  vec of 89-byte DeviceFeesV1 entries).

**Verification that was actually run** (July 2026): `/issue` with a real
CLI-generated token → the live ECC verifier co-signed it and the returned txn
**simulated clean** (err null). `/update` against a real converted network
(wifiDataOnly, from the hotspot inventory) **simulated clean**. The onboard
builder simulated against an already-onboarded Hotspot fails exactly at
`Allocate: … already in use` on the derived mobile_info PDA — proving args,
account order, and PDA seeds against the real account.

## Certificate request format (`pages/public/src/mobile-onboard/certRequest.js`)

`location_data` = base64(JSON `{ location_address?, nas_ids?, wallet: <solana
b58>, blockchain_pubkey: <helium b58>, timestamp: ISO8601 }`) — address +
nas_ids only on first-time creation; omit both to re-fetch existing certs.
The service supports **one** NAS ID per Hotspot (`nas_ids` is an array but
documented "only one supported"), so the UI takes a single NAS ID and sends
`[nasId]`. `signature` = base64(wallet ed25519 signature over the **base64
string's bytes**, not the raw JSON) — that's wallet-adapter `signMessage`.
Uses UTF-8-safe base64 (bare `btoa` throws on non-Latin-1 street addresses).
Hardware wallets (Ledger) have no `signMessage` — both cert surfaces
feature-detect and tell the user to connect a software wallet. Files download
client-side as `<animal-name>.pk` / `<animal-name>.cer` / `data-only.ca`
(matching the CLI), one button per file (a triple auto-download trips Chrome's
multiple-download blocker). Cert validity ≈ 6 years.

**Reading the NAS ID back.** The NAS ID is **not on-chain** for a converted
network (`mobile_info.deployment_info` is None), so it can't be derived from
Solana. The cert service's response flattens the `LocationInfo`
(`location_address`, `nas_ids`) alongside the cert material, so `CertDownloads`
shows the NAS ID + address from any cert fetch. On the Manage tab that is how
an operator retrieves the NAS ID a Hotspot was issued for (via the same
wallet-signed "Retrieve certificates" action).

## Frontend (`pages/public/src/mobile-onboard/`)

`MobileOnboard.jsx` — shell with three `?tab=`-synced tabs: **Onboard**
(wizard), **Manage**, **AP Setup Guide** (works without a wallet).

- `OnboardWizard.jsx` — step machine `intro → token → issue → onboard → cert
  → configure`; owns state + localStorage drafts
  (`usePersistedDrafts.js`, key `heliumtools:mobile-onboard:drafts:v1`, one
  draft per gateway). The draft's token is public data (no private key) and is
  dropped once /status reports issued. **Resume re-derives the step from
  /status — chain wins over the stored step.** Keygen happens only in a click
  handler (StrictMode double-mount would double-generate in an effect).
- `IssueStep.jsx` — sign + confirm, then a poll-until-indexed sub-state
  (5s × 24) before auto-advancing; timeout keeps the draft resumable.
- `OnboardStep.jsx` — `LocationPicker.jsx` (map pin + H3 res-12 overlay,
  copy-adapted from update-location's UpdatePanel *minus* elevation/gain;
  seeds its viewport from `shared/geo` without counting as a chosen location)
  + fee card + `DcMintModal` gate.
- `CertStep.jsx` / `CertDownloads.jsx` — cert creation + downloads; "Later"
  skips to AP setup (certs retrievable from Manage).
- `ManageTab.jsx` / `ManageDetail.jsx` — wallet's Mobile Hotspots via
  `fetchFleet` filtered `networks.includes("mobile")` (update-location's exact
  pattern for "iot"). **Only brownfield (converted WiFi, on-chain device_type
  `wifiDataOnly`) Hotspots have retrievable RadSec certificates** — the cert
  service is the brownfield inventory. Helium Indoor/Outdoor
  (`wifiIndoor`/`wifiOutdoor`, greenfield HMH hardware), CBRS, and IoT have no
  keys to retrieve. `deviceTypes.js` (`isBrownfield` / `mobileDeviceLabel`) is
  the single source of that distinction: the list sorts brownfield first and
  **mutes** the rest (opacity + "No retrievable certificates"), and the detail
  replaces the cert-retrieval card with an explanation for non-brownfield
  Hotspots (using the authoritative `status.device_type` once loaded, the
  fleet row's `deviceType` before). Location update stays available for any
  Mobile Hotspot the wallet owns. Cert retrieval is **explicit retrieve-only**
  — never auto-fetched, because every fetch returns the private key.
- `VendorGuide.jsx` / `vendors.js` — vendor guide links
  (docs.helium.com/mobile/helium-plus-<slug>) + copyable RadSec/Passpoint
  constants (3 RadSec servers :2083, secret `radsec`, WPA3-Enterprise, interim
  300s) + the per-carrier Passpoint config (`NAI_REALMS`; every realm EAP-TLS):
  Helium Mobile / Noble Mobile = realms `freedomfi.com` + `hellohelium.com`
  (with `freedomfi.com` also set as a Domain), WeFi = `premnet.wefi.com`, Google
  Fi = realm `wifi.fi.google.com` plus Domain `orionwifi.com` (Orion Wifi). The
  guide groups these by carrier (`CARRIER_GROUPS`, derived from `NAI_REALMS`)
  with typed, indented Realm/Domain sub-rows; RadSec servers render numbered
  with the shared secret in its own panel; the fixed SSID values are a separate
  "Network settings" subgroup. A `domain` equal to the realm (Helium Mobile) is
  intentional. + the carrier banner.
- `gatewayKey.js` — lean keygen/identity primitives (no protobuf), shared by
  `gatewayToken.js` and `keygenWorker.js`. Holds the `@helium/address` interop
  shim (`AddressDefault.default ?? AddressDefault`) because that package is
  transpiled CJS: Vite resolves the default import to the class, Node-style
  interop (used by the esbuild round-trip test) resolves it to module.exports.
- `gatewayToken.js` — protobuf token build/parse on top of `gatewayKey.js`; see
  "Token" above.
- `keygenWorker.js` — the key-grind Web Worker; see "Key grinding" above.
- `animalWords.js` — the three positional dictionaries (from
  `angry-purple-tiger/lib`); powers the grind typeahead.
- `pages/public/src/lib/mobileOnboardApi.js` — the six-endpoint client.

## Reused from other tools
- `worker/src/lib/helium-solana.js` — everything on-chain (see above).
- `iot-onboard/services/fees.js` pattern — mirrored, not shared (different
  account + shape).
- `hotspot-claimer/services/common.js` — `fetchAccount` (status handler).
- `wallet-dashboard` `/fleet` — the Manage tab's Hotspot list.
- `dc-mint` — `DcMintModal`, `signAndBroadcast`/`confirmAndVerify`.
- `shared/geo` — LocationPicker viewport seed.
- `components/CopyButton.jsx`.

## Gotchas
- **Entity key vs bin form.** The on-chain entity key (kta / mobile_info PDA
  hashing) is the FULL b58check decode (version + tag + pubkey + checksum);
  the protobuf `gateway` field is the 33-byte bin form (tag + pubkey, no
  version/checksum). Mixing them breaks the /issue sanity check or the PDA.
- **wifiDataOnly location fee is 0** — the dc_needed gate on /update
  effectively never trips for converted networks; it exists for the other
  device types (cbrs location = 1M DC).
- **Cert service errors are opaque** — bare `{}` 400s from the krakend
  gateway; the handler's hint text is the best available signal.
- **Fee cache TTL (7h) > cron interval (6h) on purpose** — same reasoning as
  iot-onboard.
- **DC-balance read must be "confirmed", not the connection default.** `new
  Connection(rpcUrl)` defaults to `finalized`, so a wallet that just topped up
  via `DcMintModal` (which confirms at `confirmed`) reads stale-zero for ~13s
  and the `dc_needed` gate bounces the user back to the top-up modal on every
  retry. `/onboard` and `/update` therefore read the DC ATA with
  `getAccountInfo(ata, "confirmed")`. (Only bites device types with a nonzero
  fee — onboarding always, and non-wifiDataOnly location updates.)

## Environment / Secrets
- `SOLANA_RPC_URL` — on-chain reads, DAS, LUT (never log or expose).
- `KV` — fee cache (`mobile-onboard:fees:v1`).
- No new env vars, bindings, or D1 tables. Nothing sent to the ECC verifier or
  cert service is secret, but cert *responses* contain the user's RadSec
  private key (see /cert).

## External Dependencies
- **ECC verifier** — `https://ecc-verifier.web.helium.io/verify` (shared with
  multi-gateway).
- **Nova cert service** —
  `https://api.prod.ims.nova.xyz/api/wifi/brownfield/inventory` (no CORS; the
  reason /cert exists).
- **CARTO basemaps** — LocationPicker map tiles.
- **docs.helium.com** — vendor guides (linked, not fetched).
- **helium.plus** — the enterprise-carrier path linked from the intro/banner.
