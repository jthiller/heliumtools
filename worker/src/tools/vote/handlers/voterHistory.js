import { jsonResponse } from "../../../lib/response.js";
import { PublicKey } from "@solana/web3.js";
import { resolveProposal } from "../utils.js";
import { getVoterHistory } from "../services/voteHistory.js";

/**
 * GET /vote/voter-history?id=<proposal>&voter=<pubkey>
 * A voter's merged vote-action timeline across their positions (vote/relinquish
 * + choice + timestamp), parsed from each marker's transactions. For expanding a
 * flipped voter's row. KV-cached; modest live RPC only on a cache miss.
 */
export async function handleVoterHistory(url, env) {
  const p = resolveProposal(url);
  if (!p) return jsonResponse({ error: "Invalid proposal address." }, 400);

  const voterStr = url.searchParams.get("voter");
  let voter;
  try {
    voter = new PublicKey(voterStr).toBase58();
  } catch {
    return jsonResponse({ error: "Invalid voter address." }, 400);
  }

  try {
    const body = await getVoterHistory(env, p.address, voter);
    return jsonResponse(body);
  } catch (err) {
    console.error("vote voter-history error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load vote history." }, 500);
  }
}
