# DC Mint

Mints Data Credits by burning HNT on Solana, and optionally delegates the
freshly-minted DC to a router/OUI escrow. DC is priced at a fixed 100,000 DC = $1
(`DC_PER_USD`, which `handlers/price.js` imports from **hnt-price**'s
`services/price.js`). This is both a standalone tool (`/dc-mint`)
and a set of pieces imported by other tools: the `DcMintModal`, the `DC_MINT`
constant, and `confirmAndVerify` (see Related tools).

The worker **builds unsigned transactions only** — it never holds a key. The
connected wallet is set as both fee payer and mint/delegate authority, so it
signs, pays its own SOL fee, and burns its own HNT (unlike `hotspot-claimer`,
which subsidizes fees from a treasury).

## Architecture

### Worker (API) — prefix `/dc-mint`

Entry point: `index.js` → handlers under `handlers/`. Routed from the top-level
prefix router in `worker/src/index.js`.

**Endpoints:**
- `POST /build-mint { owner, hnt_amount?, dc_amount?, recipient? }` — build an
  unsigned `mint_data_credits_v0` transaction. Specify exactly one of `hnt_amount`
  (float HNT to burn; on-chain oracle determines DC yield) or `dc_amount` (integer
  DC target; oracle determines HNT to burn). `recipient` defaults to `owner`.
  Returns the base64 serialized `VersionedTransaction`.
