// Per-voter flip history: the timeline of vote actions on a single VoteMarkerV0.
// A "flip" reuses the same marker PDA (["marker", mint, proposal]), so the
// marker accumulates transactions (vote → relinquish → re-vote). The choice at
// each step lives in the instruction data, not the account — so we read the
// marker's transactions and decode each VSR vote/relinquish instruction
// (decoding lives in voteDecode.js, shared with the flip resolver + activity feed).

import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import { getSignaturesForAddress, getTransaction } from "./rpc.js";
import { getVoterMarkers } from "./history.js";
import { actionsForMarker } from "./voteDecode.js";
import { VOTER_HISTORY_CACHE_TTL, MAX_VOTER_HISTORY_MARKERS } from "../config.js";

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

/**
 * Parse one marker's transactions into [{ ts, action, choice, signature }]. If
 * nothing decodes (an unrecognized CPI shape), fall back to bare timestamped
 * entries so the timeline shows *when* the voter acted rather than nothing.
 */
async function markerActions(env, marker, fallbackChoice) {
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
    acts.map((a) => ({
      ts: s.blockTime ?? null,
      signature: s.signature,
      marker,
      action: a.action,
      // Decoded choice when we have it; else the marker's current direction.
      choice: a.choice ?? fallbackChoice,
    })),
  );
  if (decoded.length > 0) return decoded;
  // Nothing decoded (unrecognized CPI shape) — still show *when* the voter acted,
  // with the marker's current direction so the row isn't just "VOTED".
  return perSig.map(({ s }) => ({
    ts: s.blockTime ?? null,
    signature: s.signature,
    marker,
    action: "vote",
    choice: fallbackChoice,
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
  const perMarker = await mapLimit(markers, MARKER_TX_CONCURRENCY, (m) =>
    markerActions(env, m.marker, m.choices?.[0] ?? null),
  );
  const actions = perMarker.flat().sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

  const body = { proposal, voter, actions };
  await kvPutJson(env, cacheKey, body, VOTER_HISTORY_CACHE_TTL);
  return body;
}
