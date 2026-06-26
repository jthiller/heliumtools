import { jsonResponse } from "../../../lib/response.js";
import { parseProposalId } from "../utils.js";
import { getOrRefreshSnapshot, VoteError } from "../services/snapshot.js";
import { DEFAULT_PROPOSAL } from "../config.js";

/**
 * GET /vote/votes?id=<pubkey>
 * The voter roster (VoteMarkerV0 accounts), served from the stored snapshot.
 * Modern Helium closes markers after resolution, so a resolved proposal may
 * have an empty roster — final tallies always come from /vote/proposal.
 */
export async function handleVotes(url, env, ctx) {
  const id = parseProposalId(url.searchParams.get("id") || DEFAULT_PROPOSAL);
  if (!id) return jsonResponse({ error: "Invalid proposal address." }, 400);
  const address = id.toBase58();

  try {
    const snap = await getOrRefreshSnapshot(env, address, ctx);
    if (!snap) return jsonResponse({ warming: true }, 202);
    if (!snap.votes) {
      // Proposal loaded but the roster fetch failed this cycle.
      return jsonResponse({
        proposal: address,
        markerCount: 0,
        uniqueVoters: 0,
        totalWeight: "0",
        totalVeHnt: 0,
        truncated: false,
        returned: 0,
        perChoice: [],
        votes: [],
        unavailable: true,
        snapshotAt: snap.snapshotAt,
      });
    }
    return jsonResponse({ ...snap.votes, snapshotAt: snap.snapshotAt });
  } catch (err) {
    if (err instanceof VoteError) return jsonResponse({ error: err.message }, err.status);
    console.error("vote votes error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load votes." }, 500);
  }
}
