// Pure data builders — fetch from the RPC and shape the response objects. No
// caching here: callers (the cron snapshotter and the cold-start path) decide
// when to run these, so per-viewer requests never reach them in steady state.

import bs58 from "bs58";
import { VSR_PROGRAM } from "../../../lib/helium-solana.js";
import { getAccount, getProgramAccounts, getSignaturesForAddress, getTransaction } from "./rpc.js";
import { decodeProposal, decodeVoteMarker } from "./decode.js";
import { getProposalContent } from "./content.js";
import { getResolutionMeta, scheduledEndTs } from "./resolution.js";
import { decodeVoteInstructions } from "./voteDecode.js";
import { tallyChoices, deriveStatus, proposalTiming, weightToVeHnt } from "../utils.js";
import {
  PROPOSAL_PROGRAM,
  VOTE_WEIGHT_DECIMALS,
  VOTE_MARKER_DISCRIMINATOR,
  MAX_VOTERS_RETURNED,
  MAX_MARKERS_SCANNED,
  DEFAULT_ACTIVITY_LIMIT,
  ACTIVITY_DECODE_CONCURRENCY,
} from "../config.js";

/** Run `fn` over `items` with bounded concurrency, preserving order. */
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

/** Carries an HTTP status so callers can surface 404/400 rather than 500. */
export class VoteError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "VoteError";
    this.status = status;
  }
}

// base58 of the 8-byte VoteMarkerV0 discriminator (the getProgramAccounts type
// filter). The `proposal` field sits at offset 72 (8 disc + voter + registrar),
// matching heliumvote's useVotes memcmp.
const MARKER_DISC_B58 = bs58.encode(Buffer.from(VOTE_MARKER_DISCRIMINATOR));
const PROPOSAL_OFFSET = 72;

/** Decode ProposalV0 + compute the authoritative outcome. Throws VoteError. */
export async function buildProposalData(env, address) {
  const account = await getAccount(env, address);
  if (!account) throw new VoteError("Proposal not found.", 404);
  if (account.owner !== PROPOSAL_PROGRAM.toBase58()) {
    throw new VoteError("Account is not a Helium governance proposal.", 400);
  }

  const proposal = decodeProposal(account.buf);
  const { totalWeight, results, leadingIndex } = tallyChoices(proposal.choices);
  const status = deriveStatus(proposal.state, proposal.choices);
  const { startTs, endTs } = proposalTiming(proposal.state);
  // The off-chain body and the resolution rules (scheduled end + election seat
  // count, behind the proposal config) are independent — fetch concurrently.
  // Resolution meta is best-effort: null leaves the response as before.
  const [content, resolution] = await Promise.all([
    getProposalContent(env, address, proposal.uri),
    getResolutionMeta(env, proposal.proposalConfig),
  ]);

  return {
    address,
    name: proposal.name,
    uri: proposal.uri,
    tags: proposal.tags,
    namespace: proposal.namespace,
    owner: proposal.owner,
    proposalConfig: proposal.proposalConfig,
    state: proposal.state.kind,
    status,
    createdAt: proposal.createdAt,
    startTs,
    // Resolved proposals carry their actual end; open ones get the *scheduled*
    // close from the resolution settings (feeds the countdown).
    endTs: endTs ?? scheduledEndTs(resolution, startTs),
    // Election seat count (ResolutionNode Top{n}) — e.g. 5 for the council
    // election. Null for plain yes/no votes and unknown controllers.
    seats: resolution?.seats ?? null,
    maxChoicesPerVoter: proposal.maxChoicesPerVoter,
    decimals: VOTE_WEIGHT_DECIMALS,
    totalWeight: totalWeight.toString(),
    totalVeHnt: weightToVeHnt(totalWeight),
    leadingIndex,
    winningChoices:
      proposal.state.kind === "resolved" ? proposal.state.winningChoices : null,
    choices: results,
    content,
  };
}

/**
 * Fetch + decode every live VoteMarkerV0 for a proposal (getProgramAccounts on
 * the VSR program). Returns markers with their account pubkey, so callers that
 * need per-vote timing can look up each marker's creation tx. Shared by
 * aggregateVotes (the roster) and the history recorder.
 */
