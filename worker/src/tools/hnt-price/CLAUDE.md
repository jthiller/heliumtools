# HNT Price

A public, keyless HNT price API for third-party consumers (Helium Docs first).
**Worker-only — there is no frontend.** `README.md` next to this file is the
external product documentation; keep it accurate, it is what integrators read.

Built because Pyth's unauthenticated `hermes.pyth.network` stops serving public
traffic on **2026-08-18**. Anything in the ecosystem reading HNT prices from
Hermes without a key needed a replacement, and we already had the pieces: our own
staked RPC, a KV snapshot pattern, and a WebSocket fan-out Durable Object.

Three surfaces, in increasing cost per call:

| Surface | Cost | Use for |
|---|---|---|
| `GET /current` | KV read | polling, dashboards, docs pages |
| `GET /ws` | one poll shared across all subscribers | live displays |
| `GET /instant` | one chain read + one Jupiter fetch, per call | one-off display, transaction construction |

## Two prices, both surfaced

The payload deliberately carries both, because conflating them is the mistake
this tool exists to prevent:

- **`spot`** — Jupiter aggregated market price for the HNT mint. Fresh. Nothing
  on-chain reads it. Display only.
- **`oracle`** — decoded from the Pyth `PriceUpdateV2` account that the Data
  Credits program's `mint_data_credits_v0` instruction is `has_one`-pinned to.
  `oracle.mint_price_usd` is the conservative figure the program actually pays
  with: `(ema_price − 2 × ema_conf) × 10^exponent`. `dc_per_hnt` is derived from
  it, not from `spot`.

A crank posts to the oracle feed roughly every 5 minutes, so `oracle` is never a
live market price — not even on `/instant`. That caveat is documented in the
README because integrators will otherwise read "instant" as "sub-second".

## Architecture

### Worker (API) — prefix `/hnt-price`

Entry point: `index.js` (prefix-routed from `worker/src/index.js`, which strips
`/hnt-price` before this router sees the path). Also re-exports `refreshSnapshot`
for the cron.

**Endpoints:**
- `GET /current` — a thin wrapper over `getSnapshotSwr(env, ctx)` (services):
  fresh (< 30s) ⇒ return as-is; stale ⇒ return it anyway and `ctx.waitUntil` a
  background `refreshSnapshot`; cold (nothing stored) ⇒ inline live build, 500
  on failure. Error bodies are a canned message (never `err.message` — upstream
  errors could carry RPC endpoint detail). 60 req/min/IP (`rl:hntprice`).
- `GET /instant` — `await buildSnapshot` unconditionally: lock-free, genuinely
  live on every call, and write-through-freshens the shared snapshot. 502 when
  both sources fail (`PriceUnavailableError`), 500 otherwise (canned message).
  15 req/min/IP (`rl:hntprice-instant`).
- `GET /ws` — WebSocket upgrade, forwarded **as-is** to the `HntPriceHub`
  Durable Object (`idFromName("hub")`). No rewrite needed: the top-level router
  already rebased the request onto `/ws` — the path the DO matches — with the
  `Upgrade`/`Sec-WebSocket-Key` headers carried over. Guarded on the binding
  existing (500 if missing).

`OPTIONS` short-circuits 204 with `corsHeaders`; anything unmatched is a 404
`jsonResponse`. Note the top-level router only matches `prefix + "/"`, so a bare
`/hnt-price` never reaches this handler — it returns the top-level plain-text 404.
The README tells consumers to always include a path segment.

**`services/price.js`** — the only place a price is read.
- `fetchOraclePrice(connection)` — `resolveHntPriceOracle(connection)` (imported
  from the shared `worker/src/lib/helium-solana.js`) →
  `getAccountInfo(oracle, "confirmed")` → decode
  `PriceUpdateV2` → `{ usd, conf_usd, mint_price_usd, publish_time, account }`.
- `fetchSpotPrice()` — a thin wrapper over `fetchJupiterUsdPrices([HNT mint])`
  from the shared `worker/src/lib/jupiter.js` (Jupiter Price v3,
  `AbortSignal.timeout(10s)`, response keyed by mint with `usdPrice`). That lib
  is the single Jupiter client, shared with wallet-dashboard's
  `services/prices.js`; the difference is only posture — a missing quote is a
  failed source here, a null row there. CoinGecko is intentionally avoided
  (blocks Worker egress IPs).
