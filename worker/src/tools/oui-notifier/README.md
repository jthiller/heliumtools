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

Base URL: `https://api.heliumtools.org/oui-notifier`

### `GET /health`
Health check endpoint.

**Example:**
```bash
curl "https://api.heliumtools.org/oui-notifier/health"
```

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

**Example - by OUI:**
```bash
curl "https://api.heliumtools.org/oui-notifier/balance?oui=1"
```

**Example - by escrow:**
```bash
curl "https://api.heliumtools.org/oui-notifier/balance?escrow=FfUwicjJe5G1hkbDKCZ9NzjBT57RkQFvUZKXFXqXFXrV"
```

**Response:**
```json
{
  "oui": 1,
  "escrow": "FfUwicjJe5G1hkbDKCZ9NzjBT57RkQFvUZKXFXqXFXrV",
  "balance_dc": 892145678900,
  "balance_usd": 8921456.79,
  "burn_rate": {
    "burn_1d_dc": 5000000,
    "burn_1d_usd": 50.00,
    "burn_30d_dc": 4500000,
    "burn_30d_usd": 45.00
  },
  "zero_balance_dc": 3500000,
  "zero_balance_usd": 35,
  "timeseries": [
    { "date": "2024-12-01", "balance_dc": 895000000000, "fetched_at": "2024-12-01T00:00:05.123Z" },
    { "date": "2024-12-02", "balance_dc": 894500000000, "fetched_at": "2024-12-02T00:00:04.456Z" },
    { "date": "2024-12-03", "balance_dc": 893800000000, "fetched_at": "2024-12-03T00:00:03.789Z" }
  ]
}
```

> **Note**: `burn_rate` values may be `null` if insufficient historical data is available or if no burn has occurred (only balance increases/top-ups).

---

### `GET /timeseries`
Fetch balance history for an OUI.

**Query Parameters:**
- `oui` (required): OUI number

**Example:**
```bash
curl "https://api.heliumtools.org/oui-notifier/timeseries?oui=1"
```

**Response:**
```json
{
  "oui": 1,
  "timeseries": [
    { "date": "2024-12-01", "balance_dc": 895000000000, "fetched_at": "2024-12-01T00:00:05.123Z" },
    { "date": "2024-12-02", "balance_dc": 894500000000, "fetched_at": "2024-12-02T00:00:04.456Z" }
  ]
}
```

---

### `GET /ouis`
List all known OUIs from the database.

**Example:**
```bash
curl "https://api.heliumtools.org/oui-notifier/ouis"
```

**Response:**
```json
{
  "orgs": [
    {
      "oui": 1,
      "owner": "13tyMLKRFYURNBQqLSqNJg...",
      "payer": "13tyMLKRFYURNBQqLSqNJg...",
      "escrow": "FfUwicjJe5G1hkbDKCZ9NzjBT57RkQFvUZKXFXqXFXrV",
      "locked": false,
      "delegate_keys": [],
      "last_synced_at": "2024-12-05T00:00:01.234Z"
    },
    {
      "oui": 2,
      "owner": "14bXg8PbFJLcFkTiM7eCMy...",
      "payer": "14bXg8PbFJLcFkTiM7eCMy...",
      "escrow": "7xKXtg2CW87d97TXJSDpbD...",
      "locked": false,
      "delegate_keys": ["delegate1", "delegate2"],
      "last_synced_at": "2024-12-05T00:00:01.234Z"
    }
  ]
}
```

---

### `GET /known-ouis`
Fetch all well-known OUIs with their current balance, burn rate, and days remaining.

