// HNT price snapshot assembly — the single place this tool reads a price from.
//
// Two independent sources, deliberately both surfaced rather than blended:
//
//   oracle — the Pyth `PriceUpdateV2` account that the Data Credits program's
//     `mint_data_credits_v0` instruction actually reads. Which account that is
//     is governance-controlled and rotates (the legacy → pro Pyth receiver
//     migration, helium-program-library #1207), so it is NEVER hardcoded here:
//     `resolveHntPriceOracle` reads it live from the DataCreditsV0 singleton.
//     A crank posts to this feed roughly every 5 minutes, so `oracle` is by
//     definition not a live market price. It IS the price a DC mint pays.
//
//   spot — Jupiter's aggregated market price for the HNT mint. Fresh, but not
//     what any on-chain program reads. Use it for display, never for sizing a
//     `mint_data_credits_v0` transaction.
//
// Everything lands in one KV snapshot (`hntprice:snap`) that /current serves
// cheaply, /instant rebuilds, the WebSocket hub polls, and the 15-minute cron
// keeps warm as a backstop for GET consumers when nobody is streaming.
//
// Two entry points onto the same work, and the difference is only the lock:
//   buildSnapshot(env)   — always live, always writes KV. For callers whose
//                          contract IS a live read (/instant) or who already
//                          serialize themselves (the singleton hub DO).
//   refreshSnapshot(env) — buildSnapshot behind a best-effort KV lock, for the
//                          uncoordinated racers (SWR background refreshes, cron).

import { kvGetJson, kvPutJson, withKvLock } from "../../../lib/kv.js";
import { HNT_MINT, resolveHntPriceOracle, rpcConnection } from "../../../lib/helium-solana.js";
import { fetchJupiterUsdPrices } from "../../../lib/jupiter.js";

/** KV key holding the latest assembled snapshot — the thing every surface serves. */
const SNAPSHOT_KEY = "hntprice:snap";

/** A snapshot older than this is considered stale and triggers a refresh. */
const SNAPSHOT_STALE_MS = 30_000;

/** DC is pegged: 100,000 DC = $1. */
export const DC_PER_USD = 100_000;

// Single-flight lock for `refreshSnapshot`, held for 60s — KV's *minimum*
// `expirationTtl`. `withKvLock` releases it in a `finally` on both the happy and
// unhappy paths, so the TTL only matters when the isolate dies mid-refresh, and
// then it self-clears within the minute.
const LOCK_KEY = "hntprice:lock";

// Safety net only. The snapshot is refreshed every 15 min by cron (and every
// 15s while anyone is streaming), so a live entry is never near this age. The
// TTL exists so a snapshot from a dead deploy eventually disappears rather than
// being served forever.
const SNAPSHOT_TTL_SECONDS = 4 * 60 * 60;

/**
 * Both price sources failed. Distinguished from a programming error so handlers
 * can answer 502 (upstream down) rather than 500 (we are broken).
 */
export class PriceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "PriceUnavailableError";
  }
}

/**
 * What a failing price surface says on the wire. Upstream failure messages can
 * name RPC hosts and client internals and this is a keyless public API, so the
 * detail goes to the log and the caller gets this constant. Shared by both
 * handlers, and documented verbatim in README.md.
 */
export const PUBLIC_PRICE_ERROR = "HNT price temporarily unavailable";

/** DC yielded per HNT burned at a given USD price. */
export function dcPerHnt(usd) {
  return Math.round(usd * DC_PER_USD);
}

// ---------------------------------------------------------------------------
// Pyth PriceUpdateV2 (the account mint_data_credits_v0 reads)
// ---------------------------------------------------------------------------
//
// Layout, all little-endian:
//   0    anchor discriminator      (8)
//   8    write_authority           (32)
//   40   verification_level        (1-byte borsh enum tag)
//          0 = Partial { num_signatures: u8 }  → one extra byte, message at 42
//          1 = Full                           → message at 41
//   ..   price_message:
//          +0   feed_id            (32)
//          +32  price              (i64)
//          +40  conf               (u64)
//          +48  exponent           (i32)
//          +52  publish_time       (i64)
//          +60  prev_publish_time  (i64)
//          +68  ema_price          (i64)
//          +76  ema_conf           (u64)
//   ..   posted_slot               (u64)

const VERIFICATION_LEVEL_OFFSET = 40;
const PRICE_MESSAGE_LENGTH = 84;

/**
 * Read and decode the HNT price oracle the DC mint program is pinned to.
 *
 * @param {import("@solana/web3.js").Connection} connection
 * @returns {Promise<{usd:number, conf_usd:number, mint_price_usd:number, publish_time:number, account:string}>}
 */
