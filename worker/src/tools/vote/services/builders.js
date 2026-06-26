// Pure data builders — fetch from the RPC and shape the response objects. No
// caching here: callers (the cron snapshotter and the cold-start path) decide
// when to run these, so per-viewer requests never reach them in steady state.

import bs58 from "bs58";
import { VSR_PROGRAM } from "../../../lib/helium-solana.js";
import { getAccount, getProgramAccounts, getSignaturesForAddress } from "./rpc.js";
import { decodeProposal, decodeVoteMarker } from "./decode.js";
import { getProposalContent } from "./content.js";
import { tallyChoices, deriveStatus, proposalTiming, weightToVeHnt } from "../utils.js";
import {
  PROPOSAL_PROGRAM,
  VOTE_WEIGHT_DECIMALS,
  VOTE_MARKER_DISCRIMINATOR,
  MAX_MARKERS_RETURNED,
  MAX_MARKERS_SCANNED,
  DEFAULT_ACTIVITY_LIMIT,
} from "../config.js";

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
  const content = await getProposalContent(env, address, proposal.uri);

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
    endTs,
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
 * Aggregate already-fetched markers into the voter-roster response. Pure, so
 * the snapshotter can fetch markers once (via fetchProposalMarkers) and feed
 * them to both this and the history recorder without a second getProgramAccounts.
 */
export function aggregateVotes({ markers, scanCapped }, address) {
  const perChoice = new Map();
  const voters = new Set();
  let totalWeight = 0n;
  for (const m of markers) {
    totalWeight += m.weight;
    voters.add(m.voter);
    for (const c of m.choices) {
      perChoice.set(c, (perChoice.get(c) || 0n) + m.weight);
    }
  }

  const sorted = [...markers].sort((a, b) => (a.weight < b.weight ? 1 : a.weight > b.weight ? -1 : 0));
  const returned = sorted.slice(0, MAX_MARKERS_RETURNED);

  return {
    proposal: address,
    markerCount: markers.length,
    uniqueVoters: voters.size,
    totalWeight: totalWeight.toString(),
    totalVeHnt: weightToVeHnt(totalWeight),
    truncated: markers.length > returned.length,
    scanCapped,
    returned: returned.length,
    perChoice: Array.from(perChoice.entries())
      .map(([index, weight]) => ({
        index,
        weight: weight.toString(),
        veHnt: weightToVeHnt(weight),
      }))
      .sort((a, b) => a.index - b.index),
    votes: returned.map((m) => ({
      voter: m.voter,
      mint: m.mint,
      choices: m.choices,
      weight: m.weight.toString(),
      veHnt: weightToVeHnt(m.weight),
      proxyIndex: m.proxyIndex,
    })),
  };
}

/** Time-ordered recent transactions on the proposal account (newest first). */
export async function buildActivityData(env, address) {
  const sigs = await getSignaturesForAddress(env, address, { limit: DEFAULT_ACTIVITY_LIMIT });
  const activity = sigs.map((s) => ({
    signature: s.signature,
    blockTime: s.blockTime ?? null,
    slot: s.slot ?? null,
    success: !s.err,
    memo: s.memo || null,
  }));
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
