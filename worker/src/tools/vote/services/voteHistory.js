// Per-voter flip history: the timeline of vote actions on a single VoteMarkerV0.
// A "flip" reuses the same marker PDA (["marker", mint, proposal]), so the
// marker accumulates transactions (vote → relinquish → re-vote). The choice at
// each step lives in the instruction data, not the account — so we read the
// marker's transactions and decode each VSR vote/relinquish instruction.
//
// All vote AND relinquish variants take `{ choice: u16 }` as their first arg
// (verified against helium-program-library), so the choice is always the u16 at
// byte offset 8 (after the 8-byte Anchor discriminator). Variants are
// distinguished by discriminator into vote vs relinquish.

import bs58 from "bs58";
import { VSR_PROGRAM } from "../../../lib/helium-solana.js";
import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import { getSignaturesForAddress, getTransaction } from "./rpc.js";
import { getVoterMarkers } from "./history.js";
import { VOTER_HISTORY_CACHE_TTL, MAX_VOTER_HISTORY_MARKERS } from "../config.js";

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

const MARKER_TX_CONCURRENCY = 6;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function decodeVsrInstruction(ix) {
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
 * VSR vote/relinquish actions in a transaction that apply to `marker`. Scans
 * BOTH top-level and inner (CPI) instructions — proxy/crank-applied votes arrive
 * as inner instructions, so a top-level-only scan would miss them. When a tx
 * batches votes for many positions, the marker must appear in the instruction's
 * accounts; if exactly one VSR vote instruction exists we attribute it even when
 * account matching is inconclusive (single-vote tx).
 */
function actionsForMarker(tx, marker) {
  const top = tx?.transaction?.message?.instructions || [];
  const inner = (tx?.meta?.innerInstructions || []).flatMap((g) => g.instructions || []);
  const decoded = [...top, ...inner].map(decodeVsrInstruction).filter(Boolean);
  if (decoded.length === 0) return [];
  const matching = decoded.filter((d) => d.accounts.includes(marker));
  const chosen = matching.length > 0 ? matching : decoded.length === 1 ? decoded : [];
  return chosen.map((d) => ({ action: d.action, choice: d.choice }));
}

/**
 * Parse one marker's transactions into [{ ts, action, choice, signature }]. If
 * nothing decodes (an unrecognized CPI shape), fall back to bare timestamped
 * entries so the timeline shows *when* the voter acted rather than nothing.
 */
async function markerActions(env, marker) {
  const sigs = await getSignaturesForAddress(env, marker, { limit: 1000 });
  const perSig = await mapLimit([...sigs].reverse(), MARKER_TX_CONCURRENCY, async (s) => {
    try {
      const tx = await getTransaction(env, s.signature);
      return { s, acts: actionsForMarker(tx, marker) };
    } catch {
      return { s, acts: [] };
    }
  });

  const decoded = perSig.flatMap(({ s, acts }) =>
    acts.map((a) => ({ ts: s.blockTime ?? null, signature: s.signature, marker, ...a })),
  );
  if (decoded.length > 0) return decoded;
  // Fallback: surface the transaction timestamps even without decoded choices.
  return perSig.map(({ s }) => ({
    ts: s.blockTime ?? null,
    signature: s.signature,
    marker,
    action: null,
    choice: null,
  }));
}

/**
 * Build a voter's merged vote-action timeline across all their positions on a
 * proposal (oldest first), parsed from each marker's transactions. KV-cached.
 * Returns { proposal, voter, actions: [{ ts, action, choice, signature, marker }] }.
 */
export async function getVoterHistory(env, proposal, voter) {
  const cacheKey = `vote:vhist:${proposal}:${voter}`;
  const cached = await kvGetJson(env, cacheKey);
  if (cached) return cached;

  // Only the voter's flipped positions are worth a timeline (a non-flipped
  // position is a single vote), and capping bounds the getTransaction fan-out.
  const markers = (await getVoterMarkers(env, proposal, voter, { flippedOnly: true }))
    .slice(0, MAX_VOTER_HISTORY_MARKERS);
  const perMarker = await mapLimit(markers, MARKER_TX_CONCURRENCY, (m) => markerActions(env, m));
  const actions = perMarker.flat().sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

  const body = { proposal, voter, actions };
  await kvPutJson(env, cacheKey, body, VOTER_HISTORY_CACHE_TTL);
  return body;
}
