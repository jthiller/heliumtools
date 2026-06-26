import { parseJson, throwIfApiError } from "./api.js";

export const API_BASE = import.meta.env.DEV
  ? "/api/vote"
  : "https://api.heliumtools.org/vote";

async function get(path, params) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}${path}${query ? `?${query}` : ""}`);
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}

/** Decoded ProposalV0 + outcome (choices, weights, percentages, status). */
export function fetchProposal(id) {
  return get("/proposal", id ? { id } : {});
}

/** Live voter roster (VoteMarkerV0 accounts) + per-choice aggregates. */
export function fetchVotes(id) {
  return get("/votes", id ? { id } : {});
}

/** Time-ordered recent vote/lifecycle transactions on the proposal. */
export function fetchActivity(id) {
  return get("/activity", id ? { id } : {});
}

/** Recorded per-vote cumulative time-series for charting the vote's arc. */
export function fetchHistory(id) {
  return get("/history", id ? { id } : {});
}
