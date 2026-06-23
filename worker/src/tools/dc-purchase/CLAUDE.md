# Buy Data Credits

Fiat → Data Credits funding for a Helium OUI. The form collects an OUI and a
USD amount; the worker drives a fully custodial pipeline that takes a Coinbase
Onramp USDC deposit into a treasury wallet, swaps USDC → HNT on Jupiter, burns
HNT to mint DC, and delegates that DC into the OUI's escrow account. No wallet
connect — the buyer never signs anything; the treasury wallet does all on-chain
work.

**Status: disabled / "Coming Soon".** The Landing tile (`pages/public/src/pages/Landing.jsx`,
features array) has `disabled: true` with a `"Coming Soon"` badge, so the tool
is not linked from the homepage. The routes, worker handlers, and DB tables all
exist; it is disabled via the Landing tile flag, not absent.

## Architecture

### Worker (API) — prefix `/dc-purchase`

Entry point: `index.js` → `handleDcPurchaseRequest` (HTTP) + `runDcPurchaseScheduled`
(cron). Both are registered in `worker/src/index.js` (prefix router + `scheduled()`).
CORS is open to all origins — this is a public API.

**Endpoints:**
- `GET /oui/<oui>` — Resolve an OUI to its `payer` + `escrow` and fetch the
  **live** escrow DC balance from Solana RPC. Reuses the OUI Notifier's catalog
  and balance fetchers (see Related tools). Used by the form for the balance
  preview card.
- `POST /orders { oui, usd, email? }` — Validate (`usd` ≥ $5, ≤ `DC_PURCHASE_MAX_USD`
  / default $1000, integer OUI), resolve the OUI, insert a `dc_purchase_orders`
  row, create a **Coinbase Onramp session** (CDP `/onramp/v1/token` → `pay.coinbase.com`
  URL), move the order to `onramp_started`, and return `{ orderId, checkoutUrl, … }`.
  The client `window.location.href`-redirects to `checkoutUrl`. Falls back to the
  order-status URL if session creation fails.
- `GET /orders/<id>` — Order status + amounts + per-stage tx signatures. Polled
  every 4s by the order-status page until a terminal state.
- `POST /webhooks/coinbase` — Coinbase Onramp webhook. HMAC-SHA256 verifies the
  `X-Hook0-Signature` header (timestamp + `.body`, ±5 min replay window), looks
  up the order by `coinbase_partner_user_ref`, records the raw event, and on
  `status === "completed"` advances to `payment_confirmed` and kicks off processing.

**Services:**
- `services/orders.js` — D1 CRUD for `dc_purchase_orders`. `updateOrderStatus`
  takes an `extra` map gated by an `ALLOWED_EXTRA_COLUMNS` whitelist (dynamic
  `UPDATE` set without it would be SQL-injectable). Every status change also
  appends a `dc_purchase_events` row. `listPendingOrders` selects all non-terminal
  statuses for reconciliation. `triggerProcess` runs the pipeline via `ctx.waitUntil`
  when available, else awaits inline.
- `services/process.js` — The order state machine. Linear transitions
  `payment_confirmed → usdc_verified → swapping → minting_dc → delegating → complete`,
  capped at 10 iterations with a 1s delay between steps. The swap and mint steps
  verify a balance delta before advancing; the `usdc_verified` and delegate steps
  only record the current balance (no delta check). On error it stores
  `error_code` / `error_message`, records an `ERROR` event, and stops
  (the order stays at its current status so reconciliation can retry).
- `services/jupiter.js` — USDC → HNT swap via **Jupiter Authenticated Swap API v1**
  (`api.jup.ag/swap/v1/quote` + `/swap`, `x-api-key`). `executeSwapWithRetry`
  pulls a fresh quote per attempt (3 retries, 1% default slippage), signs the
  returned `VersionedTransaction` with the treasury keypair, broadcasts, confirms,
  and reports actual HNT received as a balance delta.
- `services/dataCredits.js` — Hand-built `mint_data_credits_v0` (burn HNT → DC)
  and `delegate_data_credits_v0` (DC → OUI escrow) instructions for the Helium
  Data Credits program. No Anchor dependency — Anchor discriminators are hardcoded
  bytes and all PDAs (`DataCreditsV0`, circuit breaker, DAO, IOT SubDAO,
  `DelegatedDataCreditsV0`, escrow) are derived locally. Mint reads the Pyth Push
  Oracle HNT/USD feed (`4DdmDswskDxXGpwHrXUfn2CNUm9rt21ac79GHNTN3J33`, hardcoded
  here as `HNT_PYTH_PRICE_FEED`) so no price post is needed. Delegation uses the
  OUI's `payer` as the `router_key`. The mint verifies a positive DC balance delta
  (throws if none was minted); the delegate reads and records the post-tx escrow
  balance but does not assert a delta.
