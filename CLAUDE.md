# CLAUDE.md

## Project Overview

heliumtools.org — operator utilities for the Helium network. Two deployable units:

- **`pages/`** — Cloudflare Pages static site (Vite + React). Landing page at `pages/public/src/pages/Landing.jsx` defines all tools.
- **`worker/`** — Cloudflare Worker API + cron (api.heliumtools.org). D1 (SQLite) database, Resend for email, Solana RPC for on-chain balances.

## Architecture

### Frontend (`pages/public/`)
- React + Vite, Tailwind CSS
- Routes defined in `src/main.jsx` (React Router)
- Tool listing hardcoded in `src/pages/Landing.jsx` features array
- Each tool has its own directory: `src/oui-notifier/`, `src/dc-purchase/`, `src/l1-migration/`, `src/iot-onboard/`, `src/multi-gateway/`
- Tools needing Solana wallets are wrapped in `SolanaProvider` in `main.jsx`

### Worker (`worker/`)
- Cloudflare Worker with D1 binding (`DB`), KV binding (`KV`), R2 binding (`FIRMWARE`) for hosted Hotspot images
- Entry point: `src/index.js` (HTTP routes + `scheduled()` handler)
- Tools organized under `src/tools/` (e.g., `src/tools/oui-notifier/`)
- Schema: `worker/schema.sql`
- Shared Helium × Solana library: `src/lib/helium-solana.js` (program IDs, PDAs, instruction builders) — used by `multi-gateway`
- Cross-tool utility endpoints live under `src/tools/shared/` (prefix `/shared`), e.g. `/shared/geo` for CF-derived requester location. Frontend clients for these live in `pages/public/src/lib/sharedApi.js`.
- Cron runs 4x/day: 00:00, 06:00, 12:00, 18:00 UTC

### When to put something in `shared/` vs a specific tool
Default to the tool's own directory. Hoist to `shared/` only when:
1. **The code is not tool-specific** — it has no knowledge of any one tool's domain (e.g., gateways, OUIs, L1 migration). Reading `request.cf` or validating a Solana address qualifies; fetching gateway packets does not.
2. **Two tools are actually consuming it, or one has a concrete imminent need.** Speculative "might reuse this someday" doesn't count. One caller isn't enough — leave the utility with that caller until a second tool has code that wants it. Hoisting on a hunch creates a "shared" bucket that accumulates dead code.
3. **The shape is stable.** If the API is still being iterated on, let it bake inside the tool first. Hoisting signals "don't change this casually."

When hoisting, mirror the path on both sides: `worker/src/tools/shared/<handler>` ↔ `pages/public/src/lib/sharedApi.js` ↔ route prefix `/shared`. Don't create an ad-hoc top-level worker route outside `tools/` — the prefix router in `src/index.js` is the single dispatch point.

### Environments
- **Dev**: D1 `heliumtools-dev`, email from `alerts-dev@heliumtools.org`
- **Production**: D1 `heliumtools-prod`, email from `alerts@heliumtools.org`, routes to `api.heliumtools.org`
- Secrets (`RESEND_API_KEY`, `SOLANA_RPC_URL`, `ADMIN_TOKEN`) set via `wrangler secret put` — **never commit or log these values**
- **Solana RPC**: Helius staked endpoint (Business plan, 200 RPS limit). Batch rate constants tuned in `worker/src/tools/oui-notifier/services/solana.js`

## Common Commands

```bash
# Frontend dev
cd pages/public && npm run dev

# Worker dev
cd worker && wrangler dev

# Query production D1
cd worker && npx wrangler d1 execute heliumtools-prod --env production --remote --command "SELECT ..."

# Force-deploy worker (production) — normally not needed; main pushes auto-deploy
cd worker && wrangler deploy --env production

# Tail production logs
cd worker && npx wrangler tail --env production
```

## OUI Notifier — Key Concepts

### Notification Escalation
Alert thresholds fire at **14, 7, and 1 days remaining**. The `last_notified_level` field on subscriptions tracks which threshold was last sent. Escalation order: 0 (none) → 14 → 7 → 1. A 20% balance increase resets `last_notified_level` to 0 (top-up detection).

### Burn Rate
- **1-day**: most recent segment between consecutive balance snapshots, normalized to per-day
- **30-day**: total burn across all data / total time span
- Days remaining uses `Math.max(burn30d, burn1d)` — whichever is higher (more conservative)
- Effective balance = `balance - ZERO_BALANCE_DC` (3,500,000 DC / $35 floor)

### Database Tables
- `users` — email, verified flag, uuid
- `subscriptions` — links user to escrow_account, tracks `last_notified_level`, `last_balance_dc`
- `ouis` — catalog of all OUIs (oui, owner, payer, escrow, delegate_keys)
- `oui_balances` — daily DC balance snapshots per OUI (used for burn rate + charts)

## IoT Hotspot Onboarding — Key Concepts

### BLE Connection
- Uses Web Bluetooth API to connect to Helium IoT Hotspots running `gateway-config` firmware
- GATT service UUID: `0fda92b2-44a2-4af2-84f5-fa682baa2b8d`
- Characteristics defined in `src/iot-onboard/bleTypes.js`, protobuf in `bleProto.js`
- **BLE reads must be sequential** — parallel reads cause "GATT operation failed" errors
- Not all characteristics exist on all firmware variants — each read is wrapped in try/catch (`safeRead`)
- Some Hotspots have time-limited BLE sessions — liveness polling detects silent disconnects
- ADD_GATEWAY uses write+poll-read (not notify): write encoded protobuf, then poll `readValue()` every 500ms; firmware returns `init`/`processing` ASCII strings during ECC signing, then the signed AddGatewayV1 binary

