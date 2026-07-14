import { jsonResponse } from "../../../lib/response.js";
import { resolveProposal } from "../utils.js";
import { getOrRefreshSnapshot, VoteError } from "../services/snapshot.js";
import { emptyVotesData } from "../services/builders.js";

/**
 * GET /vote/votes?id=<pubkey>
 * The voter roster (VoteMarkerV0 accounts), served from the stored snapshot.
 * Modern Helium closes markers after resolution, so a resolved proposal's
 * roster is rebuilt from D1 vote events instead (`reconstructed: true`);
 * final tallies always come from /vote/proposal. An empty roster remains
 * possible for a vote that resolved before this page ever tracked it.
 */
export async function handleVotes(url, env, ctx) {
  const p = resolveProposal(url);
  if (!p) return jsonResponse({ error: "Invalid proposal address." }, 400);

  try {
    const snap = await getOrRefreshSnapshot(env, p.address, ctx);
    if (!snap) return jsonResponse({ warming: true }, 202);
    // Proposal loaded but the roster fetch failed this cycle → empty roster.
    const votes = snap.votes || { ...emptyVotesData(p.address), unavailable: true };
    return jsonResponse({ ...votes, snapshotAt: snap.snapshotAt });
  } catch (err) {
    if (err instanceof VoteError) return jsonResponse({ error: err.message }, err.status);
    console.error("vote votes error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load votes." }, 500);
  }
}
