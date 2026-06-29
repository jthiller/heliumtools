# Update Hotspot Location

Wallet-driven re-assert of an **already-onboarded IoT Hotspot's** location /
elevation / antenna gain on Solana. The user connects a browser wallet
(Phantom, Brave, Solflare, any Wallet-Standard wallet), picks one of their
Hotspots, edits the values on a map, and signs a single `update_iot_info_v0`
transaction. The Hotspot owner pays — a DC location-assert fee when the location
changes, plus the SOL network fee.

The logic center-of-gravity is the worker (it builds the transaction), so this
doc lives here even though the tool is half frontend.

## Where it sits among the onboarding tools
- **iot-onboard** — *initial* onboard, txns proxied to `onboarding.dewi.org`.
- **multi-gateway** — issue + onboard, txns built **locally** via the shared lib.
- **update-location (this tool)** — *re-assert* after onboarding, txn built
  **locally** too. There is no dewi/Helium onboarding-server endpoint for
  location updates, so we build `update_iot_info_v0` ourselves.

## Worker (API) — prefix `/update-location`

Entry point: `index.js` → handlers under `handlers/`. Registered in
`worker/src/index.js` (`{ prefix: "/update-location", handler:
handleUpdateLocationRequest }`). No cron, no bindings, no `wrangler.jsonc`
changes — only `SOLANA_RPC_URL` + `KV` (both already present; `KV` is used only
indirectly via the shared fee cache).

**Endpoints (both POST):**
- `POST /status { gateway_pubkey }` — reads `keyToAsset` + `iotInfo` PDAs and
  returns the Hotspot's current asserted values so the editor can pre-fill:
  `{ issued, onboarded, has_location, location_dec, location_hex, elevation,
  gain, num_location_asserts, device_type, fees }`. `device_type` (`"full"` /
  `"data_only"`) is read from the `is_full_hotspot` bool in `IotHotspotInfoV0`
  (authoritative — not fee-inferred). `gain` is dBi × 10. `fees` is
  `getOnboardFees(env)` (the iot-onboard KV-cached fee reader).
- `POST /build { owner, gateway_pubkey, location?, elevation?, gain? }` — builds
  the unsigned `update_iot_info_v0` transaction (base64). `location` is an H3
  res-12 cell **hex** string; omitted/null fields are left unchanged on-chain.
  Returns `{ transaction }`, or `{ dc_needed, required_dc, current_dc,
  device_type }` when the wallet's DC is short of the location fee, or
  `{ error, not_onboarded }` when the Hotspot isn't onboarded. A dev-only
  `?simulate=1` query returns the `simulateTransaction` result instead of the
  txn (used to validate account/arg order — see Gotchas).

