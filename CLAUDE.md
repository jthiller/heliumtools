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
- Cloudflare Worker with D1 binding (`DB`), KV binding (`KV`)
- Entry point: `src/index.js` (HTTP routes + `scheduled()` handler)
- Tools organized under `src/tools/` (e.g., `src/tools/oui-notifier/`)
- Schema: `worker/schema.sql`
- Shared Helium × Solana library: `src/lib/helium-solana.js` (program IDs, PDAs, instruction builders)
- Cron runs 4x/day: 00:00, 06:00, 12:00, 18:00 UTC

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

# Deploy worker (production)
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

### BLE Connection (Phase 1)
- Uses Web Bluetooth API to connect to Helium IoT Hotspots running `gateway-config` firmware
- GATT service UUID: `0fda92b2-44a2-4af2-84f5-fa682baa2b8d`
- Characteristics defined in `src/iot-onboard/bleTypes.js`, protobuf in `bleProto.js`
- **BLE reads must be sequential** — parallel reads cause "GATT operation failed" errors
- Not all characteristics exist on all firmware variants — each read is wrapped in try/catch (`safeRead`)
- Some Hotspots have time-limited BLE sessions — liveness polling detects silent disconnects

### On-Chain Onboarding (Phase 2)
- Two-step process: **Issue** (create compressed NFT entity) → **Onboard** (register on IoT network)
- Transaction building happens **server-side** in the worker (`src/tools/iot-onboard/`)
- Shared Solana program logic in `worker/src/lib/helium-solana.js` (used by both `iot-onboard` and `multi-gateway`)
- Maker lookup proxied through worker: queries `onboarding.dewi.org`, checks maker DC balance on-chain
- Two onboard modes: **full** (PoC eligible, 4M DC) and **data-only** (1M DC)
- BLE ADD_GATEWAY characteristic gets ECC chip signature → sent to `ecc-verifier.web.helium.io`
- Location assertion uses H3 resolution-12 cells

### Helium-Solana Shared Library (`worker/src/lib/helium-solana.js`)
- All Helium program IDs, token mints, and static PDAs (computed once at module load)
- `buildIssueInstruction()` — `issueDataOnlyEntityV0` with 19 accounts
- `buildOnboardInstruction()` — supports both `onboard_data_only_iot_hotspot_v0` and `onboard_iot_hotspot_v0` via `opts.mode`
- DAS helpers: `fetchAsset()`, `fetchAssetProof()`, `getCanopyDepth()`
- Anchor discriminators, Borsh Option encoding

## L1 Migration

- Server-side transaction handling at `worker/src/tools/l1-migration/`
- Fetches pre-signed transactions from `migration.web.helium.io`, broadcasts via worker's `SOLANA_RPC_URL`
- Supports both Helium B58 and Solana base58 address formats (manual checksum verification, no `@helium/address` dependency in worker)
- Polls `getSignatureStatuses` in batches of 256, sends in batches of 50

## Deployment

- **Pages**: Cloudflare Pages — auto-deploys from `main` branch
- **Worker**: Cloudflare Workers — requires manual deploy: `cd worker && wrangler deploy --env production`
