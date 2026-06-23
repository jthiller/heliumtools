# L1 Migration

Tool for accounts from the legacy Helium L1 blockchain that (per the frontend
page copy) may not have been accessed after the migration to Solana in April
2023; the UI's action button is labeled "Seed Wallet". The user pastes a Helium
B58 or Solana base58 address; the worker fetches that wallet's pre-signed
migration transactions from the migration service at
`https://migration.web.helium.io` and broadcasts them on-chain. There is no
wallet connect and no signing in this tool — the worker broadcasts the raw
transactions the service returns, as-is (`sendRawTransaction` with
`skipPreflight`), with no client- or worker-side signing step.

## Architecture

### Worker (API) — prefix `/l1-migration`

Entry: `index.js` (registered in `worker/src/index.js`'s prefix router as
`/l1-migration` → `handleL1MigrationRequest`) → `handlers/migrate.js`.

**Endpoints:**
- `POST /migrate { wallet }` — resolve `wallet` to a Solana address, fetch its
  pre-signed migration transactions from the external migration service,
  broadcast + confirm them, then re-fetch to verify none remain. Returns
  `{ success, message, wallet, transactionsProcessed, remaining? }`.

**Flow inside `handlers/migrate.js`:**
1. `resolveToSolanaAddress(input)` — accept either format (see "Address
   resolution" below). Returns `null` on invalid input ⇒ 400.
2. `fetchMigrationTransactions(solanaAddress)` — `GET
   https://migration.web.helium.io/migrate/<solanaAddress>?limit=1000`, 15 s
   timeout via `AbortSignal.timeout`. Response is `{ transactions: [base64,
   ...] }`; empty array ⇒ short-circuit 200 with `transactionsProcessed: 0`.
3. `broadcastAndConfirm(connection, txBuffers)` — base64-decode each txn to a
   `Buffer`, then a send/poll loop against the worker's own `SOLANA_RPC_URL`
   (see "Broadcast loop" below).
4. Verify by re-fetching from the migration service. If transactions still
   remain, return `success: false` with a `remaining` count so the user can
   retry; the migration service is the source of truth for "is this wallet
   fully migrated", not our local confirmed count.

This tool has **no D1, no KV, no cron, no Durable Object** — it is a stateless
proxy + broadcaster. The only persistent side effect is the structured
`l1_migration` log line on success.

### Frontend

`pages/public/src/l1-migration/`
- `L1MigrationTool.jsx` — page shell + header; lazy-loads the content component.
- `L1MigrationToolContent.jsx` — the single-input form. Resolves the typed
  string to a Solana `PublicKey` via `resolveSolanaWallet` and shows both the
  derived Helium B58 (`new Address(0, 0, 1, solanaWallet.toBytes()).b58`) and
  Solana base58 forms (the latter linked to explorer.solana.com) so the user
  can confirm they pasted the right wallet before hitting "Seed Wallet". Uses
  `react-async-hook`'s `useAsyncCallback` for the in-flight/error state.
- `pages/public/src/lib/l1MigrationApi.js` — `migrateWallet(wallet)` POSTs to
  `/l1-migration/migrate` (dev: `/api/l1-migration`, prod:
  `https://api.heliumtools.org/l1-migration`).
- `pages/public/src/lib/solanaAddress.js` — `resolveSolanaWallet(input)`. Note
  this **does** use the `@helium/address` npm package (`Address.fromB58`) — the
  browser has the dependency, so the frontend doesn't reimplement checksum
  logic. The worker can't (see below).

## Key Concepts

### Address resolution — two implementations, on purpose
A user may paste either a modern Solana base58 pubkey or a legacy Helium B58
address. Both must resolve to the same 32-byte Solana pubkey.

- **Frontend** (`solanaAddress.js`): try `new PublicKey(input)`; on failure fall
  back to `new PublicKey(Address.fromB58(input).publicKey)` using the
  `@helium/address` package.
- **Worker** (`migrate.js` → `resolveToSolanaAddress`): try `new
  PublicKey(input)`; on failure decode the Helium B58 **manually** with `bs58`
  + `js-sha256` rather than using `@helium/address` (the root CLAUDE.md notes the
  worker does "manual checksum verification, no `@helium/address` dependency").
  Manual decode:
  1. `bs58.decode(input)` → must be ≥ 38 bytes: `[version, net_key_type,
     ...32-byte pubkey, ...4-byte checksum]`.
  2. Split off the trailing 4-byte checksum; the rest is `vPayload`.
  3. Verify the checksum is the first 4 bytes of `sha256(sha256(vPayload))`
     (double SHA-256). Mismatch ⇒ `null`.
  4. Drop the first 2 bytes (version + net_key_type) from `vPayload`; the
     remaining 32 bytes are the Solana pubkey.

  Keep the two implementations in sync — they must accept exactly the same set
  of inputs.

### Broadcast loop (`broadcastAndConfirm`)
The migration service may return up to 1000 pre-signed transactions for one
wallet, so the loop is built to stay within Solana RPC limits and to be
idempotent under retries:

- **Poll before send.** Each iteration first calls `getSignatureStatuses` on the
  txids we've already submitted (the first pass has none, so it sends
  immediately), so we never re-broadcast something already confirmed.
