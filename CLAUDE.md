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
- Each tool has its own directory: `src/oui-notifier/`, `src/dc-purchase/`, `src/l1-migration/`

### Worker (`worker/`)
- Cloudflare Worker with D1 binding (`DB`), KV binding (`KV`)
- Entry point: `src/index.js` (HTTP routes + `scheduled()` handler)
- Tools organized under `src/tools/` (e.g., `src/tools/oui-notifier/`)
- Schema: `worker/schema.sql`
- Cron runs 4x/day: 00:00, 06:00, 12:00, 18:00 UTC

### Environments
- **Dev**: D1 `heliumtools-dev`, email from `alerts-dev@heliumtools.org`
- **Production**: D1 `heliumtools-prod`, email from `alerts@heliumtools.org`, routes to `api.heliumtools.org`
- Secrets (`RESEND_API_KEY`, `SOLANA_RPC_URL`) set via `wrangler secret put` — **never commit or log these values**
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

## Deployment

- **Pages**: Cloudflare Pages — auto-deploys from `main` branch
- **Worker**: Cloudflare Workers — requires manual deploy: `cd worker && wrangler deploy --env production`