export async function fetchProposalMarkers(env, address) {
  let accounts = await getProgramAccounts(env, VSR_PROGRAM, [
    { offset: 0, bytesBase58: MARKER_DISC_B58 },
    { offset: PROPOSAL_OFFSET, bytesBase58: address },
  ]);

  const scanCapped = accounts.length > MAX_MARKERS_SCANNED;
  if (scanCapped) {
    console.log(JSON.stringify({
      event: "vote_votes_scan_capped",
      proposal: address,
      found: accounts.length,
      cap: MAX_MARKERS_SCANNED,
    }));
    accounts = accounts.slice(0, MAX_MARKERS_SCANNED);
  }

  const markers = [];
  for (const { pubkey, buf } of accounts) {
    let m;
    try {
      m = decodeVoteMarker(buf);
    } catch {
      continue;
    }
    if (m.relinquished) continue;
    markers.push({ pubkey, ...m });
  }
  return { markers, scanCapped };
}

/**
 * Shared roster builder: normalized vote records → the voter-roster wire
 * object. Both aggregation paths (live markers, recorded D1 events) feed this
 * so the roster shape, voter sort, MAX_VOTERS_RETURNED cap, and per-choice
 * voter counts can never drift between them. Records: { voter, weight: BigInt,
 * choices: [idx], proxy?, marker?, flipped? }.
 *
 * Live rows carry `proxy` + `markers` (the snapshot enrichment joins flip
 * flags onto markers, then drops them from the wire); reconstructed rows carry
 * `flipped` directly (no markers exist once a vote settles).
 */
function buildRoster(records, address, { reconstructed = false, scanCapped = false } = {}) {
  const perChoice = new Map();      // choiceIndex -> total weight (across all positions)
  const byVoter = new Map();        // voter -> aggregated record
  let totalWeight = 0n;

  for (const rec of records) {
    totalWeight += rec.weight;
    for (const c of rec.choices) {
      perChoice.set(c, (perChoice.get(c) || 0n) + rec.weight);
    }
    let v = byVoter.get(rec.voter);
    if (!v) {
      v = { voter: rec.voter, weight: 0n, choices: new Map(), markers: [], positions: 0, proxy: false, flipped: false };
      byVoter.set(rec.voter, v);
    }
    v.weight += rec.weight;
    v.positions += 1;
    if (rec.marker) v.markers.push(rec.marker);
    if (rec.proxy) v.proxy = true;
    if (rec.flipped) v.flipped = true;
    // Track this voter's weight per choice (a wallet's positions can back
    // different choices — a "split", distinct from a temporal flip).
    for (const c of rec.choices) v.choices.set(c, (v.choices.get(c) || 0n) + rec.weight);
  }

  const voters = [...byVoter.values()].sort((a, b) => (a.weight < b.weight ? 1 : a.weight > b.weight ? -1 : 0));
  const returned = voters.slice(0, MAX_VOTERS_RETURNED);

  // Distinct voters backing each choice, across ALL voters (not just the
  // returned top N). A wallet that split positions across choices counts toward
  // each, so these can sum to more than uniqueVoters.
  const voterCountPerChoice = new Map();
  for (const v of byVoter.values()) {
    for (const c of v.choices.keys()) {
      voterCountPerChoice.set(c, (voterCountPerChoice.get(c) || 0) + 1);
    }
  }

  return {
    proposal: address,
    ...(reconstructed ? { reconstructed: true } : {}),
    markerCount: records.length,
    uniqueVoters: byVoter.size,
    totalWeight: totalWeight.toString(),
    totalVeHnt: weightToVeHnt(totalWeight),
    truncated: voters.length > returned.length,
    scanCapped,
    returned: returned.length,
    perChoice: Array.from(perChoice.entries())
      .map(([index, weight]) => ({
        index,
        weight: weight.toString(),
        veHnt: weightToVeHnt(weight),
        voters: voterCountPerChoice.get(index) || 0,
      }))
      .sort((a, b) => a.index - b.index),
    votes: returned.map((v) => ({
      voter: v.voter,
      weight: v.weight.toString(),
      veHnt: weightToVeHnt(v.weight),
      positions: v.positions,
      ...(reconstructed
        ? { flipped: v.flipped }
        : { proxy: v.proxy, markers: v.markers }),
      // Distinct choices this voter's positions back, heaviest first.
      choices: [...v.choices.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([i]) => i),
    })),
  };
}

/**
 * Aggregate already-fetched markers into the voter-roster response. Pure, so
 * the snapshotter can fetch markers once (via fetchProposalMarkers) and feed
 * them to both this and the history recorder without a second getProgramAccounts.
 */
export function aggregateVotes({ markers, scanCapped }, address) {
  const records = markers.map((m) => ({
    voter: m.voter,
    weight: m.weight,
    choices: m.choices,
    proxy: m.proxyIndex > 0,
    marker: m.pubkey,
  }));
  return buildRoster(records, address, { scanCapped });
}

