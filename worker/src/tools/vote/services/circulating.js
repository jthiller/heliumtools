// Total circulating veHNT — the denominator for "what % of the available vote
// has participated." The proposal/registrar carry no total, so we enumerate
// every HNT PositionV0 on-chain and sum each one's CURRENT voting power.
//
// This is a heavy getProgramAccounts (one entry per position network-wide), so
// it is computed on a slow cadence (CIRCULATING_CACHE_TTL), single-flight, and
// KV-cached. Viewers only read the cached number; the cron triggers refreshes;
// a failure here never blocks the vote snapshot (the caller try/catches and the
// participation line just doesn't render).
//
// The on-chain veHNT formula and the position/registrar layouts are owned by the
// ve-hnt tool — we reuse those pure functions rather than duplicate the math
// (which must stay byte-for-byte in sync with voter-stake-registry). If a third
// consumer appears, hoist computeVeHnt + the decoders to a shared lib.

import bs58 from "bs58";
import { VSR_PROGRAM, HNT_REGISTRAR_KEY } from "../../../lib/helium-solana.js";
import { decodeRegistrar, LOCKUP_KIND } from "../../ve-hnt/services/decode.js";
import { computeVeHnt } from "../../ve-hnt/services/compute.js";
import { getAccount, getProgramAccounts } from "./rpc.js";
import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import { weightToVeHnt } from "../utils.js";
import {
  POSITION_DISCRIMINATOR,
  POSITION_VP_SLICE,
  CIRCULATING_CACHE_TTL,
  CIRCULATING_LOCK_TTL,
} from "../config.js";

const CACHE_KEY = "vote:circulating";
const LOCK_KEY = "vote:circulating:lock";
const POSITION_DISC_B58 = bs58.encode(Buffer.from(POSITION_DISCRIMINATOR));

// Decode only the voting-power inputs from a POSITION_VP_SLICE window (bytes
// [72,108) of PositionV0). Field offsets are relative to the slice start.
// Exported for unit tests (the slice offsets are fragile and untestable live).
export function decodePositionPower(buf) {
  const startTs = Number(buf.readBigInt64LE(0));
  const endTs = Number(buf.readBigInt64LE(8));
  const kind = LOCKUP_KIND[buf.readUInt8(16)] || "Unknown";
  const amountDepositedNative = buf.readBigUInt64LE(17);
  const votingMintConfigIdx = buf.readUInt8(25);
  // bytes 26..28 = num_active_votes (unused)
  const genesisEnd = Number(buf.readBigInt64LE(28));
  return { lockup: { startTs, endTs, kind }, amountDepositedNative, votingMintConfigIdx, genesisEnd };
}

/** The cached circulating-veHNT figure, or null if not computed yet. */
export function getCirculatingVeHnt(env) {
  return kvGetJson(env, CACHE_KEY);
}

/**
 * Enumerate every HNT position and sum current voting power. Returns
 * { veHntNative, veHnt, positions, asOf } or null on failure.
 */
async function computeCirculatingVeHnt(env) {
  const reg = await getAccount(env, HNT_REGISTRAR_KEY);
  if (!reg) return null;
  const registrar = decodeRegistrar(reg.buf);

  const accounts = await getProgramAccounts(
    env,
    VSR_PROGRAM,
    [
      { offset: 0, bytesBase58: POSITION_DISC_B58 },
      { offset: 8, bytesBase58: HNT_REGISTRAR_KEY.toBase58() },
    ],
    { timeoutMs: 60_000, dataSlice: POSITION_VP_SLICE },
  );

  const nowTs = Math.floor(Date.now() / 1000);
  let total = 0n;
  let counted = 0;
  for (const { buf } of accounts) {
    if (!buf || buf.length < POSITION_VP_SLICE.length) continue;
    try {
      const pos = decodePositionPower(buf);
      const vmc = registrar.votingMints[pos.votingMintConfigIdx] || registrar.votingMints[0];
      if (!vmc) continue;
      total += computeVeHnt(pos, vmc, nowTs).veHnt;
      counted++;
    } catch {
      /* skip an undecodable position */
    }
  }

  const result = { veHntNative: total.toString(), veHnt: weightToVeHnt(total), positions: counted, asOf: Date.now() };
  console.log(JSON.stringify({ event: "vote_circulating_computed", positions: counted, veHnt: result.veHnt }));
  return result;
}

/**
 * Refresh the cached circulating veHNT if stale, single-flight. Cheap (one KV
 * read) when the cache is fresh — safe to call every cron tick. Returns the
 * current figure (fresh, just-computed, or last-known stale) or null.
 */
export async function refreshCirculatingVeHnt(env) {
  const cached = await kvGetJson(env, CACHE_KEY);
  if (cached && Date.now() - cached.asOf < CIRCULATING_CACHE_TTL * 1000) return cached;

  // Best-effort single-flight: if another run holds the lock, keep serving the
  // stale value rather than launching a second heavy enumeration.
  if (env.KV) {
    try {
      if (await env.KV.get(LOCK_KEY)) return cached;
      await env.KV.put(LOCK_KEY, "1", { expirationTtl: CIRCULATING_LOCK_TTL });
    } catch {
      /* KV unavailable — fall through and compute */
    }
  }
  try {
    const fresh = await computeCirculatingVeHnt(env);
    if (fresh) await kvPutJson(env, CACHE_KEY, fresh, CIRCULATING_CACHE_TTL * 2);
    return fresh || cached;
  } finally {
    if (env.KV) {
      try { await env.KV.delete(LOCK_KEY); } catch { /* self-expires via TTL */ }
    }
  }
}