This endpoint returns only OUIs from the [Helium well-known list](https://github.com/helium/well-known/blob/main/lists/ouis.json), enriched with stats from the local database.

**Example:**
```bash
curl "https://api.heliumtools.org/oui-notifier/known-ouis"
```

**Response:**
```json
{
  "ouis": [
    {
      "oui": 1,
      "name": "Helium Foundation Console",
      "balance_dc": 892145678900,
      "balance_usd": 8921456.79,
      "burn_1d_dc": 5000000,
      "burn_1d_usd": 50.00,
      "days_remaining": 120.5,
      "updated_at": "2024-12-05T00:00:01.234Z"
    },
    {
      "oui": 2,
      "name": "Nova Dev Console",
      "balance_dc": 12345678,
      "balance_usd": 123.45,
      "burn_1d_dc": 100000,
      "burn_1d_usd": 1.00,
      "days_remaining": 88.5,
      "updated_at": "2024-12-05T00:00:01.234Z"
    }
  ],
  "fetched_at": "2024-12-05T16:45:00.000Z"
}
```

> **Note**: Values may be `null` if the OUI is not yet in the local database or has insufficient balance history.

---

### `POST /subscribe`
Subscribe to balance alerts for an escrow account.

**Content-Type:** `application/x-www-form-urlencoded`

**Form Fields:**
- `email` (required): Email address for notifications
- `escrow_account` (required): Solana escrow token account
- `label` (optional): Friendly label for the subscription
- `webhook_url` (optional): URL for daily webhook payloads

**Example:**
```bash
curl -X POST "https://api.heliumtools.org/oui-notifier/subscribe" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=alerts@example.com" \
  -d "escrow_account=FfUwicjJe5G1hkbDKCZ9NzjBT57RkQFvUZKXFXqXFXrV" \
  -d "label=Production OUI" \
  -d "webhook_url=https://example.com/webhook"
```

**Response:** Plain text confirmation message.
```
Subscription saved. Please check your inbox to verify your email before alerts are sent.
```

---

### `GET /verify`
Verify an email address for a subscription. (Called via link in verification email)

**Query Parameters:**
- `token`: Verification token from email
- `email`: Email address to verify

**Example:**
```bash
curl "https://api.heliumtools.org/oui-notifier/verify?token=abc123&email=alerts@example.com"
```

---

### `GET /api/user/{uuid}`
Get user subscription data by UUID. (UUID is provided in email links)

**Example:**
```bash
curl "https://api.heliumtools.org/oui-notifier/api/user/550e8400-e29b-41d4-a716-446655440000"
```

**Response:**
```json
{
  "user": { "id": 1, "uuid": "550e8400-e29b-41d4-a716-446655440000" },
  "subscriptions": [
    {
      "id": 1,
      "escrow_account": "FfUwicjJe5G1hkbDKCZ9NzjBT57RkQFvUZKXFXqXFXrV",
      "label": "Production OUI",
      "webhook_url": "https://example.com/webhook",
      "created_at": "2024-12-01T10:00:00.000Z",
      "oui": 1
    }
  ]
}
```

### `DELETE /api/user/{uuid}`
Delete a user and all their subscriptions.

**Example:**
```bash
curl -X DELETE "https://api.heliumtools.org/oui-notifier/api/user/550e8400-e29b-41d4-a716-446655440000"
```

### `POST /api/subscription/{id}`
Update a subscription (label, webhook URL).

**Example:**
```bash
curl -X POST "https://api.heliumtools.org/oui-notifier/api/subscription/1" \
  -H "Content-Type: application/json" \
  -H "X-User-Uuid: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"label": "Updated Label", "webhook_url": "https://new-webhook.example.com"}'
```

### `DELETE /api/subscription/{id}`
Delete a specific subscription.

**Example:**
```bash
curl -X DELETE "https://api.heliumtools.org/oui-notifier/api/subscription/1" \
  -H "X-User-Uuid: 550e8400-e29b-41d4-a716-446655440000"
```

---

### `POST /update-ouis` / `POST /update-ouis/{oui}`
Manually trigger OUI sync and balance fetch. Without an OUI parameter, syncs all OUIs; with a specific OUI, syncs just that one.

**Example - sync all OUIs:**
```bash
curl -X POST "https://api.heliumtools.org/oui-notifier/update-ouis"
```

**Example - sync specific OUI:**
```bash
curl -X POST "https://api.heliumtools.org/oui-notifier/update-ouis/1"
```

**Response:**
```json
{
  "ok": true,
  "updated": true,
  "oui": 1,
  "escrow": "FfUwicjJe5G1hkbDKCZ9NzjBT57RkQFvUZKXFXqXFXrV",
  "balance_dc": 892145678900,
  "updated_at": "2024-12-05T16:45:00.000Z"
}
```

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
     "burn1dDC": 5000000,
     "burn1dUSD": 50.00,
     "burn30dDC": 4500000,
     "burn30dUSD": 45.00,
     "daysRemaining": 45.6,
     "timestamp": "2024-12-05T00:00:00.000Z"
   }
   ```
   > Burn rate values are `null` if insufficient data is available.
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
