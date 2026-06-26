// Incremental vote recorder. Enumerates a proposal's still-open VoteMarkerV0
// accounts, and for any not yet recorded, reads the marker account's *creation*
// transaction to learn the exact time the vote was cast (markers carry no
// timestamp), then stores one immutable event per vote. The first run records
// every existing vote (the backfill to vote-open); later runs append only new
// ones. New votes per run are capped so a large first run spreads over a few
// cron ticks rather than blowing the subrequest budget.

import { fetchProposalMarkers } from "./builders.js";
import { getSignaturesForAddress } from "./rpc.js";
import { getRecordedMarkers, insertVoteEvents } from "./history.js";
import { MARKER_TIME_CONCURRENCY, MAX_NEW_MARKERS_PER_RUN } from "../config.js";

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * @param markers pre-fetched markers (from the snapshot) to avoid a second
 *   getProgramAccounts; fetched here if omitted.
 * @param limit   max new votes to time this call (cron-wide subrequest budget).
 */
export async function recordProposalVotes(env, id, { markers = null, limit = MAX_NEW_MARKERS_PER_RUN } = {}) {
  if (!env.DB || limit <= 0) return 0;

  if (!markers) ({ markers } = await fetchProposalMarkers(env, id));
  if (markers.length === 0) return 0; // resolved/closed or no votes yet

  // Process markers that are new OR whose choice changed since we recorded them
  // (a flip). recorded: Map(marker -> stored choices_json).
  const recorded = await getRecordedMarkers(env, id);
  let pending = markers.filter((m) => {
    const stored = recorded.get(m.pubkey);
    return stored === undefined || stored !== JSON.stringify(m.choices);
  });
  if (pending.length === 0) return 0;
  if (pending.length > limit) pending = pending.slice(0, limit);

  const rows = (await mapLimit(pending, MARKER_TIME_CONCURRENCY, async (m) => {
    try {
      // A marker account has only a couple of txns, so one page is plenty; the
      // oldest signature with a blockTime is the vote's creation time, and >1
      // vote-action tx means the voter changed their vote.
      const sigs = await getSignaturesForAddress(env, m.pubkey, { limit: 1000 });
      let ts = null;
      for (let i = sigs.length - 1; i >= 0; i--) {
        if (sigs[i].blockTime != null) { ts = sigs[i].blockTime; break; }
      }
      if (ts == null) return null; // no blockTime available — retried next tick
      // Flipped if it already had prior actions when first seen, or its choice
      // changed since we recorded it (it was already in the table).
      const flipped = sigs.length > 1 || recorded.has(m.pubkey);
      return { marker: m.pubkey, ts, voter: m.voter, choices: m.choices, weight: m.weight.toString(), flipped };
    } catch {
      return null;
    }
  })).filter(Boolean);

  await insertVoteEvents(env, id, rows);
  console.log(JSON.stringify({
    event: "vote_events_recorded",
    proposal: id,
    recorded: rows.length,
    pending: pending.length,
  }));
  return rows.length;
}