- **Poll batch size `256`** — `getSignatureStatuses` caps at 256 signatures per
  call, so pollable signatures are chunked accordingly.
- **Send batch size `50`** — pending transactions are (re)sent in groups of 50
  via `Promise.all` of `sendRawTransaction(buf, { skipPreflight: true,
  maxRetries: 0 })`. `skipPreflight` because the txns are already signed/valid
  from the service; `maxRetries: 0` because this loop owns retry timing.
- **Resend cadence `RESEND_INTERVAL_MS = 4000`**, **poll cadence
  `POLL_INTERVAL_MS = 1000`** — poll every second, but only re-send the still-
  pending set every 4 s to avoid hammering the RPC.
- A txn whose status comes back with `err` is counted as `failed` and dropped
  from `pending` (logged with its txid).
- **`MAX_WAIT_MS = 120_000`** — if anything is still pending after 2 minutes the
  loop throws `Timeout: N transactions still pending`, surfaced to the client as
  a 500 `Migration failed`.
- Returns `{ confirmed: total - failed, failed }`.

### Verify-by-refetch
After the loop, the handler re-queries the migration service. Local "confirmed"
counts can be optimistic (a txn can confirm then the migration service still
considers the wallet incomplete), so the authoritative completeness check is
"does the service still return transactions for this wallet". Non-empty ⇒
`success: false` + retry guidance.

## Gotchas
- The fetch requests at most 1000 transactions (`limit=1000`); there is no
  pagination loop within a run. A wallet with more pending than that finishes
  across repeated runs — each run re-fetches and the verify-by-refetch reports
  anything still remaining.
- `transactionsProcessed: 0` is a **success** state (nothing to migrate). The
  frontend renders it with an `info` tone rather than `success` — preserve that
  distinction if you touch the response shape.
- `SOLANA_RPC_URL` is read inside the handler (`new Connection(env.SOLANA_RPC_URL,
  "confirmed")`) — the same shared Helius staked endpoint other tools use; never
  log or expose it.

## Environment / Secrets
- `SOLANA_RPC_URL` — Helius staked RPC endpoint used to broadcast + poll. Secret;
  never log or expose.
- No D1, KV, R2, or cron bindings are used by this tool.

## External Dependencies
- **Helium migration service** — `https://migration.web.helium.io`, endpoint
  `GET /migrate/<solanaAddress>?limit=<n>` returning `{ transactions: [base64,
  ...] }` (the txns broadcast with no signing step on our side). The worker only
  relays and broadcasts these (`fetchMigrationTransactions` +
  `broadcastAndConfirm`); it never constructs migration transactions itself.

## Related tools
- **Wallet Dashboard** (`worker/src/tools/wallet-dashboard/CLAUDE.md`) — also
  accepts a wallet address but is read-only; it does not migrate. Different
  address-resolution path (it expects Solana base58 in the route).
- **Shared `SOLANA_RPC_URL`** — the other on-chain tools (hotspot-claimer, ve-hnt,
  iot-onboard, multi-gateway, wallet-dashboard) also read the `SOLANA_RPC_URL`
  secret. L1 Migration uses it only for `sendRawTransaction` +
  `getSignatureStatuses`.
- **Frontend dual-format address helper** — `resolveSolanaWallet` in
  `pages/public/src/lib/solanaAddress.js` is a generic Helium-B58-or-Solana
  resolver; if another frontend tool needs to accept legacy L1 addresses, reuse
  it rather than re-deriving.