- `services/solana.js` — Treasury keypair loader (`TREASURY_PRIVATE_KEY`: JSON
  array / base64 / base58, all 64-byte), `Connection` (`SOLANA_RPC_URL`, else
  public mainnet), `getTokenBalance`, ATA derivation, and a `sendAndConfirmTransaction`
  that checks `getSignatureStatus` before retrying so a confirmed-but-timed-out tx
  is not re-sent (double-spend guard).
- `services/events.js` — Append-only audit log (`dc_purchase_events`): every
  status change, on-chain stage, Coinbase webhook payload, and error is recorded
  with its full JSON payload.
- `services/reconciliation.js` — Cron job (registered in `runDcPurchaseScheduled`,
  runs on the shared 4x/day schedule). Re-triggers processing for every pending
  order, so a step that crashed or hit a webhook race eventually completes.
- `lib/coinbaseJwt.js` — Builds the CDP API JWT (Ed25519/EdDSA or EC/ES256,
  auto-detected from `COINBASE_CDP_API_SECRET` format) using WebCrypto, including
  DER→compact ECDSA signature conversion. 2-minute expiry, `uris` claim scoped to
  the exact request (`METHOD host+path`, e.g.
  `POST api.developer.coinbase.com/onramp/v1/token`).
- `lib/constants.js` — Helium program IDs, token mints, decimals, and the Jupiter
  API base. (The active Pyth HNT/USD feed is hardcoded in `services/dataCredits.js`,
  not here; the frontend hardcodes its Solscan URLs.)

### Frontend
- `pages/public/src/dc-purchase/DcPurchaseTool.jsx` — Single-file purchase form.
  Debounced (400ms) OUI auto-resolve → balance preview card; submit calls
  `createDcOrder` then redirects to the returned Coinbase `checkoutUrl`. Shows the
  USDC → HNT → DC disclaimer (delivered DC varies with price/slippage/fees).
- `pages/public/src/dc-purchase/OrderStatus.jsx` — Route `/dc-purchase/order/:orderId`.
  Polls `GET /orders/<id>` every 4s (stops after 5 consecutive errors or a terminal
  state), renders the 7-step `STATUS_FLOW` progress, amounts (HNT received, DC
  minted), and Solscan links for each stage's signature.
- `pages/public/src/lib/dcPurchaseApi.js` — API client (`resolveOui`,
  `createDcOrder`, `fetchOrder`).

## Key Concepts

### Order lifecycle (the status field)
`created` → `onramp_started` (after `POST /orders` builds the Coinbase session) →
`payment_confirmed` (Coinbase webhook says completed) → `usdc_verified` → `swapping`
→ `minting_dc` → `delegating` → `complete`. `OrderStatus.jsx`'s `STATUS_FLOW`
lists the same ordered statuses plus the `onramp_started` and `complete`
bookends; the work-doing transitions match the worker's `STATUS_TRANSITIONS` —
keep the two in sync.
Note the off-by-one between the *enum value* and the *work done*: e.g. the swap
runs during the `usdc_verified → swapping` transition, so when status reads
`swapping` the HNT has already been received. Terminal states are `complete` and
any status carrying an `error_code`.

### Custodial design
Every on-chain action is signed by one treasury wallet (`TREASURY_PRIVATE_KEY`,
public key `TREASURY_PUBLIC_KEY`). Coinbase deposits USDC straight into the
treasury's USDC ATA (`addresses: [{ address: TREASURY_PUBLIC_KEY, blockchains: ["solana"] }], assets: ["USDC"]`).
The buyer's funds and the OUI are linked only by the `oui` on the order — the
buyer never custodies HNT or DC.

### partner_user_ref is the join key
`POST /orders` builds `partnerRef = "dc_<oui>-<timestamp>"` (≤48 chars), stores it
as `coinbase_partner_user_ref` (UNIQUE), and passes it to Coinbase. The webhook
matches the incoming `partner_user_ref` back to the order. No other field links
the Coinbase session to the order.

## Relationship to dc-mint

`dc-mint` (`worker/src/tools/dc-mint/`, prefix `/dc-mint`) is a **separate,
non-custodial** tool that ultimately mints/delegates DC the *same on-chain way*
(`mint_data_credits_v0` + `delegate_data_credits_v0` against the same Data Credits
program). The difference is who signs and who pays:

- **dc-purchase** is custodial: the worker builds **and signs and broadcasts** the
  mint/delegate txns with the treasury keypair (`services/dataCredits.js`), funded
  by a fiat Coinbase deposit + Jupiter swap.
- **dc-mint** is build-only: it exposes `POST /build-mint` and `POST /build-delegate`
  that return *unsigned* transactions for the user's own wallet to sign (the user
  already holds HNT). It does not touch fiat, Coinbase, or Jupiter.

The two share no code — each has its own `lib/solana.js` and its own copy of the
DC instruction builders. If you refactor the DC mint/delegate instruction
encoding, both must be updated.

