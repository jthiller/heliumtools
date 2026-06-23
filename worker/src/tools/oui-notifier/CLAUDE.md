# OUI Notifier

Monitors the Data Credit (DC) escrow balance of every Helium OUI (Organizational
Unique Identifier) and alerts before it runs dry. Email alerts fire on threshold
crossings (14 / 7 / 1 days remaining); an optional webhook fires once a day with
the full balance + burn-rate snapshot.

> **The full endpoint catalog, request/response shapes, and DB column reference live
> in [`README.md`](./README.md).** This file documents the architecture, the
> non-obvious logic, the gotchas, and the cross-tool relationships — it does **not**
> repeat the endpoint-by-endpoint reference.

## Architecture

### Worker (API) — prefix `/oui-notifier`

Entry point: `index.js` exports `handleOuiNotifierRequest` (HTTP) and
`runOuiNotifierDaily` (cron). HTTP dispatch is split:

- `index.js` peels off the `/api/user/*` and `/api/subscription/*` CRUD routes
  (the user/subscription management surface hit by the frontend dashboard) and
  delegates everything else to `httpHandlers.js`.
- `httpHandlers.js` is the main path router: `/health`, `/known-ouis`, `/ouis`,
  `/balance`, `/timeseries`, `/verify`, `/subscribe`, `/preview/*`, and the
  admin-gated `/update-ouis[/:oui]`.

**Endpoints** (see `README.md` for full detail). Two things the README does not
make obvious:
- `POST /update-ouis` and `POST /update-ouis/:oui` are **admin-gated**: they require
  `Authorization: Bearer ${ADMIN_TOKEN}` and return 503 if `ADMIN_TOKEN` is unset.
  This is the manual trigger for the same sync the cron does; the README's curl
  examples omit the header.
- `GET /balance` is **read-only** — it fetches the live on-chain balance and
  computes burn rates from stored history, but does **not** write a snapshot. Only
  the cron (and `/update-ouis`) write to `oui_balances`.

**Handlers (`handlers/`):**
- `subscribe.js` — upserts the `users` row, mints a `verify_token` + public `uuid`,
  upserts the `subscriptions` row, and emails a verification link. Validates email,
  base58 escrow, and (via `validateWebhookUrl`) blocks SSRF to private/reserved IP
  ranges.
- `verify.js` — flips `users.verified = 1`, clears the token, and 302-redirects back
  to the app with `?verified=1&uuid=...`. Only same-origin `redirect` params are
  honored (open-redirect guard).
- `balance.js` — live balance + burn rate + 30-day timeseries for one OUI/escrow.
- `timeseries.js` — stored balance history for one OUI (chart data).
- `listOuis.js` — dumps the local `ouis` catalog (`GET /ouis`).
- `knownOuis.js` — the "who's about to run out" feed: cross-references the
  helium/well-known OUI list (fetched raw from
  `https://raw.githubusercontent.com/helium/well-known/refs/heads/main/lists/ouis.json`)
  against local balance history, returns only entries with active burn AND ≤7 days
  remaining. KV-caches the GitHub list 1h. See "Key Concepts".
- `updateOuis.js` — manual sync (admin). Whole-network mode caps live balance
  fetches at `MAX_BALANCE_FETCH_PER_UPDATE` (40) for newly-discovered OUIs to stay
  under Cloudflare's subrequest limit; single-OUI mode refreshes one.
- `user.js` — `/api/user/:uuid` (GET/DELETE) and `/api/subscription/:id`
  (POST/DELETE). Auth is the `uuid` in the path **plus** a matching `X-User-Uuid`
  header (DELETE-user requires both to match — a CSRF guard against URL-only auth).
- `preview.js` — renders the email templates with sample data at `/preview/verify`
  and `/preview/alert`.

**Services (`services/`):**
- `solana.js` — fetches escrow DC balances via Solana RPC `getTokenAccountBalance`.
  `fetchEscrowBalanceDC` for one account; `fetchEscrowBalancesBatched` for the cron's
  bulk pass (JSON-RPC batches of `BATCH_SIZE=10`, `BATCH_DELAY_MS=75` between batches,
  `RATE_LIMIT_DELAY_MS=2000` back-off on 429). "Account not found" is treated as a
  0 balance (new/empty escrow), not an error.
- `burnRate.js` — pure timeseries → burn-rate function. See "Key Concepts".
- `ouis.js` — all D1 access for `ouis`/`oui_balances` (DDL bootstrap via
  `ensureOuiTables`, upserts, balance recording, history pruning, batch reads) plus
  `fetchAllOuisFromApi` which pulls the network-wide OUI catalog from
  `entities.nft.helium.io/v2/oui/all`.
- `email.js` — sends via Resend (`api.resend.com/emails`). Returns `false` (does not
  throw) on misconfig/failure so the cron continues.
- `webhook.js` — POSTs the daily JSON payload to the subscriber's URL.

