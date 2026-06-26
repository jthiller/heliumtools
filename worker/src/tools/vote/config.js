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

// --- Server-side polling model -------------------------------------------
// The worker polls the RPC on a cron and stores a combined snapshot; viewers
// only ever read the stored snapshot, so per-viewer traffic never hits the RPC.

// Cron that drives snapshotting. MUST match the entry added to
// wrangler.jsonc triggers.crons. Branched on in src/index.js scheduled().
export const VOTE_SNAPSHOT_CRON = "*/15 * * * *";

// How long a stored snapshot survives without a refresh (safety net if the
// cron stops). Refreshed every cron tick, so for tracked proposals it never
// actually expires.
export const SNAPSHOT_TTL = 3 * 24 * 60 * 60;
// A snapshot older than this is "stale": the next viewer triggers a
// single-flight background refresh. Comfortably above the 15-min cron cadence
// so steady-state viewers never refresh.
export const SNAPSHOT_STALE_MS = 20 * 60 * 1000;
// Short TTL on the single-flight refresh lock (prevents RPC stampedes).
export const REFRESH_LOCK_TTL = 30;

// The off-chain proposal body (uri) changes rarely; cache it much longer.
export const CONTENT_CACHE_TTL = 6 * 60 * 60;

// --- History (D1 time-series) --------------------------------------------
// Each snapshot is bucketed to a 15-min boundary and written once per bucket
// (INSERT OR IGNORE), so the chart has regular points regardless of who
// triggered the refresh. Retained for two weeks (covers a 7-day vote + slack).
export const HISTORY_BUCKET_SECONDS = 15 * 60;
export const HISTORY_RETENTION_DAYS = 14;
export const HISTORY_CACHE_TTL = 60;

// A non-default proposal stays on the cron's snapshot list for this long after
// it was last viewed, then drops off.
export const TRACK_TTL_DAYS = 8;

// getProgramAccounts can return one VoteMarkerV0 per voting position. We compute
// aggregates over every marker but only return the heaviest N to the client to
// bound the response size.
export const MAX_MARKERS_RETURNED = 500;

// getSignaturesForAddress page size for the live activity feed.
export const DEFAULT_ACTIVITY_LIMIT = 25;
export const MAX_ACTIVITY_LIMIT = 100;

// Off-chain proposal body: cap the bytes we read/return so a hostile or huge
// uri can't blow up the worker or the client. MAX_CONTENT_BYTES is the real
// memory bound enforced while streaming; MAX_CONTENT_CHARS caps the slice we
// store/return.
export const MAX_CONTENT_BYTES = 64 * 1024;
export const MAX_CONTENT_CHARS = 8000;

// Defensive ceiling on how many VoteMarkerV0 accounts we decode in one /votes
// request. Real Helium proposals have far fewer; this only bounds CPU if an
// arbitrary proposal id ever points at a pathologically large marker set.
export const MAX_MARKERS_SCANNED = 10000;

// IP rate limit (per minute) across all vote endpoints.
export const MAX_REQUESTS_PER_MINUTE = 60;