## Related tools
- **OUI Notifier** (`worker/src/tools/oui-notifier/CLAUDE.md`) — dc-purchase
  imports `getOuiByNumber` from `oui-notifier/services/ouis.js` (OUI → payer/escrow
  from the `ouis` catalog) and `fetchEscrowBalanceDC` from
  `oui-notifier/services/solana.js` (live escrow balance). `POST /orders` also
  reads the latest cached snapshot from the `oui_balances` table that the OUI
  Notifier cron populates. `OrderStatus.jsx` links to `/oui-notifier/?oui=<oui>`.
- **dc-mint** (`worker/src/tools/dc-mint/`) — see "Relationship to dc-mint" above.

## On-Chain Programs

| Name | Program ID |
|---|---|
| Data Credits | `credMBJhYFzfn7NxBMdU4aUqFggAjgztaCcv2Fo6fPT` |
| Helium Sub-DAOs | `hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR` |
| Circuit Breaker | `circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g` |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |

**Token mints:** HNT `hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux`, DC
`dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm`, USDC
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, IOT
`iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns`.
**Pyth HNT/USD push-oracle feed:** `4DdmDswskDxXGpwHrXUfn2CNUm9rt21ac79GHNTN3J33`
(the mint instruction reads this; no client price post).

PDAs (derived in `services/dataCredits.js`, all under Data Credits program unless
noted): `DataCreditsV0 = ["dc", DC_MINT]`; circuit breaker =
`["mint_windowed_breaker", DC_MINT]` (under Circuit Breaker program); DAO =
`["dao", HNT_MINT]` and IOT SubDAO = `["sub_dao", IOT_MINT]` (under Sub-DAOs);
`DelegatedDataCreditsV0 = ["delegated_data_credits", subDao, sha256(routerKey)]`;
escrow = `["escrow_dc_account", delegatedDataCredits]`.

## Environment / Secrets

Never log or expose any of these values.

- `SOLANA_RPC_URL` — Helius staked endpoint (falls back to the public mainnet RPC
  `https://api.mainnet-beta.solana.com` if unset).
- `TREASURY_PRIVATE_KEY` — Custodial treasury keypair (JSON array / base64 / base58,
  64 bytes). Signs every swap/mint/delegate.
- `TREASURY_PUBLIC_KEY` — Treasury address; the Coinbase Onramp destination.
- `JUPITER_API_KEY` — Jupiter Authenticated Swap API v1 key (`x-api-key`).
- `COINBASE_CDP_API_KEY` / `COINBASE_CDP_API_SECRET` — CDP credentials for the
  Onramp session-token JWT.
- `COINBASE_ONRAMP_WEBHOOK_SECRET` — HMAC secret for webhook verification; if
  unset, **all webhooks are rejected** (fail-closed).
- `COINBASE_SANDBOX` — `"true"` routes to `pay-sandbox.coinbase.com`.
- `COINBASE_ONRAMP_REDIRECT_BASE_URL` — Onramp redirect base (default
  `https://heliumtools.org/dc-purchase/order`).
- `DC_PURCHASE_MAX_USD` — Per-order cap (default 1000).
- `DB` binding — D1; tables `dc_purchase_orders` + `dc_purchase_events` created by
  `worker/migrations/0003_add_dc_purchase.sql` (not in `schema.sql`).

## External Services

- **Coinbase Developer Platform / Onramp** — session token at
  `https://api.developer.coinbase.com/onramp/v1/token`, checkout at
  `https://pay.coinbase.com/buy/select-asset` (sandbox: `https://pay-sandbox.coinbase.com`),
  webhooks documented at https://docs.cdp.coinbase.com/onramp/docs/webhooks/.
- **Jupiter** — Authenticated Swap API v1, https://api.jup.ag/swap/v1 (quote +
  swap).
- **Pyth** — HNT/USD push oracle on Solana (read on-chain by the mint instruction).
- **Solscan** — explorer links in the UI (`https://solscan.io`).

## Gotchas

- **Disabled in prod.** Enabling means flipping `disabled` on the Landing tile
  *and* confirming all secrets above are set in production. Do not enable casually
  — this moves real money custodially.
- **`error_code` is the only retry signal.** A failed step leaves the order at its
  current status with an `error_code`; the cron reconciler re-runs *all* pending
  orders. There is no per-order backoff or max-attempt cap on reconciliation, so a
  permanently-broken step will be retried every cron tick until manually resolved.
- **No idempotency on the swap/mint side beyond balance deltas.** The double-send
  guard lives in `sendAndConfirmTransaction` (checks signature status before retry),
  but if the process is re-entered after a successful-but-unrecorded broadcast, the
  balance-delta verification is what prevents a second swap from looking valid.
  Read `process.js` carefully before changing transition ordering.
- **`STATUS_FLOW` (frontend) and `STATUS_TRANSITIONS` (worker) are duplicated.**
  Changing the pipeline requires editing both.
- Webhook payload shape is read defensively (`payload.data.* || payload.*`) because
  Coinbase Onramp event envelopes vary; keep that tolerance if Coinbase changes
  field nesting.
