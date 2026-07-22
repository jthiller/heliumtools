# DC Mint

Mints Data Credits by burning HNT on Solana, and optionally delegates the
freshly-minted DC to a router/OUI escrow. DC is priced at a fixed 100,000 DC = $1
(`DC_PER_USD` in `handlers/price.js`). This is both a standalone tool (`/dc-mint`)
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
- `GET /price` — current HNT/USD from Pyth Hermes (`hermes.pyth.network`), returned
  as `{ hnt_usd, confidence, dc_per_hnt, dc_per_usd, timestamp }` for the client's
  HNT↔DC conversion preview. In-memory cached 15s (module-level, per isolate).
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
  circuit-breaker program, token/ATA program IDs, and Pyth feed account are
  defined inline here because `dc-purchase` doesn't export them. Key pieces:
  - `buildMintInstruction(owner, {hnt_amount|dc_amount}, recipient, hntDecimals)`
    — hand-encodes the Anchor instruction. The `mint_data_credits_v0` args are an
    Anchor 8-byte discriminator (`4e 6d a9 84 90 5e dd 39`) followed by **two
    Borsh `Option<u64>`** fields: `hnt_amount` then `dc_amount`. Exactly one is
    `Some` (tag byte `1` + u64 LE), the other `None` (tag byte `0`). Account list
    includes the HNT Pyth price feed (`4DdmDsws…N3J33`) so the program reads the
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
  compute the other side, so the on-chain result can differ slightly from the
  client's `/price` preview (which is a separate 15s-cached Pyth Hermes read).
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
- `/price` cache is a plain module-level variable, so it is per-isolate, not shared
  across Cloudflare instances — fine for a soft 15s smoothing, not a hard cache.
- Escrow balance in `/resolve-payer` is read as a raw `u64 LE` at byte 64 of the
  escrow account; a `null` result means the escrow PDA does not exist yet (router
  has never received delegated DC on that subnet).

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
- **wallet-dashboard** (`worker/src/tools/wallet-dashboard/`) — its `config.js`
  comment points at this tool's price handler for the 100,000 DC = $1 fixed value.

## Environment / Secrets

- `SOLANA_RPC_URL` — Helius staked endpoint, used to fetch blockhash and account
  data when building/resolving (never log or expose).
- `KV` binding — used by `/resolve-payer` to cache the well-known OUI list
  (key `dc-mint-well-known-ouis`, 1h TTL).

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
**HNT Pyth price feed account:** `4DdmDswskDxXGpwHrXUfn2CNUm9rt21ac79GHNTN3J33`.

## References

- The `mint_data_credits_v0` / `delegate_data_credits_v0` instruction names and
  their hard-coded 8-byte discriminators live in `lib/solana.js`.
- Pyth Hermes: `https://hermes.pyth.network` (HNT/USD feed id
  `649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756`).
