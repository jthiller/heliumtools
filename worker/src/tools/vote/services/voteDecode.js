// Shared VSR (voter-stake-registry) instruction decoding for the vote tool.
// Consumed by the per-voter timeline (voteHistory.js), the flip resolver
// (flips.js), and the recent-activity feed (builders.js).
//
// All vote AND relinquish variants take `{ choice: u16 }` as their first arg
// (verified against helium-program-library), so the choice is always the u16 at
// byte offset 8 (after the 8-byte Anchor discriminator). Variants are
// distinguished by discriminator into vote vs relinquish.

import bs58 from "bs58";
import { VSR_PROGRAM } from "../../../lib/helium-solana.js";

const VSR = VSR_PROGRAM.toBase58();
const key = (disc) => disc.join(",");

// sha256("global:<name>")[..8], computed once. vote vs relinquish actions.
const VOTE_DISCS = new Set([
  key([82, 47, 20, 22, 108, 59, 245, 115]),   // vote_v0
  key([138, 145, 60, 51, 185, 167, 162, 158]), // proxied_vote_v0
  key([190, 176, 85, 200, 29, 248, 0, 127]),   // proxied_vote_v1
]);
const RELINQUISH_DISCS = new Set([
  key([142, 201, 65, 226, 112, 136, 248, 102]), // relinquish_vote_v1
  key([233, 48, 26, 36, 62, 170, 79, 158]),     // proxied_relinquish_vote_v0
  key([68, 205, 48, 30, 164, 62, 0, 70]),       // proxied_relinquish_vote_v1
]);

/** One VSR instruction → { action, choice, accounts } or null if not a vote/relinquish. */
export function decodeVsrInstruction(ix) {
  if (ix.programId !== VSR || typeof ix.data !== "string") return null;
  let bytes;
  try {
    bytes = Buffer.from(bs58.decode(ix.data));
  } catch {
    return null;
  }
  if (bytes.length < 8) return null;
  const disc = key([...bytes.subarray(0, 8)]);
  const action = VOTE_DISCS.has(disc) ? "vote" : RELINQUISH_DISCS.has(disc) ? "relinquish" : null;
  if (!action) return null;
  const choice = bytes.length >= 10 ? bytes.readUInt16LE(8) : null;
  return { action, choice, accounts: Array.isArray(ix.accounts) ? ix.accounts : [] };
}

/**
 * All VSR vote/relinquish instructions in a transaction, scanning BOTH top-level
 * and inner (CPI) instructions — proxy/crank-applied votes arrive as inner
 * instructions, so a top-level-only scan would miss them.
 */
export function decodeVoteInstructions(tx) {
  const top = tx?.transaction?.message?.instructions || [];
  const inner = (tx?.meta?.innerInstructions || []).flatMap((g) => g.instructions || []);
  return [...top, ...inner].map(decodeVsrInstruction).filter(Boolean);
}

/**
 * VSR vote/relinquish actions in a transaction that apply to `marker`. When a tx
 * batches votes for many positions, the marker must appear in the instruction's
 * accounts; if exactly one VSR vote instruction exists we attribute it even when
 * account matching is inconclusive (single-vote tx).
 */
export function actionsForMarker(tx, marker) {
  const decoded = decodeVoteInstructions(tx);
  if (decoded.length === 0) return [];
  const matching = decoded.filter((d) => d.accounts.includes(marker));
  let chosen;
  if (matching.length > 0) {
    chosen = matching;
  } else if (decoded.length === 1) {
    chosen = decoded; // single vote in the tx — attribute it
  } else {
    // Batched (many positions in one tx) and account-matching was inconclusive:
    // if every VSR vote in the tx is the same action+choice, it's unambiguous.
    const uniform = decoded.every((d) => d.action === decoded[0].action && d.choice === decoded[0].choice);
    chosen = uniform ? [decoded[0]] : [];
  }
  return chosen.map((d) => ({ action: d.action, choice: d.choice }));
}