async function fetchOraclePrice(connection) {
  const oracle = await resolveHntPriceOracle(connection);
  const account = await connection.getAccountInfo(oracle, "confirmed");
  if (!account) {
    throw new Error(`HNT price oracle account ${oracle.toBase58()} not found on chain`);
  }

  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data);

  if (data.length < VERIFICATION_LEVEL_OFFSET + 1) {
    throw new Error(`HNT price oracle account too small: ${data.length} bytes`);
  }
  const verificationLevel = data[VERIFICATION_LEVEL_OFFSET];
  // Partial carries an extra num_signatures byte ahead of the message.
  let messageStart;
  if (verificationLevel === 1) messageStart = VERIFICATION_LEVEL_OFFSET + 1;
  else if (verificationLevel === 0) messageStart = VERIFICATION_LEVEL_OFFSET + 2;
  else throw new Error(`Unknown PriceUpdateV2 verification level ${verificationLevel}`);

  if (data.length < messageStart + PRICE_MESSAGE_LENGTH) {
    throw new Error(
      `HNT price oracle account truncated: ${data.length} bytes, need ${messageStart + PRICE_MESSAGE_LENGTH}`,
    );
  }

  const price = data.readBigInt64LE(messageStart + 32);
  const conf = data.readBigUInt64LE(messageStart + 40);
  const exponent = data.readInt32LE(messageStart + 48);
  const publishTime = data.readBigInt64LE(messageStart + 52);
  const emaPrice = data.readBigInt64LE(messageStart + 68);
  const emaConf = data.readBigUInt64LE(messageStart + 76);

  if (exponent > 0 || exponent < -18) {
    throw new Error(`Implausible PriceUpdateV2 exponent ${exponent} — layout may have changed`);
  }

  // The scale factor (10^expo, expo negative) is tiny; the mantissas are well
  // inside Number's exact-integer range for any realistic HNT price, so the
  // BigInt → Number conversion happens after the integer arithmetic that has to
  // be exact (the ema − 2×conf subtraction) and before the decimal scaling.
  const scale = 10 ** exponent;
  const usd = Number(price) * scale;
  if (!(usd > 0)) {
    throw new Error("HNT price oracle reported a non-positive price");
  }

  // Exactly what the DC mint program pays with: the conservative EMA, one
  // confidence interval either side removed.
  const mintPriceUsd = Number(emaPrice - 2n * emaConf) * scale;
  // `ema − 2×conf` is a subtraction, so a blown-out confidence interval can take
  // it to zero or below. That is not a price, and it would otherwise sail through
  // as a negative `dc_per_hnt`, since only the headline `usd` is checked above.
  // Fail the whole oracle half instead: the snapshot then publishes `oracle:
  // null` / `dc_per_hnt: null`, which every consumer already null-checks.
  if (!(mintPriceUsd > 0)) {
    throw new Error(
      `HNT price oracle mint price is non-positive (ema − 2×conf = ${mintPriceUsd})`,
    );
  }

  return {
    usd,
    conf_usd: Number(conf) * scale,
    mint_price_usd: mintPriceUsd,
    publish_time: Number(publishTime),
    account: oracle.toBase58(),
  };
}

// ---------------------------------------------------------------------------
// Jupiter spot
// ---------------------------------------------------------------------------

/**
 * Fresh aggregated market price for HNT, through the shared Jupiter client
 * (`worker/src/lib/jupiter.js`, also used by wallet-dashboard). A missing quote
 * is a failed source here — the caller settles it into a `spot: null` snapshot.
 *
 * @returns {Promise<{usd:number, source:string, updated_at:number}>}
 */
