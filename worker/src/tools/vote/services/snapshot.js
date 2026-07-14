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
  aggregateVotesFromEvents,
  VoteError,
} from "./builders.js";
import { recordProposalVotes } from "./recording.js";
import { resolveProposalFlips } from "./flips.js";
import { getCirculatingVeHnt, refreshCirculatingVeHnt } from "./circulating.js";
import { getFlippedMarkers, getEventRows, getUnresolvedMarkers } from "./history.js";
import { getProxyMap } from "./proxies.js";
import { upsertCatalogRow, hasCatalogRow } from "./catalog.js";
import {
  DEFAULT_PROPOSAL,
  KNOWN_PROPOSALS,
  SNAPSHOT_TTL,
  RESOLVED_SNAPSHOT_TTL,
  SNAPSHOT_STALE_MS,
  REFRESH_LOCK_TTL,
  TRACK_TTL_DAYS,
  MAX_NEW_MARKERS_PER_RUN,
  FLIP_RESOLVE_PER_RUN,
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
    const [p, m] = await Promise.allSettled([
      buildProposalData(env, id),
      fetchProposalMarkers(env, id),
    ]);

    // The proposal tally is the core; if it failed we don't store a snapshot.
    if (p.status !== "fulfilled") throw p.reason;

    const markersResult = m.status === "fulfilled" ? m.value : null;

    // Activity decodes each recent tx for its vote direction + size, so it needs
    // the marker weights — built after markers resolve, not in parallel.
    let activity = null;
    try {
      activity = await buildActivityData(env, id, markersResult ? markersResult.markers : []);
    } catch (e) {
      console.error("vote activity build failed", id, e?.message);
    }

    // Participation denominator: read the cached circulating-veHNT figure (a
    // plain KV read — the heavy recompute is triggered separately by the cron).
    // Attached to the proposal so it rides the /vote/proposal response.
    const circulating = await getCirculatingVeHnt(env).catch(() => null);
    if (circulating) p.value.circulating = circulating;

    const settled = isSettled(p.value);
    let votes = markersResult ? aggregateVotes(markersResult, id) : null;

    // End-state counting: markers close once a proposal resolves, so the live
    // scan zeroes every marker-derived metric (voters, per-choice voter counts,
    // roster). Rebuild the final roster from the recorded D1 vote events — the
    // proposal account's choice weights remain the authoritative tally.
    if (settled && (!votes || votes.markerCount === 0)) {
      try {
        const rows = await getEventRows(env, id);
        if (rows.length > 0) votes = aggregateVotesFromEvents(rows, id);
      } catch (e) {
        console.error("vote roster reconstruction failed", id, e?.message);
      }
      // Still empty (nothing recorded to rebuild from — e.g. the vote resolved
      // before this page ever tracked it): the roster is UNKNOWABLE, not zero.
      // Null keeps the catalog's COALESCE from blanking real prior figures
      // with zeros and lets the UI show unknowns instead of "0 voters".
      if (votes && votes.markerCount === 0) votes = null;
    }

    const snapshot = {
      snapshotAt: Date.now(),
      proposal: p.value,
      votes,
      activity,
    };
    // Stamp settled snapshots as end-state complete. The stamp (not the status)
    // is what freezes them: snapshots stored by pre-reconstruction code lack it,
    // so they get exactly one corrective refresh that rebuilds the roster.
    // Don't stamp while the flip resolver still has undecoded markers — the
    // roster above read the flags as they currently stand, and the resolver
    // runs AFTER the refresh loop each cron tick, so freezing now would lose
    // the final batch of ⇄ flags. Unstamped settled snapshots keep refreshing
    // (once per tick) until the backlog drains, then freeze fully converged.
    if (settled) {
      const pendingFlips = await getUnresolvedMarkers(env, id, 1).catch(() => [{}]);
      if (pendingFlips.length === 0) snapshot.final = true;
    }

    // Enrich roster rows: flag voters who changed a vote on any position (from
    // the prior cron's recording — the icon may lag a flip by one cycle), and
    // resolve registered proxy/delegate names. Drop the internal per-position
    // marker list from the wire. (Reconstructed rosters carry `flipped` from the
    // event rows already and have no marker lists — they only need proxy names.)
    if (snapshot.votes) {
      const [proxyMap, flipped] = await Promise.all([
        getProxyMap(env),
        snapshot.votes.reconstructed ? null : getFlippedMarkers(env, id),
      ]);
      for (const v of snapshot.votes.votes) {
        if (flipped) v.flipped = Array.isArray(v.markers) && v.markers.some((mk) => flipped.has(mk));
        const proxy = proxyMap[v.voter];
        if (proxy) v.proxyName = proxy.name;
        delete v.markers;
      }
    }

    // Persist: KV snapshot (long TTL once settled — immutable), the durable
    // index catalog row, and the tracked set. Independent stores, so parallel.
    await Promise.all([
      kvPutJson(env, snapKey(id), snapshot, settled ? RESOLVED_SNAPSHOT_TTL : SNAPSHOT_TTL),
      upsertCatalogRow(env, snapshot).catch((e) => console.error("vote catalog upsert failed", id, e?.message)),
      trackProposal(env, id),
    ]);
    return { snapshot, markers: markersResult ? markersResult.markers : null };
  } finally {
    await releaseLock(env, id);
  }
}

