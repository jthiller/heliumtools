# OUI Notifier

A Cloudflare Worker-based service for monitoring Helium OUI (Organizational Unique Identifier) Data Credit balances and sending alerts when balances are running low.

## Overview

The OUI Notifier:
- Syncs all OUIs from the Helium network daily
- Records DC balance snapshots for historical tracking
- Sends **daily webhook payloads** with current balance and estimated days remaining
- Sends **threshold-based email alerts** when balances approach depletion (14, 7, or 1 day remaining)

## API Endpoints

All endpoints are prefixed with `/oui-notifier/`.

### `GET /health`
Health check endpoint.

**Response:**
```json
{ "ok": true, "tool": "oui-notifier" }
```

---

### `GET /balance`
Fetch current balance for an OUI or escrow account. **Read-only** - does not modify the database.

**Query Parameters:**
- `oui` (optional): OUI number to look up
- `escrow` (optional): Escrow account address (Solana base58)

At least one parameter is required.

**Response:**
```json
{
  "oui": 1,
  "escrow": "...",
  "balance_dc": 1234567890,
  "balance_usd": 12345.67,
  "zero_balance_dc": 3500000,
  "zero_balance_usd": 35,
  "timeseries": [
    { "date": "2024-12-01", "balance_dc": 1234567890, "fetched_at": "..." }
  ]
}
```

---

### `GET /timeseries`
Fetch balance history for an OUI.

**Query Parameters:**
- `oui` (required): OUI number

**Response:**
```json
{
  "oui": 1,
  "timeseries": [...]
}
```

---

### `GET /ouis`
List all known OUIs from the database.

**Response:**
```json
{
  "ouis": [
    { "oui": 1, "owner": "...", "payer": "...", "escrow": "...", ... }
  ]
}
```

---

### `POST /subscribe`
Subscribe to balance alerts for an escrow account.

**Content-Type:** `application/x-www-form-urlencoded`

**Form Fields:**
- `email` (required): Email address for notifications
- `escrow_account` (required): Solana escrow token account
- `label` (optional): Friendly label for the subscription
- `webhook_url` (optional): URL for daily webhook payloads

**Response:** Plain text confirmation message.

---

### `GET /verify`
Verify an email address for a subscription.

**Query Parameters:**
- `token`: Verification token from email
- `email`: Email address to verify

---

### `GET /api/user/{uuid}`
Get user subscription data by UUID.

### `DELETE /api/user/{uuid}`
Delete a user and all their subscriptions.

### `POST /api/subscription/{id}`
Update a subscription (label, webhook URL).

### `DELETE /api/subscription/{id}`
Delete a specific subscription.

---

### `POST /update-ouis` / `POST /update-ouis/{oui}`
Manually trigger OUI sync and balance fetch. Without an OUI parameter, syncs all OUIs; with a specific OUI, syncs just that one.

---

## Cron Tasks

### Scheduled Job (Every 6 Hours)

The worker runs a scheduled job every 6 hours (UTC 00:00, 06:00, 12:00, 18:00).

**Every run (4x/day):**
1. **Syncs all OUIs** from `entities.nft.helium.io`
2. **Records balance snapshots** for every OUI in the `oui_balances` table
3. **Records balances** for each subscribed escrow in the `balances` table

**Once per day (first run of the day for each subscription):**
4. **Sends webhook payload** (if URL configured) with:
   ```json
   {
     "escrowAccount": "...",
     "label": "My OUI",
     "currentBalanceDC": 1234567890,
     "currentBalanceUSD": 12345.67,
     "avgDailyBurnDC": 100000,
     "daysRemaining": 45.6,
     "timestamp": "2024-12-05T00:00:00.000Z"
   }
   ```
5. **Sends email alert** only when crossing a threshold (14, 7, or 1 day remaining)
6. **Prunes old balance history** (keeps 30 days)

### Webhook vs Email Behavior

| Notification Type | When Sent |
|-------------------|-----------|
| **Webhook** | Every day (if webhook URL configured) |
| **Email** | Only when balance crosses 14, 7, or 1 day threshold |

---

## Database Schema

### `users`
User accounts for managing subscriptions.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| email | TEXT | User email (unique) |
| verified | INTEGER | Email verified (0/1) |
| uuid | TEXT | Public identifier for API access |

### `subscriptions`
User subscriptions to escrow accounts.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| user_id | INTEGER | FK to users |
| escrow_account | TEXT | Solana escrow address |
| label | TEXT | User-friendly label |
| webhook_url | TEXT | Daily webhook URL |
| last_notified_level | INTEGER | Last threshold email sent (1/7/14) |
| last_balance_dc | REAL | Last known balance |

### `balances`
Per-subscription daily balance history.

| Column | Type | Description |
|--------|------|-------------|
| subscription_id | INTEGER | FK to subscriptions |
| date | TEXT | Date (YYYY-MM-DD) |
| balance_dc | REAL | Balance in Data Credits |

### `ouis`
Catalog of all OUIs on the network.

| Column | Type | Description |
|--------|------|-------------|
| oui | INTEGER | OUI number (unique) |
| owner | TEXT | Owner wallet |
| payer | TEXT | Payer wallet |
| escrow | TEXT | Escrow token account |

### `oui_balances`
Daily balance snapshots for all OUIs (for charts, regardless of subscription).

| Column | Type | Description |
|--------|------|-------------|
| oui | INTEGER | FK to ouis |
| date | TEXT | Date (YYYY-MM-DD) |
| balance_dc | REAL | Balance in Data Credits |
| fetched_at | TEXT | ISO timestamp |

---

## Configuration

### Environment Variables (wrangler.jsonc)

| Variable | Description |
|----------|-------------|
| `FROM_EMAIL` | Sender email for alerts |
| `APP_BASE_URL` | Base URL for the frontend app |
| `APP_NAME` | Name shown in email subject lines |

### Secrets (set via `wrangler secret put`)

| Secret | Description |
|--------|-------------|
| `RESEND_API_KEY` | API key for Resend email service |
| `SOLANA_RPC_URL` | Solana RPC endpoint for balance lookups |

---

## Development

```bash
cd worker
npm install
npm run dev  # Starts wrangler dev server on :8787
```

### Testing the daily cron

Use wrangler's test scheduled mode:
```bash
wrangler dev --test-scheduled
```

Then trigger with:
```bash
curl "http://localhost:8787/__scheduled?cron=0+1+*+*+*"
```
