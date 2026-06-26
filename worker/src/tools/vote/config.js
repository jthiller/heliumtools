// Vote (governance proposal) tool — configuration.
//
// This tool reads Helium governance proposals and live vote activity directly
// from our own Solana RPC, mirroring how heliumvote.com queries on-chain (see
// CLAUDE.md for the full data-model citations).

import { PublicKey } from "@solana/web3.js";

// Helium "proposal" program (modular-governance) — holds ProposalV0 accounts.
//   declare_id! in helium/modular-governance programs/proposal/src/lib.rs
export const PROPOSAL_PROGRAM = new PublicKey(
  "propFYxqmVcufMhk5esNMrexq2ogHbbC2kP9PU1qxKs",
);

// The vote this blind page is built for. Used when no :proposalId is supplied.
export const DEFAULT_PROPOSAL = "4zLh9V1wiZJ3GffytCnqQA9FX1VQSM3kXxx22RpzPXWo";

// Anchor account discriminators = sha256("account:<Name>")[..8].
// Verified by local computation against the published IDLs.
export const PROPOSAL_DISCRIMINATOR = [254, 194, 16, 171, 214, 20, 192, 81];
export const VOTE_MARKER_DISCRIMINATOR = [83, 205, 59, 215, 144, 234, 43, 70];

// Vote weights are veHNT in native units. The HNT registrar's governing mint
// (HNT) has 8 decimals, so weight / 1e8 = human veHNT.
export const VOTE_WEIGHT_DECIMALS = 8;

// KV cache TTLs (seconds) — short, because this page is "live".
export const PROPOSAL_CACHE_TTL = 15;
export const VOTES_CACHE_TTL = 20;
export const ACTIVITY_CACHE_TTL = 15;
// The off-chain proposal body (uri) changes rarely; cache it much longer.
export const CONTENT_CACHE_TTL = 6 * 60 * 60;

// getProgramAccounts can return one VoteMarkerV0 per voting position. We compute
// aggregates over every marker but only return the heaviest N to the client to
// bound the response size.
export const MAX_MARKERS_RETURNED = 500;

// getSignaturesForAddress page size for the live activity feed.
export const DEFAULT_ACTIVITY_LIMIT = 25;
export const MAX_ACTIVITY_LIMIT = 100;

// Off-chain proposal body: cap the bytes we fetch/return so a hostile or huge
// uri can't blow up the worker or the client.
export const MAX_CONTENT_CHARS = 8000;

// IP rate limit (per minute) across all vote endpoints.
export const MAX_REQUESTS_PER_MINUTE = 60;
