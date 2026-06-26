import { jsonResponse } from "../../../lib/response.js";
import { getSignaturesForAddress } from "../services/rpc.js";
import { parseProposalId } from "../utils.js";
import {
  DEFAULT_PROPOSAL,
  DEFAULT_ACTIVITY_LIMIT,
  MAX_ACTIVITY_LIMIT,
  ACTIVITY_CACHE_TTL,
} from "../config.js";

/**
 * GET /vote/activity?id=<pubkey>&limit=&before=
 * Time-ordered recent on-chain activity for the proposal. Every vote writes the
 * proposal account, so its signature history is the live vote/lifecycle feed
 * (newest first). VoteMarkerV0 carries no timestamp, so this is the only
 * pure-RPC source of per-vote timing. Paginated by signature cursor.
 */
export async function handleActivity(url, env) {
  const id = parseProposalId(url.searchParams.get("id") || DEFAULT_PROPOSAL);
  if (!id) return jsonResponse({ error: "Invalid proposal address." }, 400);
  const address = id.toBase58();

  let limit = parseInt(url.searchParams.get("limit") || "", 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_ACTIVITY_LIMIT;
  limit = Math.min(limit, MAX_ACTIVITY_LIMIT);
  const before = url.searchParams.get("before") || null;

  // Only the head (no cursor) is cached — paginated pages are one-shot.
  const cacheKey = `vote:activity:${address}:${limit}`;
  if (!before && env.KV) {
    const cached = await env.KV.get(cacheKey, "json");
    if (cached) return jsonResponse(cached);
  }

  try {
    const sigs = await getSignaturesForAddress(env, id, { limit, before });
    const activity = sigs.map((s) => ({
      signature: s.signature,
      blockTime: s.blockTime ?? null,
      slot: s.slot ?? null,
      success: !s.err,
      memo: s.memo || null,
    }));

    const body = {
      proposal: address,
      activity,
      cursor: activity.length === limit ? activity[activity.length - 1].signature : null,
    };

    if (!before && env.KV) {
      await env.KV.put(cacheKey, JSON.stringify(body), {
        expirationTtl: ACTIVITY_CACHE_TTL,
      });
    }
    return jsonResponse(body);
  } catch (err) {
    console.error("vote activity error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load activity." }, 500);
  }
}
