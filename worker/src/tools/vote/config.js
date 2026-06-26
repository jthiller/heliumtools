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

// Anchor account discriminator = sha256("account:VoteMarkerV0")[..8], used as
// the getProgramAccounts type filter. Verified against the published IDL.
// (ProposalV0 is identified by its program owner, not a discriminator.)
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
// One immutable event per vote, at its exact blockTime; the cron appends new
// votes each tick (first run records all past votes back to vote-open). The
// cumulative curve is folded at read time and the response is downsampled so a
// very large vote stays under a sane payload size.
export const HISTORY_CACHE_TTL = 60;
export const MAX_HISTORY_POINTS = 1500;
// Per-voter flip timeline (parsed from the marker's transactions) — cached
// longer since it only changes when that voter acts again.
export const VOTER_HISTORY_CACHE_TTL = 10 * 60;
// Cap how many of a voter's (flipped) positions we parse for the timeline, so a
// whale expanding their row can't trigger an unbounded fan-out of getTransaction.
export const MAX_VOTER_HISTORY_MARKERS = 25;
// Recording: how many marker creation-times to look up concurrently, and the
// max new votes timed per cron run (a big first run spreads over a few ticks).
export const MARKER_TIME_CONCURRENCY = 8;
export const MAX_NEW_MARKERS_PER_RUN = 500;

// Flip resolution: deciding whether a position actually CHANGED its vote (more
// than one distinct choice across its on-chain history) requires decoding the
// marker's transactions — transaction count alone conflates real flips with a
// proxy's batched vote + crank touches. Each cron tick resolves a bounded batch
// of not-yet-resolved markers (a one-time backfill over existing votes spreads
// across a few ticks); new markers are resolved as they're recorded. Concurrency
// across markers, with a per-run shared getTransaction cache (proxy batch votes
// share signatures, so the unique tx fetches stay small).
export const FLIP_RESOLVE_PER_RUN = 400;
export const FLIP_RESOLVE_CONCURRENCY = 6;

// A non-default proposal stays on the cron's snapshot list for this long after
// it was last viewed, then drops off.
export const TRACK_TTL_DAYS = 8;

// Proxy/delegate name registry (helium-vote-proxies) — changes only on PR merge,
// so cache it for hours.
export const PROXY_MAP_CACHE_TTL = 6 * 60 * 60;

// The roster groups markers (one per voting position) by voter; we compute
// aggregates over every marker but only return the heaviest N voters to the
// client to bound the response size.
export const MAX_VOTERS_RETURNED = 500;

// getSignaturesForAddress page size for the activity feed. Each entry is decoded
// (getTransaction) to surface its vote direction + size, so this also bounds the
// per-refresh getTransaction fan-out; ACTIVITY_DECODE_CONCURRENCY caps parallelism.
export const DEFAULT_ACTIVITY_LIMIT = 25;
export const ACTIVITY_DECODE_CONCURRENCY = 6;

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

// --- Circulating veHNT (participation denominator) -----------------------
// "% of available vote that participated" needs the total veHNT voting power
// across ALL HNT positions, not just voters. We enumerate every PositionV0 in
// the HNT registrar (getProgramAccounts, sliced to the voting-power fields) and
// sum each position's current voting power (reusing the ve-hnt tool's formula).
// It's a heavy call, so it's computed on a slow cron cadence, single-flight, and
// KV-cached — viewers only ever read the cached number, and a failure never
// blocks the snapshot.
//
// Anchor account discriminator = sha256("account:PositionV0")[..8]. The HNT
// registrar pubkey sits at offset 8 (right after the discriminator), so the two
// memcmp filters together select exactly the HNT positions.
export const POSITION_DISCRIMINATOR = [152, 131, 154, 46, 158, 42, 31, 233];
// dataSlice over PositionV0: bytes [72,108) cover lockup (start/end/kind),
// amount_deposited_native, voting_mint_config_idx, and genesis_end — everything
// computeVeHnt needs, and nothing else, to keep the response small at scale.
export const POSITION_VP_SLICE = { offset: 72, length: 36 };
// Recompute at most this often (veHNT drifts slowly); cron ticks in between are
// cheap cache hits. Stored at 2× this TTL so it survives a skipped recompute.
export const CIRCULATING_CACHE_TTL = 60 * 60;
export const CIRCULATING_LOCK_TTL = 90;

// IP rate limit (per minute) across all vote endpoints.
export const MAX_REQUESTS_PER_MINUTE = 60;