- `buildSnapshot(env)` — the actual work: fetches both sources with
  `Promise.allSettled` (each with a 10s `AbortSignal.timeout`, including the
  chain reads via `rpcConnection`'s `fetch` override), assembles the payload,
  `kvPutJson`s it, returns it. Always live; no lock. Used by `/instant` and the
  hub's alarm poll (the singleton DO serializes its own polls, so a lock there
  would only add KV writes).
- `refreshSnapshot(env)` — `buildSnapshot` behind the best-effort KV
  single-flight lock (`withKvLock` from `worker/src/lib/kv.js`, key
  `hntprice:lock`, 60s), for callers that can race each other (the SWR
  `waitUntil` refreshes and the cron). **Never resolves undefined** (see the
  lock note below) — on contention it returns the stored snapshot.
- `getStoredSnapshot(env)` — the read side. (`isFresh` and `SNAPSHOT_KEY` are
  module-private; everything outside this file goes through `getStoredSnapshot`
  or `getSnapshotSwr`.)
- `getSnapshotSwr(env, ctx)` — the stale-while-revalidate read policy, defined
  once here; `/current` and dc-mint's `/price` are both thin wrappers over it.
  Its background refresh is deduped **per isolate** by a module-level
  `inflightRefresh` promise, so a request burst hitting the staleness edge
  schedules one refresh instead of one per request (the KV lock only dedupes
  *between* isolates, and charges KV ops to do it).
- `dcPerHnt(usd)` — `Math.round(usd * DC_PER_USD)`, the one derivation of that
  figure. Used for the snapshot's `dc_per_hnt` and by dc-mint's spot fallback.
- `PUBLIC_PRICE_ERROR` — the canned public error body, imported by both
  handlers, documented verbatim in `README.md`.
- Exports `DC_PER_USD` (100,000), `PriceUnavailableError`, `PUBLIC_PRICE_ERROR`,
  `dcPerHnt`, `buildSnapshot`, `refreshSnapshot`, `getStoredSnapshot`, and
  `getSnapshotSwr`. (`SNAPSHOT_KEY`, `SNAPSHOT_STALE_MS`, `isFresh` and the two
  fetchers are deliberately module-private.)

The `Connection` comes from `rpcConnection(env.SOLANA_RPC_URL)` in the shared
`worker/src/lib/helium-solana.js` — a 10s `AbortSignal.timeout` on every RPC
round trip, at "confirmed". `oracleRead` is `async`, so a missing/malformed URL
rejects the oracle read only and degrades to a spot-only snapshot rather than
killing the refresh.

### `PriceUpdateV2` layout (little-endian throughout)

```
0    anchor discriminator     (8)
8    write_authority          (32)
40   verification_level       (1-byte borsh enum tag)
       0 = Partial { num_signatures: u8 }  → message starts at 42
       1 = Full                            → message starts at 41
..   price_message:
       +0   feed_id           (32)
       +32  price             (i64)
       +40  conf              (u64)
       +48  exponent          (i32)
       +52  publish_time      (i64)
       +60  prev_publish_time (i64)
       +68  ema_price         (i64)
       +76  ema_conf          (u64)
..   posted_slot              (u64)
```

Read with Buffer (`readBigInt64LE` / `readBigUInt64LE` / `readInt32LE`) — same
approach as `dc-mint/handlers/resolvePayer.js`. `nodejs_compat` makes Buffer
available. The decoder validates length for the resolved `messageStart`, rejects
an unknown verification-level tag, rejects an exponent outside `[-18, 0]` (a
layout-drift tripwire), and rejects a non-positive price.

BigInt → Number conversion happens **after** the arithmetic that must be exact
(`ema_price − 2 × ema_conf` in BigInt) and before the decimal scaling by
`10^exponent`. Realistic HNT mantissas sit far inside Number's exact-integer
range.

### Durable Object: `HntPriceHub` (`hub.js`)

One instance globally (fixed name `"hub"`) polls the price and fans it out, so N
streaming subscribers cost one poll rather than N.

- **Bindings/migration**: `HNT_PRICE_HUB` binding + a `new_sqlite_classes`
  migration (`v2-hnt-price-hub`) in `worker/wrangler.jsonc`, declared in **both**
  the top-level block and `env.production`; class re-exported from
  `worker/src/index.js`.
- **No upstream pump.** Unlike `MultiGatewayHub` there is nothing long-lived to
  hold open — the poll lives entirely inside `alarm()`. That makes the alarm the
  only moving part.
