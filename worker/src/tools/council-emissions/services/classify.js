// Classify one HNT movement relative to a traced wallet. Pure: reads only the
// parsed record (program IDs, token and lamport deltas) and the label resolver.
// Signers and explorer-style English descriptions are never used.

import { DC_MINT, DELEGATOR_POOL, PROGRAMS, SWAP_PROGRAMS } from "../config.js";

// A swap that returns SOL shows up as a lamport gain for the sender. Closing a
// token account refunds ~0.002 SOL of rent in the same way, so without a known
// swap program only a clearly larger gain counts.
const SOL_GAIN_SWAP_LAMPORTS = 50_000_000;

function positiveGains(record, owner) {
  const out = [];
  for (const [mint, delta] of Object.entries(record.other?.[owner] || {})) {
    if (BigInt(delta) > 0n) out.push({ mint, amount: delta });
  }
  const lamports = record.sol?.[owner] || 0;
  return { tokens: out, lamports };
}

function swapVenue(programs) {
  for (const p of programs) if (SWAP_PROGRAMS[p]) return SWAP_PROGRAMS[p];
  return null;
}

/**
 * An HNT movement OUT of a traced wallet.
 * @returns {{ kind: string, terminal: boolean, label?: object, venue?: string, swapOut?: object[], note?: string }}
 *   kind: vehnt | dc_burn | swapped | program_other | exchange | exchange_deposit | council | transfer
 *   terminal: the HNT's use is settled here (false = keep following it)
 */
export function classifyOutflow({ move, fromOwner, toOwner, record, label, isSeat, isTraced = () => false }) {
  const programs = new Set(record.programs || []);

  if (move.type === "burn") {
    const gainedDc = BigInt(record.other?.[fromOwner]?.[DC_MINT] || "0") > 0n;
    if (programs.has(PROGRAMS.dataCredits) || gainedDc) return { kind: "dc_burn", terminal: true };
    return { kind: "program_other", terminal: true, note: "Burned" };
  }

  // The destination decides first: a tx can also swap or touch veHNT, but HNT
  // landing on a seat, an exchange or a wallet already followed went there.
  if (toOwner && isSeat(toOwner)) return { kind: "council", terminal: false };
  const lab = label(toOwner);
  if (lab?.kind === "exchange_hot") return { kind: "exchange", terminal: true, label: lab };
  if (lab?.kind === "exchange_deposit") return { kind: "exchange_deposit", terminal: false, label: lab };
  if (toOwner && isTraced(toOwner)) return { kind: "transfer", terminal: false, label: lab };

  // HNT into a voter-stake-registry position vault is a veHNT lock.
  if (programs.has(PROGRAMS.voterStakeRegistry)) return { kind: "vehnt", terminal: true };

  const venue = swapVenue(programs);
  const gains = positiveGains(record, fromOwner);
  const solSwap = gains.lamports >= (venue ? 1 : SOL_GAIN_SWAP_LAMPORTS);
  if (venue || gains.tokens.length || solSwap) {
    const swapOut = [...gains.tokens];
    if (gains.lamports > 0 && (venue || solSwap)) swapOut.push({ mint: "SOL", amount: String(gains.lamports) });
    if (venue || swapOut.length) return { kind: "swapped", terminal: true, venue: venue || "Swap", swapOut };
  }

  return { kind: "transfer", terminal: false, label: lab };
}

/**
 * An HNT movement INTO a traced wallet from outside the traced set.
 * @returns {string} vehnt_rewards | vehnt_unlock | bought | helium_ops | received
 */
export function classifyInflow({ move, fromOwner, toOwner, record, label }) {
  const programs = new Set(record.programs || []);
  if (move.from === DELEGATOR_POOL) return "vehnt_rewards";
  if (programs.has(PROGRAMS.voterStakeRegistry)) return "vehnt_unlock";
  if (swapVenue(programs)) return "bought";
  for (const delta of Object.values(record.other?.[toOwner] || {})) {
    if (BigInt(delta) < 0n) return "bought";
  }
  if (label(fromOwner)?.kind === "helium_ops") return "helium_ops";
  return "received";
}
