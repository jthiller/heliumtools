// Vote tool — pure helpers shared by the handlers.

import { PublicKey } from "@solana/web3.js";
import { VOTE_WEIGHT_DECIMALS, DEFAULT_PROPOSAL } from "./config.js";

const WEIGHT_SCALE = 10n ** BigInt(VOTE_WEIGHT_DECIMALS);

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
 * Resolve the `id` query param (falling back to the default proposal) into
 * `{ id, address }`, or null if it's not a valid address. Shared by every
 * handler so the parse/default/validate rule lives in one place.
 */
export function resolveProposal(url) {
  const id = parseProposalId(url.searchParams.get("id") || DEFAULT_PROPOSAL);
  return id ? { id, address: id.toBase58() } : null;
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