**Templates (`templates/`):** `base.js` (shared HTML shell), `verify.js`,
`alert.js`. Plain string-interpolated HTML; previewable via `/preview/*`.

**Cron (`jobs/dailyJob.js`):** the cron handler. Runs on the shared worker
`scheduled()` handler (`worker/src/index.js`) every 6h (00/06/12/18 UTC). See
"The cron job" below.

### Frontend

`pages/public/src/oui-notifier/`:
- `Home.jsx` — the tool page: OUI lookup, balance/days-remaining metrics, 30-day
  recharts area chart, the subscribe form, and the logged-in "manage subscriptions"
  table. Session is the `uuid` (from the verify redirect or localStorage), not a
  password.
- `VerifyPage.jsx` (`verify.jsx` entry) — handles the `/verify` landing: bounces the
  `token`+`email` to the worker's `GET /verify`, then shows success on the
  `?verified=1` return.
- `main.jsx` — Home entry point.
- API client lives in `pages/public/src/lib/api.js` (`API_BASE`, `fetchOuiIndex`,
  `fetchBalanceForOui`, `subscribeToAlerts`); the management CRUD calls are inline
  `fetch`es in `Home.jsx`.

## Key Concepts

### Notification escalation (14 → 7 → 1)
`subscriptions.last_notified_level` tracks which threshold was last emailed
(0 = none, then 14 → 7 → 1 as urgency increases). `pickThreshold(daysRemaining,
lastNotifiedLevel)` in `utils.js` decides whether to fire and at which level. Each
threshold fires **at most once** per descent; a level only re-fires after a top-up
reset.

> **Watch the inverted comparison.** The escalation order is numerically *descending*
> (14 is least urgent, 1 is most), so the guard is
> `lastNotifiedLevel === 0 || lastNotifiedLevel > threshold`, **not** `<`. This was a
> real past bug — see "Past Bugs".

### Top-up reset (20%)
In `dailyJob.js`, if the current balance exceeds the last recorded balance by more
than 20% (`balanceDC > lastBalanceDc * 1.2`), it's treated as a top-up and
`last_notified_level` is reset to 0 — so the full alert ladder (14 → 7 → 1) can
fire again on the next descent.

### Burn rate (1-day vs 30-day) and days-remaining
`computeBurnRates()` (`burnRate.js`) ignores positive diffs (top-ups), uses
`fetched_at` timestamps when present (falls back to the `date` field at midnight UTC),
and returns two figures:
- **burn1d** — the most-recent burn segment between two consecutive snapshots,
  normalized to a per-day rate.
- **burn30d** — total burn ÷ total time span across all available data (≤30 days).

Days remaining uses **`Math.max(burn30d, burn1d)`** — the *higher* rate, deliberately
conservative so alerts fire sooner when burn is accelerating (the moment alerts
matter most). Effective balance subtracts the floor:
`daysRemaining = max(balance − ZERO_BALANCE_DC, 0) / burn`.

### Zero-balance floor
Helium halts data transfer when escrow drops to ~$35 of DC. `config.js` encodes this
as `ZERO_BALANCE_DC = 3_500_000` (`DC_TO_USD_RATE = 0.00001`, i.e. 100,000 DC = $1).
Burn math treats this floor as zero, so "days remaining" counts down to the halt
point, not to literal 0 DC.