- **Connect**: 426 unless `Upgrade: websocket`; 503 before upgrading once
  `countSubscribers() >= MAX_SUBSCRIBERS` (500). Then `state.acceptWebSocket`,
  `armHeartbeat()`, and an immediate snapshot frame from `this.lastBroadcast`
  (memory) falling back to `getStoredSnapshot(env)` — wrapped in try/catch, a
  failed replay just means the client waits for the next change.
- **Alarm (`ALARM_HEARTBEAT_MS` = 15s)**: with subscribers, `buildSnapshot`
  (lock-free — the singleton DO serializes its own polls) + `broadcastIfChanged`,
  then re-arm (re-checking the count, since a client can leave mid-refresh); with
  none, clear `lastBroadcast` and do **not** reschedule so the DO hibernates
  cleanly. A refresh failure is logged and nothing is sent — clients keep their
  last price.
- **Alarm arming is ensure-style, through one chokepoint.** `ensureScheduled()`
  is the only place the heartbeat-vs-teardown decision is made
  (`countSubscribers() > 0 ? armHeartbeat() : armTeardown()`); `webSocketClose`,
  `webSocketError` and the tail of `alarm()` all call it. A DO has ONE alarm and
  `setAlarm` REPLACES it, so `armHeartbeat()` first checks `storage.getAlarm()`
  and only sets when nothing is pending or the pending alarm is later. An
  unconditional set from every wake path would let steady client churn postpone
  the poll forever. Keeping an EARLIER pending alarm (e.g. a teardown) is always
  safe: `alarm()` decides what to do from the live subscriber count when it
  fires. Both arming methods return their `setAlarm` promise, so the callers'
  awaits are real (a floating storage write can be cut off at hibernation).
- **`webSocketMessage` only re-ensures the alarm.** The protocol is
  broadcast-only — clients send nothing, an inbound frame carries no meaning —
  but the hook keeps `ensureScheduled()` as a self-heal backstop: if a storage
  failure ever exhausted the alarm retries, the roster would be live with no
  alarm and no other wake signal until a connect or close. Ensure-style arming
  means a junk frame costs at most one storage read.
- **Teardown**: `armTeardown()` sets a short `IDLE_TEARDOWN_MS` (2s) alarm when
  the last socket goes — unconditionally, since pulling the alarm earlier is
  always safe. A reconnect within the grace doesn't cancel it; the alarm fires,
  sees a live subscriber, polls, and re-arms the heartbeat.
- **Edge-triggered broadcast**: `broadcastIfChanged` compares a cheap change key,
  `${spot.usd}|${oracle.publish_time}`. `snapshot_at` is deliberately **not** in
  the key — including it would turn the stream into an unconditional 15s ping.
- **Fan-out**: per-socket `try/catch` that swallows errors (Cloudflare fires
  `webSocketClose` for a dead socket).
- **Hibernation**: sockets use the Hibernation API, so the DO may be evicted
  between alarms. `this.lastBroadcast` is wiped on wake (worst case: one
  duplicate frame). Only `storage.setAlarm` survives, never `setTimeout`. Every
  wake path that changes the roster (`webSocketClose`/`Error`, `alarm`, an
  inbound fetch) re-arms the alarm while subscribers remain.
- **Subscriber accounting** is `state.getWebSockets().length` — nothing persisted.

### Cron

`worker/src/index.js` runs `refreshHntPriceSnapshot(env)` inside the `FAST_CRON`
(`*/15 * * * *`) branch. It is the backstop for GET consumers: while anyone is
streaming, the hub refreshes every 15s, but with an idle hub the snapshot would
otherwise only be rebuilt by a cold `/current`. 15 min keeps the KV entry alive
and warm well inside its safety TTL.

## Storage (KV)

