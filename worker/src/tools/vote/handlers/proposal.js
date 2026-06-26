import { jsonResponse } from "../../../lib/response.js";
import { getAccount } from "../services/rpc.js";
import { decodeProposal } from "../services/decode.js";
import { getProposalContent } from "../services/content.js";
import {
  parseProposalId,
  tallyChoices,
  deriveStatus,
  proposalTiming,
  weightToVeHnt,
  kvGetJson,
  kvPutJson,
} from "../utils.js";
import {
  PROPOSAL_PROGRAM,
  DEFAULT_PROPOSAL,
  VOTE_WEIGHT_DECIMALS,
  PROPOSAL_CACHE_TTL,
} from "../config.js";

/**
 * GET /vote/proposal?id=<pubkey>
 * Decode the on-chain ProposalV0 and return the authoritative outcome:
 * choices with accumulated veHNT weight + percentages, leading/winning choice,
 * derived status, timing, and the (best-effort) off-chain body.
 */
export async function handleProposal(url, env) {
  const id = parseProposalId(url.searchParams.get("id") || DEFAULT_PROPOSAL);
  if (!id) return jsonResponse({ error: "Invalid proposal address." }, 400);
  const address = id.toBase58();

  const cacheKey = `vote:proposal:${address}`;
  const cached = await kvGetJson(env, cacheKey);
  if (cached) return jsonResponse(cached);

  try {
    const account = await getAccount(env, id);
    if (!account) return jsonResponse({ error: "Proposal not found." }, 404);
    if (account.owner !== PROPOSAL_PROGRAM.toBase58()) {
      return jsonResponse(
        { error: "Account is not a Helium governance proposal." },
        400,
      );
    }

    const proposal = decodeProposal(account.buf);
    const { totalWeight, results, leadingIndex } = tallyChoices(proposal.choices);
    const status = deriveStatus(proposal.state, proposal.choices);
    const { startTs, endTs } = proposalTiming(proposal.state);
    const content = await getProposalContent(env, address, proposal.uri);

    const body = {
      address,
      name: proposal.name,
      uri: proposal.uri,
      tags: proposal.tags,
      namespace: proposal.namespace,
      owner: proposal.owner,
      proposalConfig: proposal.proposalConfig,
      state: proposal.state.kind,
      status,
      createdAt: proposal.createdAt,
      startTs,
      endTs,
      maxChoicesPerVoter: proposal.maxChoicesPerVoter,
      decimals: VOTE_WEIGHT_DECIMALS,
      totalWeight: totalWeight.toString(),
      totalVeHnt: weightToVeHnt(totalWeight),
      leadingIndex,
      winningChoices:
        proposal.state.kind === "resolved" ? proposal.state.winningChoices : null,
      choices: results,
      content,
    };

    await kvPutJson(env, cacheKey, body, PROPOSAL_CACHE_TTL);
    console.log(JSON.stringify({
      event: "vote_proposal",
      proposal: address,
      status,
      choiceCount: results.length,
      totalVeHnt: body.totalVeHnt,
    }));
    return jsonResponse(body);
  } catch (err) {
    console.error("vote proposal error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load proposal." }, 500);
  }
}