### `/known-ouis` feed
Read-only. Pulls the curated [well-known OUI list](https://github.com/helium/well-known)
(KV-cached 1h under key `well-known-ouis`), batch-loads local catalog rows
(`getOuisByNumbers`) and balance history from the last `BURN_RATE_DAYS=2` days
(`date >= today−2`, via `getRecentBalancesForOuis`) in two queries (not N),
computes per-OUI burn, and
returns only those with active burn and ≤7 days left. Powers the "running low"
surface without requiring a subscription.

## The cron job (`jobs/dailyJob.js`)

Runs every 6h (4×/day). **Every run:**
1. `ensureOuiTables` (idempotent DDL).
2. `fetchAllOuisFromApi` → `upsertOuis` (sync the whole network catalog).
3. Collect unique escrow addresses (multiple OUIs can share one escrow), batch-fetch
   all balances via `fetchEscrowBalancesBatched`, and `recordOuiBalance` for every
   OUI sharing each escrow into `oui_balances`.
4. For each **verified** subscription, `processSubscription`: reads the escrow
   balance (from the run's cache, else a fresh RPC), computes burn from that OUI's
   `oui_balances` history, applies the top-up reset, and persists
   `last_balance_dc` / `last_notified_level`.
5. Prune `oui_balances` older than `BALANCE_HISTORY_DAYS` (30).

**Once per day per subscription** (gated by `subscriptions.last_webhook_date` ==
today): send the webhook payload (balance, burn1d/burn30d in DC+USD, daysRemaining).
The threshold **email** is independent of the webhook — it sends only when
`pickThreshold` returns a level, regardless of which run of the day it is.

## Gotchas

- **Webhook frequency vs email frequency differ.** Webhook = once/day (deduped by
  `last_webhook_date`). Email = only on threshold crossing. Don't assume one implies
  the other.
- **`balances` table is legacy / dead.** Per-subscription balances used to live in
  `balances`; burn rate now derives entirely from `oui_balances`. `user.js` still
  best-effort `DELETE`s from `balances` on unsubscribe (wrapped in try/catch since the
  table may not exist). Don't add new writes to it.
- **Snapshots are 6h apart.** On-chain balance can move a lot between snapshots, so
  the live `/balance` figure can diverge from what burn rate was computed on.
- **`burn1d` / `burn30d` can be `null`.** Fewer than 2 valid records, or no negative
  diffs (balance only went up), yields `null` and "days remaining" is unknown — not
  zero. Frontend and webhook surface this as N/A.
- **Subrequest caps.** Both the cron bulk fetch and `/update-ouis` are deliberately
  batched/limited (`BATCH_SIZE`, `MAX_BALANCE_FETCH_PER_UPDATE`) to stay under
  Cloudflare's per-invocation subrequest ceiling. Don't fan out unbounded RPC calls.
- **Frontend days-remaining is recomputed client-side** in `Home.jsx` from USD burn
  values (`Math.max(burn30dUSD, burn1dUSD)`, floor at $35) — keep it consistent with
  the worker's DC-based math if you change either.

## Past Bugs

- **`pickThreshold` escalation inversion (Feb 2025):** the guard was written as
  `lastNotifiedLevel < threshold`, which is backwards for the descending 14→7→1
  order. Level 14 is numerically largest, so `14 < 7` blocked every subsequent alert
  after the first. Fix: `lastNotifiedLevel === 0 || lastNotifiedLevel > threshold`.
- **Days-remaining overestimation (Feb 2025):** the 30-day average burn was always
  preferred, badly underestimating depletion when burn accelerates. Fix:
  `Math.max(burn30d, burn1d)` — use whichever is higher.

## Environment / Secrets

Config in `config.js`; runtime values in `wrangler.jsonc` (vars) and `wrangler secret put` (secrets).

| Name | Kind | Purpose |
|---|---|---|
| `SOLANA_RPC_URL` | secret | Solana RPC for escrow balances (Helius staked endpoint). **Never log or expose.** |
| `RESEND_API_KEY` | secret | Resend API key for outbound email. **Never log or expose.** |
| `ADMIN_TOKEN` | secret | Bearer token gating `POST /update-ouis`. **Never log or expose.** |
| `FROM_EMAIL` | var | Sender address (`alerts@`/`alerts-dev@heliumtools.org`). |
| `APP_NAME` | var | Shown in email subjects / from-name (default "Helium DC Alerts"). |
| `APP_BASE_URL` | var | Frontend base for verify redirects + email management links. |
| `DB` | binding | D1 database (`users`, `subscriptions`, `ouis`, `oui_balances`; legacy `balances`). |
| `KV` | binding | Caches the well-known OUI list (`well-known-ouis`, 1h). |

## External Dependencies

- **Helium OUI catalog** — `https://entities.nft.helium.io/v2/oui/all` (network-wide
  OUI → owner/payer/escrow/delegate_keys), polled by the cron.
- **helium/well-known OUI list** — `https://github.com/helium/well-known` (`lists/ouis.json`),
  the curated id→name map used by `/known-ouis`.
- **Solana RPC** — escrow token balances (`getTokenAccountBalance`).
- **Resend** — `https://api.resend.com/emails`, transactional email.
- **Helium DC funding docs** — linked from the UI:
  `https://docs.helium.com/iot/run-an-lns/fund-an-oui/`.

## Related tools

- **multi-gateway** (`worker/src/tools/multi-gateway/oui-cache.js`) — **independent**,
  despite the shared "OUI" name. It maps OUI → **DevAddr ranges** by calling the IoT
  config gRPC-web service (`config.iot.mainnet.helium.io:6080`) and caches the result
  in KV (`oui-devaddr-map`, 24h, refreshed by the shared `scheduled()` handler at
  00:00 UTC). It has nothing to do with DC balances or alerts. The *only* overlap is
  that both fetch the same helium/well-known `ouis.json` for human-readable OUI names
  — there is no shared code; each fetches it independently. See
  [`worker/src/tools/multi-gateway/CLAUDE.md`](../multi-gateway/CLAUDE.md).
- **shared response helpers** — `worker/src/lib/response.js` provides `corsHeaders`,
  `jsonResponse` (re-exported locally via `responseUtils.js`). Not OUI-specific.

## References

- README (full endpoint + schema reference): [`README.md`](./README.md)
- DB schema: `worker/schema.sql` (`users`, `subscriptions`, `ouis`, `oui_balances`, legacy `balances`)
- Worker route registration + cron wiring: `worker/src/index.js`
- Root architecture overview: `/CLAUDE.md`