| Key | Contents | TTL |
|---|---|---|
| `hntprice:snap` | the assembled snapshot payload — the single thing every surface serves | 4h (safety net only; refreshed every ≤15 min) |
| `hntprice:lock` | single-flight refresh lock | 60s (Cloudflare KV's `expirationTtl` floor) |
| `rl:hntprice:<ip>` | `/current` rate-limit window record `{n, ts}` | 120s (2× the 60s window; the window itself is anchored by `ts`) |
| `rl:hntprice-instant:<ip>` | `/instant` rate-limit window record `{n, ts}` | 120s |

The lock is `withKvLock` from the shared `worker/src/lib/kv.js`: best-effort (KV
has no atomic put-if-absent), released in a `finally`, and **fails open** — a
KV error allows the refresh rather than blocking it. When the lock IS held,
`refreshSnapshot` serves the stored snapshot instead of duplicating the chain
read, and only if there is nothing stored does it do the work anyway. That is why
it never returns undefined (a deliberate difference from vote's `refreshSnapshot`,
whose callers can tolerate a skipped refresh).

## Cross-tool relationships

- **shared libs** — `worker/src/lib/helium-solana.js` supplies
  `resolveHntPriceOracle` (reads the oracle pubkey from the DataCreditsV0
  singleton, byte offset 104 — the only correct way to find the feed),
  `rpcConnection` (the timeout-guarded `Connection` factory, also used by
  dc-mint's build handlers), and the `HNT_MINT` `PublicKey` this tool prices.
  **Do not duplicate any of them here.** `worker/src/lib/jupiter.js` is the
  Jupiter client, and `worker/src/lib/kv.js` the KV helpers plus `withKvLock`.
- **dc-mint** — the coupling is **one-way**: dc-mint's `GET /price` is a thin
  wrapper over this tool's `getSnapshotSwr(env, ctx)`, mapping the snapshot onto
  its own long-standing
  `{ hnt_usd, confidence, dc_per_hnt, dc_per_usd, timestamp }` shape (`hnt_usd`
  from `oracle.mint_price_usd`, the same conservative basis as `dc_per_hnt`).
  Nothing here imports from dc-mint. This tool is therefore the single price
  source for the repo, and a change to the snapshot payload breaks dc-mint's
  simulator as well as external consumers.
- **dc-purchase** — nothing is imported from it. `HNT_MINT` comes from the
  shared `worker/src/lib/helium-solana.js` as a `PublicKey` (`.toBase58()` where
  a string is needed); dc-purchase's `lib/constants.js` holds a separate string
  copy that other tools use, but it is not this tool's source.
- **wallet-dashboard** — `services/prices.js` there calls the same
  `worker/src/lib/jupiter.js` client, so a Jupiter contract change is a one-file
  fix rather than two drifting copies.
- **multi-gateway** — `hub.js` here is modelled on `MultiGatewayHub`. They are
  independent DOs with different jobs; keep the lifecycle patterns in sync when
  you learn something about hibernation from either one.

## Gotchas

- **Never hardcode a price feed account.** Not `4DdmDswskDxXGpwHrXUfn2CNUm9rt21ac79GHNTN3J33`
  (legacy), not `He5mhwVQQNvjFxqjEjFDb7enJWFwFJ7Rq7zknqBz89A5` (pro receiver,
  post helium-program-library #1207). The program pins whatever DataCreditsV0
  stores, governance rotates it, and a hardcoded constant is a time bomb that
  produces a wrong price rather than an error. Always resolve via
  `resolveHntPriceOracle`.
- **`oracle` cannot be fresher than the crank**, even on `/instant`. The crank
  posts ~every 5 minutes. Don't "fix" this by blending `spot` into the oracle
  block — the whole point is that `mint_price_usd` matches what the program reads.
- **WS clients get no pings and no heartbeat frames.** The stream is
  edge-triggered on price change, so silence is normal. Clients must reconnect on
  close (and optionally on prolonged silence); the README's example shows the
  backoff.
- **`wrangler.jsonc` DO config must exist in BOTH the top-level block and
  `env.production`.** Wrangler envs do not inherit top-level keys, and migrations
  are cumulative — keep the full ordered list in both places and only append.
  Omitting the production copy deploys a worker whose `/ws` 500s on the missing
  binding.
- **A partial snapshot is a success.** `spot` or `oracle` may be `null` and the
  response is still 200 — only a double failure throws. Any consumer (including
  future internal ones) must null-check both blocks. `dc_per_hnt` is null
  whenever `oracle` is.
- **Timestamp units are mixed**: `spot.updated_at` and `oracle.publish_time` are
  Unix seconds (matching their sources), `snapshot_at` is Unix milliseconds
  (`Date.now()`). Documented in the README; don't silently normalize one, it is a
  published wire format now.
- **`README.md` is the product.** There is no UI, so a behavior change that is
  not reflected there is an undocumented breaking change for external consumers.

## Environment

- `SOLANA_RPC_URL` — Helius staked endpoint, for the DataCreditsV0 and feed
  account reads (never log or expose).
- `KV` binding — snapshot, lock, rate-limit counters.
- `HNT_PRICE_HUB` — Durable Object binding (`HntPriceHub`).
- No new env vars, and no D1.