async function fetchSpotPrice() {
  const mint = HNT_MINT.toBase58();
  const usd = (await fetchJupiterUsdPrices([mint]))[mint];
  if (usd == null) {
    throw new Error("Jupiter price API returned no usable HNT price");
  }
  return { usd, source: "jupiter", updated_at: Math.floor(Date.now() / 1000) };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

// `async` so a config/URL problem becomes a rejection rather than a synchronous
// throw out of the Promise.allSettled below — a missing RPC URL should degrade
// to a spot-only snapshot, not kill the whole refresh. `rpcConnection` (shared
// lib) caps every RPC round trip at 10s, so a hung endpoint rejects the oracle
// half instead of holding the build open.
async function oracleRead(env) {
  if (!env.SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL is not configured");
  return fetchOraclePrice(rpcConnection(env.SOLANA_RPC_URL));
}

/**
 * Read both sources live, assemble the snapshot, persist it to KV, return it.
 *
 * Unlocked and unconditional: this always does the work. Call it directly when
 * the caller's contract IS a live read (`/instant`) or when the caller is
 * already serialized (the hub is a singleton DO, so wrapping its 15s poll in
 * the KV lock would spend three KV ops a tick protecting it from itself).
 * Uncoordinated callers that can pile up — the SWR background refresh, cron —
 * want `refreshSnapshot` instead.
 *
 * Throws `PriceUnavailableError` only when BOTH sources failed.
 */
export async function buildSnapshot(env) {
  // A snapshot with one half missing is far more useful than none, so these are
  // settled independently. Only a double failure is fatal.
  const [oracleResult, spotResult] = await Promise.allSettled([oracleRead(env), fetchSpotPrice()]);

  const oracle = oracleResult.status === "fulfilled" ? oracleResult.value : null;
  const spot = spotResult.status === "fulfilled" ? spotResult.value : null;

  if (!oracle) console.error("hnt-price oracle read failed", oracleResult.reason?.message);
  if (!spot) console.error("hnt-price spot fetch failed", spotResult.reason?.message);

  if (!oracle && !spot) {
    const reasons = [oracleResult.reason?.message, spotResult.reason?.message]
      .filter(Boolean)
      .join("; ");
    throw new PriceUnavailableError(reasons || "both HNT price sources failed");
  }

  const payload = {
    symbol: "HNT",
    spot,
    oracle,
    // DC yielded per HNT burned, at the conservative price the program uses.
    dc_per_hnt: oracle ? dcPerHnt(oracle.mint_price_usd) : null,
    dc_per_usd: DC_PER_USD,
    snapshot_at: Date.now(),
  };

  await kvPutJson(env, SNAPSHOT_KEY, payload, SNAPSHOT_TTL_SECONDS);
  return payload;
}

/**
 * `buildSnapshot` behind a best-effort single-flight lock.
 *
 * If another refresh holds the lock we serve the stored snapshot rather than
 * duplicating the chain read, so N concurrent callers cost one RPC round trip.
 * With nothing stored to fall back on we do the work anyway — every caller of
 * this function needs a payload, so it never resolves undefined.
 *
 * That contended fallback is why this is NOT the entry point for `/instant`:
 * returning a cached payload would break a documented live read. It is the right
 * entry point for the SWR background refreshes and the cron, which want the
 * freshest thing available and are happy to skip redundant work.
 *
 * Throws `PriceUnavailableError` only when BOTH sources failed.
 */
export async function refreshSnapshot(env) {
  const { contended, result } = await withKvLock(env, LOCK_KEY, 60, () => buildSnapshot(env));
  if (!contended) return result;
  return (await getStoredSnapshot(env)) ?? buildSnapshot(env);
}

/** Read the stored snapshot without touching the chain. `null` when cold. */
export function getStoredSnapshot(env) {
  return kvGetJson(env, SNAPSHOT_KEY);
}

/** True when a stored snapshot is young enough to serve without refreshing. */
function isFresh(snapshot) {
  return Boolean(snapshot) && Date.now() - snapshot.snapshot_at < SNAPSHOT_STALE_MS;
}

// Per-isolate dedupe for the stale-path background refresh. The KV lock already
// stops isolates from duplicating each other's chain read, but within one
// isolate a request burst arriving the moment the snapshot goes stale would
// still schedule one `refreshSnapshot` per request — each paying for the lock's
// KV round trips just to be told it lost. One shared promise collapses the burst
// into a single refresh, cleared as soon as it settles.
let inflightRefresh = null;

/**
 * Stale-while-revalidate read — the policy every cheap GET surface wants, in one
 * place. Serve whatever is stored; if it has gone stale, refresh behind the
 * response so the *next* caller gets the fresh one; only a cold cache pays for a
 * live build inline.
 *
 * Shared rather than per-handler because both `/hnt-price/current` and dc-mint's
 * `/dc-mint/price` are the same read of the same KV key and drifting them apart
 * would give the two surfaces different staleness behavior.
 *
 * @param {object} env
 * @param {{waitUntil: (p: Promise<unknown>) => void}} [ctx] Worker execution
 *   context. Without it a stale snapshot is still served, just with no
 *   background refresh scheduled (nothing would keep the promise alive).
 * @returns {Promise<object>} the snapshot payload
 * @throws when the cache is cold AND the inline build fails
 *   (`PriceUnavailableError` if both upstreams were the reason).
 */
export async function getSnapshotSwr(env, ctx) {
  const stored = await getStoredSnapshot(env);

  if (stored) {
    if (!isFresh(stored) && ctx) {
      inflightRefresh ??= refreshSnapshot(env).finally(() => {
        inflightRefresh = null;
      });
      ctx.waitUntil(
        inflightRefresh.catch((err) =>
          console.error("hnt-price background refresh failed", err?.message),
        ),
      );
    }
    return stored;
  }

  // Cold start — nothing stored to serve, so build it now and pay for it once.
  return refreshSnapshot(env);
}
