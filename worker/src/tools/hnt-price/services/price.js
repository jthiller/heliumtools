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

import { Connection } from "@solana/web3.js";
import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import { resolveHntPriceOracle } from "../../../lib/helium-solana.js";
import { HNT_MINT } from "../../dc-purchase/lib/constants.js";

/** KV key holding the latest assembled snapshot. Read by handlers, the hub, and dc-mint. */
export const SNAPSHOT_KEY = "hntprice:snap";

/** A snapshot older than this is considered stale and triggers a refresh. */
const SNAPSHOT_STALE_MS = 30_000;

/** DC is pegged: 100,000 DC = $1. */
export const DC_PER_USD = 100_000;

// Single-flight lock. 60s is KV's *minimum* `expirationTtl` — anything lower is
// rejected outright, and since `acquireLock` fails open that rejection would
// silently make the lock inert forever. The lock is also released in a `finally`
// on both the happy and unhappy paths, so the TTL only matters when the isolate
// dies mid-refresh, and then it self-clears within the minute.
const LOCK_KEY = "hntprice:lock";
const LOCK_TTL_SECONDS = 60;

// Safety net only. The snapshot is refreshed every 15 min by cron (and every
// 15s while anyone is streaming), so a live entry is never near this age. The
// TTL exists so a snapshot from a dead deploy eventually disappears rather than
// being served forever.
const SNAPSHOT_TTL_SECONDS = 4 * 60 * 60;

const JUPITER_PRICE_URL = "https://lite-api.jup.ag/price/v3";
const UPSTREAM_TIMEOUT_MS = 10_000;

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
 * @param {Connection} connection
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
 * Fresh aggregated market price for HNT. Mirrors the endpoint and response
 * shape wallet-dashboard's `services/prices.js` already relies on. CoinGecko is
 * intentionally avoided — it blocks Cloudflare Worker egress IPs.
 *
 * @returns {Promise<{usd:number, source:string, updated_at:number}>}
 */
async function fetchSpotPrice() {
  const res = await fetch(`${JUPITER_PRICE_URL}?ids=${HNT_MINT}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Jupiter price API returned ${res.status}`);
  }
  const data = await res.json();
  const usd = data?.[HNT_MINT]?.usdPrice;
  if (typeof usd !== "number" || !(usd > 0)) {
    throw new Error("Jupiter price API returned no usable HNT price");
  }
  return { usd, source: "jupiter", updated_at: Math.floor(Date.now() / 1000) };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

// Best-effort single-flight lock. KV has no atomic put-if-absent, so a rare
// race just means two refreshes — harmless. If KV is unavailable we allow the
// refresh rather than block it.
async function acquireLock(env) {
  if (!env.KV) return true;
  try {
    if (await env.KV.get(LOCK_KEY)) return false;
    await env.KV.put(LOCK_KEY, "1", { expirationTtl: LOCK_TTL_SECONDS });
    return true;
  } catch {
    return true;
  }
}

async function releaseLock(env) {
  if (!env.KV) return;
  try {
    await env.KV.delete(LOCK_KEY);
  } catch {
    /* lock self-expires via TTL */
  }
}

// web3.js applies no timeout of its own, so a hung RPC would hold the snapshot
// build (and, on /instant, the caller's request) open until the platform kills
// the isolate — with nothing logged and no spot-only fallback. `fetch` is a
// supported ConnectionConfig override, so every RPC POST this Connection makes
// (resolveHntPriceOracle's DataCreditsV0 read and the feed getAccountInfo) gets
// the same ceiling the Jupiter fetch has. Missing the deadline rejects the
// oracle half, which degrades to a spot-only snapshot.
function rpcConnection(url) {
  return new Connection(url, {
    commitment: "confirmed",
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }),
  });
}

// Construct the oracle read lazily and never let a config/URL problem throw
// synchronously out of the Promise.allSettled below — a missing RPC URL should
// degrade to a spot-only snapshot, not kill the whole refresh.
function oracleRead(env) {
  try {
    if (!env.SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL is not configured");
    return fetchOraclePrice(rpcConnection(env.SOLANA_RPC_URL));
  } catch (err) {
    return Promise.reject(err);
  }
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
    dc_per_hnt: oracle ? Math.round(oracle.mint_price_usd * DC_PER_USD) : null,
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
  const gotLock = await acquireLock(env);
  if (!gotLock) {
    const stored = await kvGetJson(env, SNAPSHOT_KEY);
    if (stored) return stored;
    return buildSnapshot(env);
  }
  try {
    return await buildSnapshot(env);
  } finally {
    await releaseLock(env);
  }
}

/** Read the stored snapshot without touching the chain. `null` when cold. */
export function getStoredSnapshot(env) {
  return kvGetJson(env, SNAPSHOT_KEY);
}

/** True when a stored snapshot is young enough to serve without refreshing. */
export function isFresh(snapshot) {
  return Boolean(snapshot) && Date.now() - snapshot.snapshot_at < SNAPSHOT_STALE_MS;
}

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
      ctx.waitUntil(
        refreshSnapshot(env).catch((err) =>
          console.error("hnt-price background refresh failed", err?.message),
        ),
      );
    }
    return stored;
  }

  // Cold start — nothing stored to serve, so build it now and pay for it once.
  return refreshSnapshot(env);
}