### On-Chain Onboarding
- Two-step process: **Issue** (create compressed NFT entity) → **Onboard** (register on IoT network)
- Worker forwards both steps to `onboarding.dewi.org/api/v3` (`/transactions/create-hotspot`, `/transactions/iot/onboard`) — that service handles ECC verification and returns ready-to-broadcast txns. The worker does **not** build these txns locally.
- Some returned txns are fully pre-signed (maker + ECC verifier); others need the user's wallet. `signAndBroadcast` in `IotOnboard.jsx` inspects `header.numRequiredSignatures` to decide.
- Maker lookup proxied through worker: queries `onboarding.dewi.org`, checks maker DC balance on-chain. Pass `user_pays: true` to onboard endpoint only when maker DC is insufficient — otherwise omit `payer` so the maker covers SOL fees too.
- Helium → Solana address conversion: bs58 decode, slice bytes `[2, 34)` (skip version + net_type, drop checksum)
- Two onboard modes: **full** (PoC eligible, 4M DC) and **data-only** (1M DC)
- Stale-firmware Hotspots return short ASCII error strings instead of signed binary; surfaced as `StaleFirmwareError` with a link to the firmware image hosted in R2
- Location assertion uses H3 resolution-12 cells; on-chain fees cached in KV with 6h cron refresh (`services/fees.js`)

### Helium-Solana Shared Library (`worker/src/lib/helium-solana.js`)
- All Helium program IDs, token mints, and static PDAs (computed once at module load)
- `buildIssueInstruction()` / `buildOnboardInstruction()` — used by `multi-gateway` only; `iot-onboard` delegates to the Helium onboarding server
- DAS helpers: `fetchAsset()`, `fetchAssetProof()`, `getCanopyDepth()`
- Anchor discriminators, Borsh Option encoding

## L1 Migration

- Server-side transaction handling at `worker/src/tools/l1-migration/`
- Fetches pre-signed transactions from `migration.web.helium.io`, broadcasts via worker's `SOLANA_RPC_URL`
- Supports both Helium B58 and Solana base58 address formats (manual checksum verification, no `@helium/address` dependency in worker)
- Polls `getSignatureStatuses` in batches of 256, sends in batches of 50

## Multi-Gateway — Key Concepts

### Architecture
- Live operator dashboard for a fleet of Hotspots: gateway list (top), per-Hotspot inspector card on selection.
- Inspector card stacks: header → unified filter row → canvas RSSI scatter chart → SVG events bar (joins/downlinks) → packet table. All four share the same hover state so a chart hover highlights the corresponding row in the table and the matching event marker, and vice versa.
- Live packet ingestion via SSE (`worker/src/tools/multi-gateway/`). Each packet gets `_id` (monotonic, parent-assigned) and `_new: true` for SSE-delivered vs `false` for initial fetch.

### Client-side segmentation (`segmentation.js`)
- Two devices can share a DevAddr, so the chart groups packets into "tracks" by frame-counter continuity (`FCNT_GAP_MAX = 64`, with wrap support near the 16-bit top). RSSI is a tie-breaker only (`RSSI_HARD_LIMIT_DBM = 15`).
- Joins/downlinks aren't track-correlatable (joins have no dev_addr; downlinks use a separate counter), so they're bucketed into synthetic `joins` / `downlinks` track ids and rendered in the events bar instead of the scatter chart.
- Pure module — no React deps; callers hold state in a ref and call `ingest()` / `ingestBatch()`.

### Canvas chart (`PacketScatter.jsx`)
- Hand-rolled `<canvas>` (replaced recharts; PR #53). Single rAF loop reads from a `stateRef` so prop churn doesn't tear it down.
- xMax anchored to `Date.now()` per frame for smooth live-time scrolling; xMin stays at the earliest visible packet.
- Hover band uses a proportionally-damped Catmull-Rom interpolation — both x and y tangent components scale by the same factor when the natural offset would extend past the next point, preventing overshoot/loops on irregular timing without flattening normal curves.
- Sticky-band hover: `pointInBand()` keeps the highlight while the cursor is inside the band envelope; tooltip anchors to the closest dot in the hovered track.
- New-packet pulse keys off the parent's `_new` flag; first non-empty load is snapshotted as "already seen" so initial render and Hotspot switches don't pulse en masse.
- `PLOT_LEFT`, `PLOT_RIGHT`, and `PULSE_DURATION_MS` are exported and consumed by `EventsBar` so the two surfaces' time axes line up to the pixel.

### Layout invariants
- Chart and events bar share the same `px-2` horizontal inset and the same xDomain prop. Don't change one without checking both.
- Sibling components rendered with `key={mac}` need *unique* keys among siblings (use `scatter-${mac}`, `events-${mac}`) — duplicate keys leak old DOM on Hotspot switch.
- `GatewayDetail` is `memo`'d. Hover-induced re-renders still pass through (the table needs hover for row highlighting), but other parent state changes (the 1Hz `nowTick` heartbeat) skip it.

## Deployment

Both Pages and Worker auto-deploy from the `main` branch — any merge or direct push to `main` ships to production. There is no staging gate between commit and prod, so treat every commit to `main` as a production release. `wrangler deploy --env production` is only needed for out-of-band force deploys (e.g., config rollbacks).