/**
 * Rebuild the voter roster from recorded D1 vote events — the end-state path.
 * VoteMarkerV0 accounts close once a proposal resolves, so the live scan goes
 * empty and marker-derived metrics (voters, per-choice voter counts, roster)
 * would zero out. The `vote_events` table holds each marker's final state
 * (voter, choices, weight, flipped), so a resolved vote's roster is rebuilt
 * from there instead. Output mirrors aggregateVotes, plus `reconstructed: true`
 * so clients can label it; per-row `flipped` comes straight from the events
 * (no marker join), and the delegation (`proxy`) badge is unknown post-close.
 *
 * Caveats (best-effort by nature): votes cast in the final minutes before
 * resolution may be missing if the cron never saw them, and a marker
 * relinquished *before* resolution lingers with its last recorded state. The
 * proposal account's own choice weights stay the authoritative tally.
 */
export function aggregateVotesFromEvents(rows, address) {
  const records = [];
  for (const row of rows) {
    let weight;
    try {
      weight = BigInt(row.weight);
    } catch {
      continue; // unreadable row — skip rather than corrupt the totals
    }
    records.push({
      voter: row.voter,
      weight,
      choices: Array.isArray(row.choices) ? row.choices : [],
      flipped: !!row.flipped,
    });
  }
  return buildRoster(records, address, { reconstructed: true });
}

/**
 * Summarize a transaction's vote action for the activity feed: the direction
 * (which choices), the size (summed veHNT of the positions it voted), and the
 * voter. Returns null for a tx with no VSR vote/relinquish instruction (e.g. a
 * crank or proposal-admin tx) so the row renders as a bare transaction.
 *
 * Size comes from the affected markers' weights, looked up in `weightByMarker`
 * (built from the snapshot's markers) — the instruction itself carries only the
 * choice, not the weight. A flip tx (relinquish old + vote new on one marker)
 * counts that marker once via `seen`.
 */
function summarizeVoteTx(tx, weightByMarker) {
  const decoded = decodeVoteInstructions(tx);
  if (decoded.length === 0) return null;

  const seen = new Set();
  let weight = 0n;
  let voter = null;
  let hasVote = false;
  const voteChoices = new Set();
  const relinquishChoices = new Set();

  for (const d of decoded) {
    if (d.action === "vote") {
      hasVote = true;
      if (d.choice != null) voteChoices.add(d.choice);
    } else if (d.choice != null) {
      relinquishChoices.add(d.choice);
    }
    const marker = d.accounts.find((acc) => weightByMarker.has(acc));
    if (marker && !seen.has(marker)) {
      seen.add(marker);
      const info = weightByMarker.get(marker);
      weight += info.weight;
      voter = voter || info.voter;
    }
  }

  const choices = [...(voteChoices.size ? voteChoices : relinquishChoices)].sort((a, b) => a - b);
  return {
    action: hasVote ? "vote" : "relinquish",
    choices,
    weight: weight.toString(),
    veHnt: weightToVeHnt(weight),
    voter,
  };
}

/**
 * Time-ordered recent transactions on the proposal account (newest first), each
 * enriched with its vote direction + size by decoding the transaction. `markers`
 * (from the same snapshot cycle) supplies per-position weights for the size.
 */
export async function buildActivityData(env, address, markers = []) {
  const sigs = await getSignaturesForAddress(env, address, { limit: DEFAULT_ACTIVITY_LIMIT });
  const weightByMarker = new Map(
    (markers || []).map((m) => [m.pubkey, { weight: m.weight, voter: m.voter }]),
  );
  const activity = await mapLimit(sigs, ACTIVITY_DECODE_CONCURRENCY, async (s) => {
    const base = {
      signature: s.signature,
      blockTime: s.blockTime ?? null,
      slot: s.slot ?? null,
      success: !s.err,
      memo: s.memo || null,
    };
    if (s.err) return base; // failed tx — nothing was voted
    try {
      const summary = summarizeVoteTx(await getTransaction(env, s.signature), weightByMarker);
      return summary ? { ...base, ...summary } : base;
    } catch {
      return base; // undecodable tx — still show the bare row
    }
  });
  return { proposal: address, activity };
}

/** The zero-roster shape, for when the marker fetch fails a snapshot cycle. */
export function emptyVotesData(address) {
  return {
    proposal: address,
    markerCount: 0,
    uniqueVoters: 0,
    totalWeight: "0",
    totalVeHnt: 0,
    truncated: false,
    scanCapped: false,
    returned: 0,
    perChoice: [],
    votes: [],
  };
}