/** A settled proposal (resolved/cancelled) can never change again. */
function isSettled(proposal) {
  return proposal && (proposal.state === "resolved" || proposal.state === "cancelled");
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
  // A `final` snapshot (settled + end-state roster already rebuilt) is
  // immutable — serve it frozen with no background refresh. Settled snapshots
  // from before the reconstruction existed aren't stamped, so they take the
  // stale path once and come back corrected.
  const fresh = snap && (snap.final || Date.now() - snap.snapshotAt < SNAPSHOT_STALE_MS);
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
  const viewed = Object.keys(set).filter((k) => set[k] >= cutoff);
  // Pinned ids (the current default + past featured votes) are always tracked,
  // so they stay in the index catalog and settle cleanly after resolution.
  const pinned = [DEFAULT_PROPOSAL, ...KNOWN_PROPOSALS.filter((id) => id !== DEFAULT_PROPOSAL)];
  return [...pinned, ...viewed.filter((id) => !pinned.includes(id))];
}

/** Cron entry point — refresh every tracked proposal, recording history. */
export async function runVoteSnapshots(env) {
  // Refresh the circulating-veHNT denominator first (throttled by its own TTL,
  // so this is a cheap cache hit on most ticks and a heavy enumeration only
  // ~hourly), isolated so a failure never blocks the snapshots below.
  try {
    await refreshCirculatingVeHnt(env);
  } catch (e) {
    console.error("vote circulating refresh failed", e?.message);
  }

  const ids = await getTrackedProposals(env);
  // Cap the TOTAL new votes timed this invocation (one getSignaturesForAddress
  // each) across all proposals, so concurrent backfills can't blow the Workers
  // per-invocation subrequest limit. The remainder is picked up next tick.
  let budget = MAX_NEW_MARKERS_PER_RUN;
  for (const id of ids) {
    try {
      // A proposal whose stored snapshot is `final` is immutable AND fully
      // converged — refreshSnapshot only stamps it once the flip resolver's
      // backlog is empty, so the stamp alone is the skip condition. Just make
      // sure its index catalog row exists (the snapshot might predate the
      // catalog).
      const stored = await getSnapshot(env, id);
      if (stored && stored.final) {
        if (!(await hasCatalogRow(env, id).catch(() => true))) {
          await upsertCatalogRow(env, stored).catch((e) => console.error("vote catalog backfill failed", id, e?.message));
        }
        continue;
      }
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

  // Decode flip status for not-yet-resolved markers, also capped per invocation.
  // The first runs after deploy back-fill every existing marker (flip_resolved
  // defaults to 0), correcting flags; steady state only touches new markers. The
  // roster picks up resolved flips on the next refresh (one-cycle lag, as noted).
  let flipBudget = FLIP_RESOLVE_PER_RUN;
  for (const id of ids) {
    if (flipBudget <= 0) break;
    try {
      flipBudget -= await resolveProposalFlips(env, id, { limit: flipBudget });
    } catch (e) {
      console.error("vote flip resolve failed", id, e?.message);
    }
  }
  console.log(JSON.stringify({ event: "vote_snapshots", count: ids.length }));
}

export { VoteError };
