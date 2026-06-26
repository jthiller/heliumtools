// Vote tool — pure helpers shared by the handlers.

import { PublicKey } from "@solana/web3.js";
import { VOTE_WEIGHT_DECIMALS } from "./config.js";

const WEIGHT_SCALE = 10n ** BigInt(VOTE_WEIGHT_DECIMALS);

/** Read JSON from KV, swallowing errors — the cache must never fail a request. */
export async function kvGetJson(env, key) {
  if (!env.KV) return null;
  try {
    return await env.KV.get(key, "json");
  } catch {
    return null;
  }
}

/** Write JSON to KV with a TTL, swallowing errors (best-effort cache). */
export async function kvPutJson(env, key, value, ttlSeconds) {
  if (!env.KV) return;
  try {
    await env.KV.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch {
    // best-effort
  }
}

/** Loose base58 signature shape check (Solana tx signatures are 87-88 chars). */
const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{43,90}$/;
export function isValidSignature(s) {
  return typeof s === "string" && BASE58_SIG.test(s);
}

/** Parse a base58 string into a PublicKey, or return null if invalid. */
export function parseProposalId(input) {
  if (!input || typeof input !== "string") return null;
  try {
    return new PublicKey(input.trim());
  } catch {
    return null;
  }
}

/**
 * Convert a raw u128 vote weight (veHNT in native units) into a human veHNT
 * number. The whole part is bounded well below 2^53 for any realistic total
 * supply, so this stays precise; only sub-1e-8 fractional dust is lost.
 */
export function weightToVeHnt(weight) {
  const whole = weight / WEIGHT_SCALE;
  const frac = weight % WEIGHT_SCALE;
  return Number(whole) + Number(frac) / Number(WEIGHT_SCALE);
}

/**
 * Tally a proposal's choices into display results + the total weight.
 * Percent matches heliumvote's useProposalStatus: weight * 10000 / total / 100.
 */
export function tallyChoices(choices) {
  const total = choices.reduce((acc, c) => acc + c.weight, 0n);
  let leadingIndex = -1;
  let leadingWeight = -1n;
  const results = choices.map((c) => {
    if (total > 0n && c.weight > leadingWeight) {
      leadingWeight = c.weight;
      leadingIndex = c.index;
    }
    return {
      index: c.index,
      name: c.name,
      uri: c.uri,
      weight: c.weight.toString(),
      veHnt: weightToVeHnt(c.weight),
      percent: total > 0n ? Number((c.weight * 10000n) / total) / 100 : 0,
    };
  });
  return { totalWeight: total, results, leadingIndex };
}

/**
 * Map ProposalState → a UI status, faithfully reproducing helium-vote's
 * getDerivedProposalState (src/lib/utils.ts): pass/fail for binary proposals is
 * inferred from the resolved winning choice's label text.
 */
export function deriveStatus(state, choices) {
  switch (state.kind) {
    case "voting": return "active";
    case "cancelled": return "cancelled";
    case "draft": return "draft";
    case "resolved": {
      if (choices.length > 2) return "completed";
      const won = state.winningChoices || [];
      const startsWith = (i, p) => choices[i] && choices[i].name.startsWith(p);
      if (
        (won.length === 1 && startsWith(won[0], "For")) ||
        (won.length === 1 && startsWith(won[0], "Yes")) ||
        won.length > 1
      ) {
        return "passed";
      }
      if (
        won.length === 0 ||
        (won.length === 1 && startsWith(won[0], "Against")) ||
        (won.length === 1 && startsWith(won[0], "No"))
      ) {
        return "failed";
      }
      return "completed";
    }
    default: return "unknown";
  }
}

/** Start/end timestamps (unix seconds) for the proposal, when known. */
export function proposalTiming(state) {
  if (state.kind === "voting") return { startTs: state.startTs, endTs: null };
  if (state.kind === "resolved") return { startTs: null, endTs: state.endTs };
  return { startTs: null, endTs: null };
}
