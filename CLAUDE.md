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
- **Boxes use shadow, not borders.** Raised content cards/panels/modals/popovers are defined by the layered `shadow-soft` utility (and `shadow-soft-lg` for hover/floating elevation), not a `border border-border`. The shadow is a dark-mode-aware CSS variable (`--shadow-card` / `--shadow-card-lg` in `index.css`). Borders still belong on non-box elements: inputs, buttons, pills/tags, internal dividers (`border-b`, `divide-*`), and recessed `bg-surface-inset` panels.

### Worker (`worker/`)
- Cloudflare Worker with D1 binding (`DB`), KV binding (`KV`), and a `MultiGatewayHub` Durable Object binding (`MULTI_GATEWAY_HUB`, used by Multi-Gateway). No R2 binding — IoT-onboard recovery firmware images live in a public R2 bucket referenced by a hard-coded `*.r2.dev` URL in the frontend
- Entry point: `src/index.js` (HTTP routes + `scheduled()` handler)
- Tools organized under `src/tools/` (e.g., `src/tools/oui-notifier/`)
- Schema: `worker/schema.sql`
- Shared Helium × Solana library: `src/lib/helium-solana.js` (program IDs, PDAs, instruction builders) — used by `multi-gateway`
- Cross-tool utility endpoints live under `src/tools/shared/` (prefix `/shared`), e.g. `/shared/geo` for CF-derived requester location. Frontend clients for these live in `pages/public/src/lib/sharedApi.js`.
- Cron: the 6-hourly tasks (OUI notifier, DC purchase, IoT fees, Council Discord poll) run at 00:00, 06:00, 12:00, 18:00 UTC. A separate **15-min** trigger (`*/15 * * * *`) drives the Vote tool's snapshot/history poll only — `scheduled()` in `src/index.js` branches on `event.cron` (and a `minute === 0` backstop) so the 6-hourly tasks never fire on the 15-min tick.

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
- **Always keep `worker/.dev.vars.example` in sync** — when you add, rename, or remove any env var the Worker reads (in `.dev.vars`, `wrangler.jsonc` `vars`, or code via `env.X`), update `worker/.dev.vars.example` in the same change. It is the committed, source-of-truth list of every variable, and must contain only placeholders — never real values.
- **Solana RPC**: Helius staked endpoint (Business plan, 200 RPS limit). Batch rate constants tuned in `worker/src/tools/oui-notifier/services/solana.js`

## Per-tool documentation

Each tool has its own `CLAUDE.md` next to its code, documenting both its worker and
frontend halves, cross-tool relationships, on-chain programs, and gotchas. The file
lives at the tool's logic center-of-gravity (worker dir for worker-heavy tools, the
frontend dir for frontend-heavy ones). Read the per-tool doc before working on a tool,
and keep it current: when a change alters a tool's endpoints, constants, on-chain
program IDs, cross-tool wiring, or documented behavior, update its `CLAUDE.md` in the
same commit (and add a row to the table below when you add a tool). The sections below
in this root file are a higher-level overview.

| Tool | Doc | Notes |
|---|---|---|
| Wallet Dashboard | `worker/src/tools/wallet-dashboard/CLAUDE.md` | Read-only aggregation over other tools |
| OUI Notifier | `worker/src/tools/oui-notifier/CLAUDE.md` | + `README.md` (full endpoint/API reference) |
| DC Mint | `worker/src/tools/dc-mint/CLAUDE.md` | HNT→DC burn; `DcMintModal` reused by other tools |
| Buy Data Credits | `worker/src/tools/dc-purchase/CLAUDE.md` | Fiat→DC; **disabled / Coming Soon** |
| IoT Hotspot Onboarding | `worker/src/tools/iot-onboard/CLAUDE.md` | Web Bluetooth + dewi.org onboarding proxy |
| Update Hotspot Location | `worker/src/tools/update-location/CLAUDE.md` | Wallet-driven re-assert of `update_iot_info_v0` (location/elevation/gain) on onboarded IoT Hotspots |
| Multi-Gateway | `worker/src/tools/multi-gateway/CLAUDE.md` | Live packet dashboard; runs the `jthiller/multi-gateway` fork |
| Hotspot Reward Claimer | `worker/src/tools/hotspot-claimer/CLAUDE.md` | Treasury-subsidized reward claims |
| L1 Migration | `worker/src/tools/l1-migration/CLAUDE.md` | Broadcasts pre-signed migration txns |
| veHNT Positions | `worker/src/tools/ve-hnt/CLAUDE.md` | Governance lockup analyzer |
| Vote (Proposal Viewer) | `worker/src/tools/vote/CLAUDE.md` | **Blind page** — live vote activity, outcomes + 7-day trend chart. Worker cron-polls the RPC and serves all viewers from a KV snapshot + D1 history (no per-viewer RPC) |
| Council | `worker/src/tools/council/CLAUDE.md` | **Blind page** - Discord #advisory-council nominees; worker-side bot poll (6-hourly cron) with a manual admin-token push override |
| Hotspot Map | `pages/public/src/hotspot-map/CLAUDE.md` | Frontend-heavy; deck.gl/MapLibre map |
| Shared utilities | `worker/src/tools/shared/CLAUDE.md` | Tool-agnostic `/shared` endpoints |

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
- Two onboard modes: **full** (PoC eligible, base 1M + 100k location DC) and **data-only** (base 50k + 50k location DC)
- Stale-firmware Hotspots return short ASCII error strings instead of signed binary; surfaced as `StaleFirmwareError` with a link to a recovery firmware image (a hard-coded public `*.r2.dev` URL in the frontend, not served by the worker)
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
- `plotLeftFor`, `PLOT_RIGHT`, and `PULSE_DURATION_MS` are exported and consumed by `EventsBar` so the two surfaces' time axes line up to the pixel.

