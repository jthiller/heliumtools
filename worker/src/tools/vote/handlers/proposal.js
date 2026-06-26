import { jsonResponse } from "../../../lib/response.js";
import { resolveProposal } from "../utils.js";
import { getOrRefreshSnapshot, VoteError } from "../services/snapshot.js";

/**
 * GET /vote/proposal?id=<pubkey>
 * The authoritative outcome (choices + veHNT weights + percentages + status),
 * served from the worker's stored snapshot — no per-viewer RPC. The snapshot is
 * refreshed by the cron (and single-flight on cold/stale); `snapshotAt` tells
 * the client how fresh it is.
 */
export async function handleProposal(url, env, ctx) {
  const p = resolveProposal(url);
  if (!p) return jsonResponse({ error: "Invalid proposal address." }, 400);

  try {
    const snap = await getOrRefreshSnapshot(env, p.address, ctx);
    if (!snap || !snap.proposal) return jsonResponse({ warming: true }, 202);
    return jsonResponse({ ...snap.proposal, snapshotAt: snap.snapshotAt });
  } catch (err) {
    if (err instanceof VoteError) return jsonResponse({ error: err.message }, err.status);
    console.error("vote proposal error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load proposal." }, 500);
  }
}
