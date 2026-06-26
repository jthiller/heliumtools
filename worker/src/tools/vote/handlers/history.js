import { jsonResponse } from "../../../lib/response.js";
import { resolveProposal } from "../utils.js";
import { getHistory } from "../services/history.js";

/**
 * GET /vote/history?id=<pubkey>
 * The recorded per-vote cumulative time-series (one point per vote, at its exact
 * on-chain time), for charting the vote's arc. Served from D1 (KV-cached) — no RPC.
 */
export async function handleHistory(url, env) {
  const p = resolveProposal(url);
  if (!p) return jsonResponse({ error: "Invalid proposal address." }, 400);

  try {
    const body = await getHistory(env, p.address);
    return jsonResponse(body);
  } catch (err) {
    console.error("vote history error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load history." }, 500);
  }
}