### Layout invariants
- Chart and events bar share the same `px-2` horizontal inset and the same xDomain prop. Don't change one without checking both.
- Sibling components rendered with `key={mac}` need *unique* keys among siblings (use `scatter-${mac}`, `events-${mac}`) — duplicate keys leak old DOM on Hotspot switch.
- `GatewayDetail` is `memo`'d. Hover-induced re-renders still pass through (the table needs hover for row highlighting), but other parent state changes (the 1Hz `nowTick` heartbeat) skip it.

## Wallet Dashboard — Key Concepts

Read-only, full-screen bento overview of any wallet (`/wallet-dashboard/:address`, with `?wallet=` accepted and redirected to the canonical path). No wallet connect. It's a thin **aggregation layer** that reuses other tools' primitives rather than re-implementing on-chain logic.

- **Worker** (`worker/src/tools/wallet-dashboard/`, prefix `/wallet-dashboard`): `GET /summary` (balances + USD prices + fleet stats, KV-cached ~60s), `GET /fleet` (full per-Hotspot list, KV-cached ~120s, shared with /summary), `GET /transactions` (categorized via Helius enhanced API, `getSignaturesForAddress` fallback), `POST /rewards` (batched ≤50 pending+lifetime rewards; reuses the claimer's `getBulkPendingRewards` but KV-caches per-batch ~15min and is cache-first — rewards distribute ~daily). The client also calls `/ve-hnt/positions` directly. The dashboard does NOT use the shared `/hotspot-claimer/wallet/rewards` (that must stay live/uncached for claims).
- **Prices** (`services/prices.js`): Pyth Hermes multi-feed (HNT/MOBILE/SOL) + **Jupiter Price API v3** by mint for IOT (no Pyth feed) + DC fixed (100,000 DC = $1). **CoinGecko is intentionally avoided — it blocks Worker egress IPs.**
- **Activity is rewards-derived, never `is_active`** (the Entity API field is always false — see memory). A Hotspot with zero lifetime rewards is "idle". Lifetime/claimed come from the additive fields in `hotspot-claimer/services/oracle.js` `computeTokenResult`.
- IoT data-only vs full is inferred from the onboarding fee (`< IOT_DATA_ONLY_FEE_MAX`, 500,000 DC, ⇒ data-only — sits between the ~50k data-only and ~1M full fees). Coordinates are decoded client-side from each row's H3 `location` (the Entity API lat/long is sparsely populated).
- **Frontend** (`pages/public/src/wallet-dashboard/`): `WalletDashboard.jsx` (bento shell + URL-as-source-of-truth), `FleetMap.jsx` (deck.gl/MapLibre, adapted from Hotspot Map), `useFleetRewards.js` (progressive 50-batch reward fan-out to the cached `/rewards`, concurrency 3), `cards/*.jsx`, `format.js`. No SolanaProvider (read-only).

## Deployment

Both Pages and Worker auto-deploy from the `main` branch — any merge or direct push to `main` ships to production. There is no staging gate between commit and prod, so treat every commit to `main` as a production release. `wrangler deploy --env production` is only needed for out-of-band force deploys (e.g., config rollbacks).
