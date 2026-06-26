import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { checkIpRateLimit } from "../../lib/rateLimit.js";
import { MAX_REQUESTS_PER_MINUTE } from "./config.js";
import { handleProposal } from "./handlers/proposal.js";
import { handleVotes } from "./handlers/votes.js";
import { handleActivity } from "./handlers/activity.js";

/**
 * Vote (governance proposal) tool — prefix `/vote`.
 *   GET /vote/proposal?id=  — decoded ProposalV0 + outcome
 *   GET /vote/votes?id=     — live voter roster (VoteMarkerV0 via getProgramAccounts)
 *   GET /vote/activity?id=  — time-ordered recent vote transactions
 *
 * All read-only; everything is queried through the worker's own SOLANA_RPC_URL.
 */
export async function handleVoteRequest(request, env) {
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
    case "/proposal": return handleProposal(url, env);
    case "/votes": return handleVotes(url, env);
    case "/activity": return handleActivity(url, env);
    default: return jsonResponse({ error: "Not found" }, 404);
  }
}
