import { jsonResponse } from "../../../lib/response.js";
import { parseProposalId } from "../utils.js";
import { getHistory } from "../services/history.js";
import { DEFAULT_PROPOSAL } from "../config.js";

/**
 * GET /vote/history?id=<pubkey>
 * The recorded time-series of the proposal's tally (one point per 15-min
 * bucket), for charting the vote's arc. Served from D1 (KV-cached) — never RPC.
 */
export async function handleHistory(url, env) {
  const id = parseProposalId(url.searchParams.get("id") || DEFAULT_PROPOSAL);
  if (!id) return jsonResponse({ error: "Invalid proposal address." }, 400);

  try {
    const body = await getHistory(env, id.toBase58());
    return jsonResponse(body);
  } catch (err) {
    console.error("vote history error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load history." }, 500);
  }
}
