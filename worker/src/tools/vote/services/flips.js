// Accurate flip resolution. A voter "flipped" a position iff that position's
// VoteMarkerV0 shows MORE THAN ONE distinct vote choice across its on-chain
// history (voted one way, then re-voted another). The marker account stores only
// its *current* choice, and the transaction COUNT is not a usable proxy — a
// proxy's batched vote plus later crank touches leave several transactions with
// no choice change (false positive), while a position that flipped before we
// started recording looks identical to a single vote in our table (false
// negative). The only reliable signal is decoding the marker's vote
// instructions, which is what this module does, in bounded per-cron batches.

import { getSignaturesForAddress, getTransaction } from "./rpc.js";
import { actionsForMarker } from "./voteDecode.js";
import { getUnresolvedMarkers, setMarkerFlips } from "./history.js";
import { FLIP_RESOLVE_CONCURRENCY } from "../config.js";

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

// getTransaction de-duplicated within a run: proxy batch votes touch many
// markers but share signatures, so caching the in-flight promise keeps the
// unique fetch count (and the subrequest budget) small.
function getTxCached(env, signature, cache) {
  let p = cache.get(signature);
  if (!p) {
    p = getTransaction(env, signature).catch(() => null);
    cache.set(signature, p);
  }
  return p;
}

/**
 * Decode one marker's history → did it change its vote? A single transaction
 * can't be a flip, so those short-circuit without any getTransaction. Otherwise
 * we collect the distinct vote choices and call it a flip when there's >1.
 */
async function resolveMarkerFlip(env, marker, cache) {
  const sigs = await getSignaturesForAddress(env, marker, { limit: 1000 });
  if (sigs.length <= 1) return false;
  const choices = new Set();
  for (const s of sigs) {
    const tx = await getTxCached(env, s.signature, cache);
    if (!tx) continue;
    for (const a of actionsForMarker(tx, marker)) {
      if (a.action === "vote" && a.choice != null) choices.add(a.choice);
    }
  }
  return choices.size > 1;
}

/**
 * Resolve a bounded batch of a proposal's not-yet-resolved markers, persisting
 * the decoded `flipped` value. Returns the number of markers attempted (whether
 * or not the verdict stuck), so the caller can decrement a cron-wide budget.
 * Markers whose signatures couldn't be fetched are left unresolved for a retry.
 */
export async function resolveProposalFlips(env, id, { limit }) {
  if (!env.DB || limit <= 0) return 0;
  const markers = await getUnresolvedMarkers(env, id, limit);
  if (markers.length === 0) return 0;

  const cache = new Map();
  const verdicts = await mapLimit(markers, FLIP_RESOLVE_CONCURRENCY, async (m) => {
    try {
      return { marker: m, flipped: await resolveMarkerFlip(env, m, cache) };
    } catch {
      return { marker: m, flipped: null }; // transient RPC failure — retry next tick
    }
  });

  const resolved = verdicts.filter((v) => v.flipped !== null);
  await setMarkerFlips(env, id, resolved);
  console.log(JSON.stringify({
    event: "vote_flips_resolved",
    proposal: id,
    attempted: markers.length,
    resolved: resolved.length,
    flipped: resolved.filter((v) => v.flipped).length,
  }));
  return markers.length;
}
