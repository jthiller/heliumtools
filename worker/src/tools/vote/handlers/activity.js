import { jsonResponse } from "../../../lib/response.js";
import { parseProposalId, isValidSignature } from "../utils.js";
import { getOrRefreshSnapshot, VoteError } from "../services/snapshot.js";
import { buildActivityData } from "../services/builders.js";
import {
  DEFAULT_PROPOSAL,
  DEFAULT_ACTIVITY_LIMIT,
  MAX_ACTIVITY_LIMIT,
} from "../config.js";

/**
 * GET /vote/activity?id=<pubkey>&before=&limit=
 * The recent-activity feed (newest first), served from the stored snapshot. An
 * explicit `before` cursor ("load more") falls through to a one-off live fetch —
 * the default page never paginates, so this stays off the viewer hot path.
 */
export async function handleActivity(url, env, ctx) {
  const id = parseProposalId(url.searchParams.get("id") || DEFAULT_PROPOSAL);
  if (!id) return jsonResponse({ error: "Invalid proposal address." }, 400);
  const address = id.toBase58();

  const before = url.searchParams.get("before") || null;
  if (before && !isValidSignature(before)) {
    return jsonResponse({ error: "Invalid cursor." }, 400);
  }

  try {
    if (before) {
      let limit = parseInt(url.searchParams.get("limit") || "", 10);
      if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_ACTIVITY_LIMIT;
      limit = Math.min(limit, MAX_ACTIVITY_LIMIT);
      const data = await buildActivityData(env, id, address, { limit, before });
      return jsonResponse(data);
    }

    const snap = await getOrRefreshSnapshot(env, address, ctx);
    if (!snap) return jsonResponse({ warming: true }, 202);
    if (!snap.activity) {
      return jsonResponse({ proposal: address, activity: [], cursor: null, snapshotAt: snap.snapshotAt });
    }
    return jsonResponse({ ...snap.activity, snapshotAt: snap.snapshotAt });
  } catch (err) {
    if (err instanceof VoteError) return jsonResponse({ error: err.message }, err.status);
    console.error("vote activity error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load activity." }, 500);
  }
}