- `POST /build-delegate { owner, amount, oui?, payer_key?, subnet?, hnt_amount?, mint_dc? }`
  — build an unsigned `delegate_data_credits_v0` transaction that moves `amount`
  DC from the owner's DC ATA into a router's escrow. The router is resolved from
  either an `oui` number (looked up via `oui-notifier`'s `getOuiByNumber`) or a
  raw `payer_key`. `subnet` is `"iot"` (default) or `"mobile"`. When `hnt_amount`
  or `mint_dc` is set, a `mint_data_credits_v0` instruction is **prepended** so a
  single atomic tx mints then delegates. Returns the tx plus resolved
  `{ payer, escrow, subnet }`.
- `GET /price` — current HNT/USD, returned as
  `{ hnt_usd, confidence, dc_per_hnt, dc_per_usd, timestamp }` for the client's
  HNT↔DC conversion preview. A thin wrapper over hnt-price's
  `getSnapshotSwr(env, ctx)` — that function owns the whole stale-while-revalidate
  policy over the shared `hntprice:snap` KV snapshot (fresh < 30s ⇒ serve as-is;
  stale ⇒ serve anyway and refresh behind the response; cold ⇒ inline build), and
  is shared with `/hnt-price/current` so the two surfaces can't drift apart on
  staleness. This handler is pure shape-mapping plus a 500 on throw.
  The price comes from the same on-chain oracle account the mint program reads
  (with Jupiter spot as a display-only fallback if that read failed), not Hermes.
  `hnt_usd` is the **conservative mint price** (`oracle.mint_price_usd`, i.e.
  `ema − 2×conf`) — the same basis as `dc_per_hnt` and the on-chain burn, not the
  headline EMA, so the two figures never disagree by the confidence margin.
  `confidence` is the full-precision `oracle.conf_usd`, or `null` on a spot-only
  snapshot (where `hnt_usd` falls back to `spot.usd`, which carries no confidence
  interval and needs no adjustment).
- `GET /resolve-payer/<payer_key>` — derive a router key's `delegatedDataCredits`
  → `escrow` PDA on **both** IoT and Mobile subnets, read each escrow's DC balance
  (u64 LE at byte offset 64), and attach a well-known OUI name if the key matches
  the public well-known list. Used by the standalone tool to preview where DC
  will land before delegating.

**lib/:**
- `lib/solana.js` — all PDAs, ATA derivation, LE integer writers, and the two
  instruction builders. Most program IDs and token mints
  (`DATA_CREDITS_PROGRAM_ID`, `HELIUM_SUB_DAOS_PROGRAM_ID`, `HNT_MINT`, `DC_MINT`,
  `IOT_MINT`) are imported from `dc-purchase/lib/constants.js`; the MOBILE mint,
  circuit-breaker program, and token/ATA program IDs are defined inline here
  because `dc-purchase` doesn't export them. The HNT price oracle is **not** a
  constant — `resolveHntPriceOracle(connection)` reads it from the DataCreditsV0
  account (byte offset 104) at build time. Its implementation lives in the shared
  `worker/src/lib/helium-solana.js` (one copy for dc-mint, dc-purchase, and
  hnt-price) and is simply re-exported from here, so the handlers keep importing
  it from `../lib/solana.js`. Key pieces:
  - `buildMintInstruction(owner, {hnt_amount|dc_amount}, recipient, hntDecimals, hntPriceOracle)`
    — hand-encodes the Anchor instruction. The `mint_data_credits_v0` args are an
    Anchor 8-byte discriminator (`4e 6d a9 84 90 5e dd 39`) followed by **two
    Borsh `Option<u64>`** fields: `hnt_amount` then `dc_amount`. Exactly one is
    `Some` (tag byte `1` + u64 LE), the other `None` (tag byte `0`). Account list
    includes the HNT price oracle resolved at build time by
    `resolveHntPriceOracle` (the program enforces `has_one = hnt_price_oracle`
    against DataCreditsV0 as of data-credits 0.2.7+) so the program reads the
    HNT/USD price, plus the circuit-breaker PDA (seed `mint_windowed_breaker`) and
    program account.
  - `buildDelegateInstruction(owner, dcAmount, routerKey, subnet)` — discriminator
    `9a 38 e2 80 a2 73 e2 05` + `u64 dcAmount` + Borsh `string routerKey`
    (u32 LE length prefix + UTF-8 bytes). The router key string is SHA-256 hashed
    (`hashName`) into the `delegated_data_credits` PDA seed. Returns `{ instruction, escrow }`.
  - `delegatedDcPda(routerKey, subnet)` seeds `["delegated_data_credits", subDao,
    sha256(routerKey)]`; `escrowPda(delDc)` seeds `["escrow_dc_account", delDc]`;
    both under the Data Credits program.
  - `buildUnsignedTx(connection, payerKey, instructions)` — prepends compute-budget
    instructions (limit 300k units, price 1 microLamport), fetches a fresh
    blockhash, and compiles a **legacy** message into a `VersionedTransaction`.

### Frontend — `pages/public/src/dc-mint/`

- `DcMintTool.jsx` — the full standalone tool. Two modes: mint (HNT→DC, input in
  either HNT or DC via `inputMode`) and mint+delegate (resolve OUI/payer, preview
  escrow, atomic mint+delegate). Wraps wallet flow: build → `sendTransaction` →
  `confirmAndVerify`. Routed at `/dc-mint` inside `SolanaProvider` (see
  `pages/public/src/main.jsx`).
- `DcMintModal.jsx` — **the modal variant, imported by multi-gateway.** A self-contained modal that assumes
  an already-connected wallet from `SolanaProvider` context (`useWallet` /
  `useConnection`). Takes `onClose`, `onSuccess(sig)`, `defaultDcAmount`. Builds a
  DC-target mint (`dc_amount` only), warns if the wallet has no DC ATA (~0.002 SOL
  rent to create one), and on success calls back so the host can refresh balances.
- `constants.js` — exports `HNT_MINT` and `DC_MINT` as `PublicKey`s. The latter is
  the DC token mint `dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm`, imported by
  multi-gateway (as `DC_MINT_KEY`).
- `solanaUtils.js` — `confirmAndVerify(connection, signature)` confirms then
  re-fetches via `getTransaction` (retry x5 with backoff, because `getTransaction`
  indexing lags `confirmTransaction` on some RPC nodes) and throws a descriptive
  error parsed from `meta.logMessages` if the tx failed on-chain. Also `cleanInt`
  and `cleanDecimal` (locale-aware decimal normalization for the amount inputs).
- `pages/public/src/lib/dcMintApi.js` — API client: `buildMintTransaction`,
  `buildDelegateTransaction`, `fetchHntPrice`, `resolvePayerKey`, plus `resolveOui`
  (which actually hits the **dc-purchase** API at `/dc-purchase/oui/<oui>`).

## Key Concepts

- **Build server-side, sign client-side.** Every endpoint returns an unsigned
  `VersionedTransaction`; the browser wallet is the only signer. The owner is set
  as both fee payer and the `mint`/`delegate` authority. This keeps the worker
  keyless and makes the modal trivially embeddable in any tool that already has a
  connected wallet.
- **Oracle-priced burn.** The user picks *either* an HNT amount *or* a DC amount.
  The `mint_data_credits_v0` program reads the HNT Pyth feed at execution time to
  compute the other side. The `/price` preview now reads that same oracle account
  (via the hnt-price snapshot) and reports the same conservative figure the
  program charges — `ema − 2×conf`, the basis of both `hnt_usd` and `dc_per_hnt` —
  so preview-vs-execution drift is only timing: the crank posts to the feed
  roughly every 5 minutes, and the snapshot may be up to ~30s behind it.
  The oracle *account* is resolved from chain on every build (no cache, no
  fallback), so oracle rotations, e.g. the 2026 legacy→pro Pyth receiver
  migration in helium-program-library #1207, require zero code changes here.
- **Atomic mint+delegate.** `/build-delegate` with `hnt_amount` (burn HNT) or a
  truthy `mint_dc` flag prepends a `mint_data_credits_v0` instruction ahead of the
  delegate in one transaction, so a router top-up is a single signature. `mint_dc`
  is a flag, not a value — the DC target minted is the delegate `amount`.
- **Delegation is keyed by router string, not pubkey.** The `delegatedDataCredits`
  PDA hashes the router/payer key *string* (SHA-256) into its seed, so an invalid
  string still derives a valid-looking PDA. Handlers validate the base58 shape
  (32–64 chars) up front to catch obvious typos before the user pays a fee.

## Gotchas

- `mint_data_credits_v0` args are **two `Option<u64>` in order `(hnt_amount,
  dc_amount)`** — both fields are always present in the encoding; one is `Some`,
  one is `None`. Swapping the order silently mis-prices the burn.
- The transaction is compiled with `compileToLegacyMessage()` (not v0 / no Address
  Lookup Tables), unlike `hotspot-claimer`'s claim tx. The account list here is
  small enough not to need an LUT.
- `/price` holds no cache of its own — the `hntprice:snap` KV entry *is* the
  cache, so it is shared across isolates (unlike the old per-isolate module
  variable). Expect the served price to be up to ~30s stale; the refresh happens
  behind the response, so the *next* caller sees the new value, not this one.
  Both snapshot halves are nullable, so never assume `oracle` is present.
- Escrow balance in `/resolve-payer` is read as a raw `u64 LE` at byte 64 of the
  escrow account; a `null` result means the escrow PDA does not exist yet (router
  has never received delegated DC on that subnet).
- **Never hardcode the mint oracle account.** The program checks it with
  `has_one` against DataCreditsV0, and the stored value is rotated by governance,
  so any constant is a time bomb. During the brief window inside a cutover Squads
  session, mints fail on-chain no matter which account is passed. That shows up as
  a wallet preflight simulation failure before signing, not as a build error.

## Related tools

- **multi-gateway** (`pages/public/src/multi-gateway/MultiGateway.jsx`) — imports
  `DcMintModal`, the `DC_MINT` constant (as `DC_MINT_KEY`), and `confirmAndVerify`
  from this tool. It renders the modal behind a "Mint DC" action and uses
  `confirmAndVerify` for its own gateway transactions.
- **iot-onboard** (`pages/public/src/iot-onboard/IotOnboard.jsx`) — imports
  `confirmAndVerify` from `../dc-mint/solanaUtils.js` to verify its onboarding
  transactions. It does **not** use the modal or build-mint endpoint.
- **update-location** (`pages/public/src/update-location/UpdatePanel.jsx`) —
  imports `DcMintModal`, `DC_MINT`, and `signAndBroadcast` for the DC-gated
  location re-assert flow.
- **mobile-onboard** (`pages/public/src/mobile-onboard/`) — imports
  `DcMintModal` (OnboardStep.jsx, ManageDetail.jsx) and `signAndBroadcast`
  (IssueStep.jsx, OnboardStep.jsx, ManageDetail.jsx) for its onboard and
  location-update flows.
- **dc-purchase** (`worker/src/tools/dc-purchase/`) — the source of truth for the
  shared Helium/Solana constants (`DATA_CREDITS_PROGRAM_ID`, `HELIUM_SUB_DAOS_PROGRAM_ID`,
  `HNT_MINT`, `DC_MINT`, `IOT_MINT`, `HNT_DECIMALS`) that `lib/solana.js` and the
  build handlers import from `dc-purchase/lib/constants.js`. (The MOBILE mint is
  **not** exported by dc-purchase — it's defined locally in `lib/solana.js`.) The client's
  `resolveOui` also calls `dc-purchase`'s `GET /oui/<oui>`. dc-purchase is the
  *fiat→DC* path (USDC/Jupiter swap); dc-mint is the *HNT→DC* burn path.
- **oui-notifier** (`worker/src/tools/oui-notifier/`) — `/build-delegate` calls
  `getOuiByNumber` (`services/ouis.js`) to resolve an OUI number to its payer key,
  and `/resolve-payer` reads the well-known OUI list from `config.js`
  (`WELL_KNOWN_OUIS_URL`).
- **hnt-price** (`worker/src/tools/hnt-price/`) — a **one-way** dependency: this
  tool's `GET /price` calls hnt-price's `getSnapshotSwr(env, ctx)` and maps the
  `hntprice:snap` snapshot onto its own response shape. hnt-price imports nothing
  from here — the oracle *resolution* (`resolveHntPriceOracle`) lives in the
  shared `worker/src/lib/helium-solana.js`, which both tools import; the oracle
  *decoding* and snapshot assembly live in hnt-price. Nothing is duplicated.
- **wallet-dashboard** (`worker/src/tools/wallet-dashboard/`) — its `config.js`
  comment points at this tool's price handler for the 100,000 DC = $1 fixed value.

## Environment / Secrets

- `SOLANA_RPC_URL` — Helius staked endpoint, used to fetch blockhash and account
  data when building/resolving (never log or expose). `/build-mint` and
  `/build-delegate` construct their `Connection` with the shared `rpcConnection()`
  (`worker/src/lib/helium-solana.js`), so the oracle resolve and the blockhash
  fetch are both capped at 10s and read at "confirmed".
- `KV` binding — used by `/resolve-payer` to cache the well-known OUI list
  (key `dc-mint-well-known-ouis`, 1h TTL), and read by `/price` for the
  `hntprice:snap` snapshot key **owned by hnt-price** (that tool writes it; this
  one only reads it and triggers its refresh).

## On-Chain Programs

| Program | ID |
|---------|----|
| Data Credits | `credMBJhYFzfn7NxBMdU4aUqFggAjgztaCcv2Fo6fPT` |
| Helium Sub-DAOs | `hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR` |
| Circuit Breaker | `circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g` |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |

**Token mints:** HNT `hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux` · DC
`dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm` · IOT
`iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns` · MOBILE
`mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6`.
**HNT price oracle account:** not hardcoded — read at build time from the
DataCreditsV0 account (`D1LbvrJQ9K2WbGPMbM3Fnrf5PSsDH1TDpjqJdHuvs81n`, byte
offset 104). Historically the legacy receiver feed
`4DdmDswskDxXGpwHrXUfn2CNUm9rt21ac79GHNTN3J33`; the pro receiver feed
`He5mhwVQQNvjFxqjEjFDb7enJWFwFJ7Rq7zknqBz89A5` after the #1207 cutover.

## References

- The `mint_data_credits_v0` / `delegate_data_credits_v0` instruction names and
  their hard-coded 8-byte discriminators live in `lib/solana.js`.
- Price sourcing (oracle account decoding, Jupiter spot fallback, the snapshot
  payload shape) lives in `worker/src/tools/hnt-price/` — its `README.md` is the
  API reference for the snapshot fields `/price` maps from.
