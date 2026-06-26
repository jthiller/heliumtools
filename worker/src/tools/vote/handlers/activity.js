import { jsonResponse } from "../../../lib/response.js";
import { resolveProposal } from "../utils.js";
import { getOrRefreshSnapshot, VoteError } from "../services/snapshot.js";

/**
 * GET /vote/activity?id=<pubkey>
 * The recent-activity feed (newest first), served from the stored snapshot —
 * no per-viewer RPC.
 */
export async function handleActivity(url, env, ctx) {
  const p = resolveProposal(url);
  if (!p) return jsonResponse({ error: "Invalid proposal address." }, 400);

  try {
    const snap = await getOrRefreshSnapshot(env, p.address, ctx);
    if (!snap) return jsonResponse({ warming: true }, 202);
    const activity = snap.activity || { proposal: p.address, activity: [] };
    return jsonResponse({ ...activity, snapshotAt: snap.snapshotAt });
  } catch (err) {
    if (err instanceof VoteError) return jsonResponse({ error: err.message }, err.status);
    console.error("vote activity error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load activity." }, 500);
  }
}
