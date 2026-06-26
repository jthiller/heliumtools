// Snapshot orchestration. The cron calls runVoteSnapshots() to refresh every
// tracked proposal; viewer handlers call getOrRefreshSnapshot() which serves the
// stored snapshot and only triggers a (single-flight) refresh when it's cold or
// stale. In steady state the cron is the sole RPC caller — viewers never are.

import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import {
  buildProposalData,
  buildActivityData,
  fetchProposalMarkers,
  aggregateVotes,
  VoteError,
} from "./builders.js";
import { recordProposalVotes } from "./recording.js";
import { getFlippedMarkers } from "./history.js";
import {
  DEFAULT_PROPOSAL,
  SNAPSHOT_TTL,
  SNAPSHOT_STALE_MS,
  REFRESH_LOCK_TTL,
  TRACK_TTL_DAYS,
  MAX_NEW_MARKERS_PER_RUN,
} from "../config.js";

const snapKey = (id) => `vote:snap:${id}`;
const lockKey = (id) => `vote:lock:${id}`;
const TRACK_KEY = "vote:tracked";

function getSnapshot(env, id) {
  return kvGetJson(env, snapKey(id));
}

// Best-effort single-flight lock. KV has no atomic put-if-absent, so a rare
// race just means two refreshes — harmless. If KV is unavailable we allow the
// refresh rather than block it.
async function acquireLock(env, id) {
  if (!env.KV) return true;
  try {
    if (await env.KV.get(lockKey(id))) return false;
    await env.KV.put(lockKey(id), "1", { expirationTtl: REFRESH_LOCK_TTL });
    return true;
  } catch {
    return true;
  }
}
async function releaseLock(env, id) {
  if (!env.KV) return;
  try {
    await env.KV.delete(lockKey(id));
  } catch {
    /* lock self-expires via TTL */
  }
}

/**
 * Build a fresh snapshot and persist it. Single-flight: returns undefined if
 * another refresh holds the lock; otherwise `{ snapshot, markers }` so the
 * caller can record history from the same markers (no second getProgramAccounts).
 * Throws VoteError (404/400) when the proposal itself is invalid.
 */
export async function refreshSnapshot(env, id) {
  if (!(await acquireLock(env, id))) return undefined;
  try {
    const [p, m, a] = await Promise.allSettled([
      buildProposalData(env, id),
      fetchProposalMarkers(env, id),
      buildActivityData(env, id),
    ]);

    // The proposal tally is the core; if it failed we don't store a snapshot.
    if (p.status !== "fulfilled") throw p.reason;

    const markersResult = m.status === "fulfilled" ? m.value : null;
    const snapshot = {
      snapshotAt: Date.now(),
      proposal: p.value,
      votes: markersResult ? aggregateVotes(markersResult, id) : null,
      activity: a.status === "fulfilled" ? a.value : null,
    };

    // Flag roster rows whose voter changed a vote on any of their positions
    // (from the prior cron's recording — the icon may lag a flip by one cycle,
    // which is fine). Drop the internal per-position marker list from the wire.
    if (snapshot.votes) {
      const flipped = await getFlippedMarkers(env, id);
      for (const v of snapshot.votes.votes) {
        v.flipped = Array.isArray(v.markers) && v.markers.some((mk) => flipped.has(mk));
        delete v.markers;
      }
    }

    await kvPutJson(env, snapKey(id), snapshot, SNAPSHOT_TTL);
    await trackProposal(env, id);
    return { snapshot, markers: markersResult ? markersResult.markers : null };
  } finally {
    await releaseLock(env, id);
  }
}

/** Refresh, then record any new votes from the markers we just fetched. */
async function refreshAndRecord(env, id) {
  const r = await refreshSnapshot(env, id);
  if (r && r.markers) await recordProposalVotes(env, id, { markers: r.markers });
}

/**
 * Read-through for viewer handlers. Serves the stored snapshot; refreshes only
 * when cold (no snapshot → await) or stale (serve stale, refresh in background).
 */
export async function getOrRefreshSnapshot(env, id, ctx) {
  const snap = await getSnapshot(env, id);
  const fresh = snap && Date.now() - snap.snapshotAt < SNAPSHOT_STALE_MS;
  if (fresh) return snap;

  if (snap) {
    // Stale: serve immediately, refresh + record in the background.
    if (ctx) ctx.waitUntil(refreshAndRecord(env, id).catch((e) => console.error("vote bg refresh", id, e?.message)));
    return snap;
  }

  // Cold start (no snapshot yet) — build now. VoteError (404/400) propagates.
  const r = await refreshSnapshot(env, id);
  // First-ever view records the history (back to vote-open) in the background.
  if (r && r.markers && ctx) {
    ctx.waitUntil(recordProposalVotes(env, id, { markers: r.markers }).catch((e) => console.error("vote record", id, e?.message)));
  }
  return r ? r.snapshot : null;
}

// --- tracked set: DEFAULT_PROPOSAL plus any recently-viewed proposal ---------

export async function trackProposal(env, id) {
  if (id === DEFAULT_PROPOSAL) return; // always tracked implicitly
  const now = Date.now();
  const set = (await kvGetJson(env, TRACK_KEY)) || {};
  if (set[id] && now - set[id] < 60 * 60 * 1000) return; // throttle writes
  set[id] = now;
  const cutoff = now - TRACK_TTL_DAYS * 86400_000;
  for (const k of Object.keys(set)) if (set[k] < cutoff) delete set[k];
  await kvPutJson(env, TRACK_KEY, set, TRACK_TTL_DAYS * 86400 + 86400);
}

export async function getTrackedProposals(env) {
  const set = (await kvGetJson(env, TRACK_KEY)) || {};
  const cutoff = Date.now() - TRACK_TTL_DAYS * 86400_000;
  const ids = Object.keys(set).filter((k) => set[k] >= cutoff);
  if (!ids.includes(DEFAULT_PROPOSAL)) ids.unshift(DEFAULT_PROPOSAL);
  return ids;
}

/** Cron entry point — refresh every tracked proposal, recording history. */
export async function runVoteSnapshots(env) {
  const ids = await getTrackedProposals(env);
  // Cap the TOTAL new votes timed this invocation (one getSignaturesForAddress
  // each) across all proposals, so concurrent backfills can't blow the Workers
  // per-invocation subrequest limit. The remainder is picked up next tick.
  let budget = MAX_NEW_MARKERS_PER_RUN;
  for (const id of ids) {
    try {
      const r = await refreshSnapshot(env, id);
      if (r && r.markers && budget > 0) {
        budget -= await recordProposalVotes(env, id, { markers: r.markers, limit: budget });
      }
    } catch (e) {
      // VoteError (e.g. a tracked id whose proposal vanished) or RPC failure —
      // log and continue with the next proposal.
      console.error("vote snapshot failed", id, e?.message);
    }
  }
  console.log(JSON.stringify({ event: "vote_snapshots", count: ids.length }));
}

export { VoteError };