**Handlers:**
- `handlers/status.js` — exports `parseIotInfo(buf)`, which walks
  `IotHotspotInfoV0` (`disc(8) + asset(32) + bump(1)` then the location/elevation/
  gain Options, then `is_full_hotspot` + `num_location_asserts`). The location
  Option tag is at byte 41 (same as iot-onboard's `has_location`).
- `handlers/build.js` — adapted from `multi-gateway/handlers/issue.js`
  `handleOnboard`, with the differences below.

## The on-chain instruction — `buildUpdateIotInfoInstruction`

Lives in `worker/src/lib/helium-solana.js` (next to `buildOnboardInstruction`).
Mirrors the onboard builder but with **three deliberate differences** — each a
silent-failure trap if you copy onboard verbatim:
1. **Borsh arg order is inverted.** `update_iot_info_v0` serializes the Options
   FIRST (`location, elevation, gain`), THEN the cNFT fields (`data_hash,
   creator_hash, root, index`). Onboard is the reverse. (Sanity: 127 bytes
   all-Some, 111 bytes all-None.)
2. **Account list adds `tree_authority` + `bubblegum_program`** and **omits**
   onboard's `key_to_asset`, `data_only_config`, and `helium_sub_daos_program`.
   18 fixed accounts, then the merkle proof (sliced by canopy depth).
3. **cNFT hashes are decoded defensively** via `decodeCompressionHash` (base58 or
   `0x`-hex) — different DAS providers vary; a blind `bs58.decode` of a hex value
   corrupts the proof.

`index` = `asset.compression.leaf_id` (u32 LE). For a wallet owner editing their
own Hotspot, `payer = dc_fee_payer = hotspot_owner = the connected wallet`.

## build.js flow / gotchas
- **Requires the Hotspot to be onboarded** (`iotInfo` must exist) — the inverse
  of onboard's guard. Missing `iotInfo` → `{ error, not_onboarded }`.
- **Merkle tree comes from the asset** (`asset.compression.tree`), NOT from
  `DataOnlyConfig`. Full (PoC) Hotspots can live on a different tree than the
  data-only tree, so reading the config tree would break them.
- **Ownership gate:** `asset.ownership.owner` (DAS) must equal `owner`, else 403.
  `update_iot_info_v0` requires `hotspot_owner` to sign; this turns an opaque
  on-chain failure into a clear error and catches a transfer mid-flight.
- **v0 message + Helium common LUT** (`HELIUM_COMMON_LUT`, fetched via
  `connection.getAddressLookupTable`) instead of a legacy message — the proof
  remaining-accounts can push a legacy txn past the 1232-byte cap on
  shallow-canopy trees. Falls back to no-LUT v0 if the LUT fetch returns null.
- **DC fee rule:** only a *location* change burns DC (full vs data-only differ);
  elevation/gain-only updates are free. build.js proactively reads the owner's DC
  ATA balance when location is dirty and returns `dc_needed` before the user
  signs a doomed txn (the frontend also gates on this and offers `DcMintModal`).
- **location is hex, not decimal.** `encodeOptionU64` does `BigInt("0x"+hex)`.
  (iot-onboard converts hex→decimal only because the dewi HTTP API wants decimal;
  the local instruction builder does not.)
- **Validate with `?simulate=1` before trusting the builder.** A clean
  `simulateTransaction` (sigVerify:false, replaceRecentBlockhash:true) showing the
  `iot_info` write confirms both the account ordering and the Borsh arg order. A
  deserialization error ⇒ wrong arg order; ConstraintSeeds/AccountNotInitialized
  ⇒ wrong account slot.

## Frontend (`pages/public/src/update-location/`)
- `UpdateLocation.jsx` — wallet gate (`WalletMultiButton`) + fleet load via
  `fetchFleet` (`lib/walletDashboardApi.js`), filtered to IoT, then the list or
  the editor. Wrapped in `SolanaProvider` in `main.jsx`.
- `HotspotList.jsx` — searchable list of the wallet's IoT Hotspots.
- `UpdatePanel.jsx` — the editor. Adapts the iot-onboard location picker
  (MapLibre draggable pin + H3 res-12 hex overlay, geolocate, ground-elevation
  autofill). Seeds the map/fields from `/status`'s current values, tracks
  per-field **dirty** state so only changed fields are sent (a gain-only change
  skips the DC fee), reads the wallet's DC balance to gate the location-fee path
  (offering `DcMintModal`), and signs via `signAndBroadcast` + `confirmAndVerify`
  (from `dc-mint`). On success: Solscan + in-app map links, then re-reads `/status`.
- `lib/updateLocationApi.js` — `fetchHotspotStatus`, `buildUpdate`.

## Reused from other tools
- `worker/src/lib/helium-solana.js` — PDAs, `fetchAsset`/`fetchAssetProof`/
  `getCanopyDepth`, `encodeOption*`, `anchorDiscriminator`, `treeAuthorityKey`,
  `ataAddress`, `HELIUM_COMMON_LUT`, `decodeCompressionHash`.
- `iot-onboard/services/fees.js` — `getOnboardFees` (KV key `iot-onboard:fees:v1`,
  refreshed by iot-onboard's existing cron; this tool only reads it).
- `hotspot-claimer/services/common.js` — `fetchAccount`.
- `wallet-dashboard` `/fleet` — the wallet's Hotspot list.
- `dc-mint` — `DcMintModal`, `DC_MINT`, `confirmAndVerify`.

## Environment / Secrets
- `SOLANA_RPC_URL` — Helius staked endpoint for on-chain reads, DAS, and the LUT
  (never log or expose).
- `KV` — used indirectly via the shared `iot-onboard:fees:v1` fee cache.
