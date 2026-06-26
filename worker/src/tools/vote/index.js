import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { checkIpRateLimit } from "../../lib/rateLimit.js";
import { MAX_REQUESTS_PER_MINUTE, VOTE_SNAPSHOT_CRON } from "./config.js";
import { handleProposal } from "./handlers/proposal.js";
import { handleVotes } from "./handlers/votes.js";
import { handleActivity } from "./handlers/activity.js";
import { handleHistory } from "./handlers/history.js";
import { runVoteSnapshots } from "./services/snapshot.js";

// Re-exported so src/index.js scheduled() can drive the cron snapshotter.
export { runVoteSnapshots, VOTE_SNAPSHOT_CRON };

/**
 * Vote (governance proposal) tool — prefix `/vote`.
 *   GET /vote/proposal?id=  — decoded ProposalV0 + outcome
 *   GET /vote/votes?id=     — voter roster (VoteMarkerV0)
 *   GET /vote/activity?id=  — recent vote transactions
 *   GET /vote/history?id=   — recorded tally time-series (for charting)
 *
 * All read-only. Viewers are served from a worker-maintained snapshot (refreshed
 * by cron); the RPC is only touched server-side, never per viewer.
 */
export async function handleVoteRequest(request, env, ctx) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const limitErr = await checkIpRateLimit(env, request, {
    prefix: "rl:vote",
    maxRequests: MAX_REQUESTS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (limitErr) return limitErr;

  switch (url.pathname) {
    case "/proposal": return handleProposal(url, env, ctx);
    case "/votes": return handleVotes(url, env, ctx);
    case "/activity": return handleActivity(url, env, ctx);
    case "/history": return handleHistory(url, env);
    default: return jsonResponse({ error: "Not found" }, 404);
  }
}
