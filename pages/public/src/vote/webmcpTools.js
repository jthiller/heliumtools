import { fetchProposals, fetchProposal, fetchVoterHistory } from "../lib/voteApi.js";
import { SOLANA_ADDRESS_SCHEMA } from "../webmcp/helpers.js";

const PROPOSAL_SCHEMA = {
  ...SOLANA_ADDRESS_SCHEMA,
  description:
    "Proposal account address (Solana base58), as returned by list-vote-proposals. Omit for the currently featured vote.",
};

/**
 * WebMCP tools for the /vote and /votes pages. All reads come from the
 * worker's cron-polled snapshot/history, so agent traffic adds no RPC load.
 * `navigate` is the router's navigate function, so open-vote drives the
 * same UI the user is looking at.
 */
export function makeVoteTools(navigate) {
  return [
    {
      name: "list-vote-proposals",
      title: "List governance votes",
      description:
        "List every tracked Helium governance vote, current and past: proposal address, name, network (HNT/IOT/MOBILE), state, and tallies. Use a proposal address with get-vote-details or open-vote.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute() {
        return fetchProposals();
      },
    },
    {
      name: "get-vote-details",
      title: "Get vote details",
      description:
        "Decoded proposal and outcome for one governance vote: choices, vote weights, percentages, status, and timing. Defaults to the currently featured vote when no proposal is given.",
      inputSchema: {
        type: "object",
        properties: { proposal: PROPOSAL_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ proposal }) {
        return fetchProposal(proposal);
      },
    },
    {
      name: "get-voter-history",
      title: "Get a voter's history",
      description:
        "One voter's vote/flip timeline on a governance proposal: vote and relinquish actions with timestamps and choices.",
      inputSchema: {
        type: "object",
        properties: {
          voter: { ...SOLANA_ADDRESS_SCHEMA, description: "The voter's wallet address (Solana base58)." },
          proposal: PROPOSAL_SCHEMA,
        },
        required: ["voter"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ voter, proposal }) {
        return fetchVoterHistory(proposal, voter);
      },
    },
    {
      name: "open-vote",
      title: "Open a vote in the viewer",
      description:
        "Navigate the vote viewer to a specific proposal so the user sees its live tallies, trend chart, and voter roster.",
      inputSchema: {
        type: "object",
        properties: { proposal: { ...PROPOSAL_SCHEMA, description: "Proposal account address (Solana base58) to display." } },
        required: ["proposal"],
        additionalProperties: false,
      },
      execute({ proposal }) {
        navigate(`/vote/${proposal}`);
        return `Now showing proposal ${proposal} in the vote viewer.`;
      },
    },
  ];
}
