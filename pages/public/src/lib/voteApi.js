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
export function fetchActivity(id, { limit, before } = {}) {
  const params = {};
  if (id) params.id = id;
  if (limit) params.limit = limit;
  if (before) params.before = before;
  return get("/activity", params);
}
