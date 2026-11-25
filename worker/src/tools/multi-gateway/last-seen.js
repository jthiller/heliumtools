// Which gateways the dashboard lists.
//
// The aggregator keeps a key for every gateway that ever connected and lists
// them all, forever. /gateways leaves out the ones that have been offline for
// STALE_AFTER_MS, from the list and from its counts. Nothing is removed
// upstream: the keys stay on the server, and a gateway is listed again as soon
// as it reconnects. The per-mac endpoints (packets, issue, onboard) are not
// filtered, so a direct link to an unlisted gateway still works.
//
// "Offline for 30 days" needs a last-seen time, and the aggregator has none
// that lasts. It reports `connected` and `last_uplink_seconds_ago`, both held
// in memory: a restart resets every gateway to "no uplink" (null), and it
// never records when a gateway disconnected. So the worker keeps its own
// record in KV, written by the 6-hourly cron, and measures from the later of
// the record and what the aggregator reports. An offline gateway with neither
// has nothing to measure from and is left out.

import { kvGetJson } from "../../lib/kv.js";
import { fetchAllGateways } from "./lib/upstream.js";

export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** `{ [mac]: lastSeenMs }`. No TTL: it has to outlive any gap in the cron. */
export const LAST_SEEN_KV_KEY = "multi-gateway:last-seen";

/** When the aggregator's own report says this gateway was last alive, or null. */
function observedLastSeen(gateway, now) {
  if (gateway.connected) return now;
  const ago = gateway.last_uplink_seconds_ago;
  return Number.isFinite(ago) ? now - ago * 1000 : null;
}

/** The later of the recorded and the reported last-seen time, or null. */
export function lastSeenOf(gateway, record, now) {
  const observed = observedLastSeen(gateway, now);
  const stored = record?.[gateway.mac];
  const recorded = Number.isFinite(stored) ? stored : null;
  if (observed == null) return recorded;
  return recorded == null ? observed : Math.max(recorded, observed);
}

export function isStale(gateway, record, now) {
  if (gateway.connected) return false;
  const seen = lastSeenOf(gateway, record, now);
  return seen == null || now - seen >= STALE_AFTER_MS;
}

/** The gateways /gateways returns: everything not stale. */
export function listedGateways(gateways, record, now) {
  return gateways.filter((g) => !isStale(g, record, now));
}

/**
 * The record brought up to date with one fetch of the fleet. Times only move
 * forward, and a gateway missing from `gateways` (its region was unreachable)
 * keeps what it had.
 */
export function mergeLastSeen(record, gateways, now) {
  const next = { ...record };
  for (const g of gateways) {
    if (typeof g.mac !== "string") continue;
    const seen = lastSeenOf(g, record, now);
    if (seen != null) next[g.mac] = seen;
  }
  return next;
}

/** The last-seen record for a request: best-effort, null when KV can't be read. */
export function readLastSeen(env) {
  return kvGetJson(env, LAST_SEEN_KV_KEY);
}

/** Cron (6-hourly): fold the fleet's current state into the last-seen record. */
export async function recordGatewayLastSeen(env) {
  if (!env.KV || !env.MULTI_GATEWAY_API_KEY) return;
  const gateways = await fetchAllGateways(env);
  if (gateways.length === 0) return;
  // Not kvGetJson: a failed read has to throw, not pass for "no record yet".
  // Merging into an empty record would write away the last-seen time of every
  // gateway the aggregator no longer remembers.
  const record = (await env.KV.get(LAST_SEEN_KV_KEY, "json")) || {};
  const next = mergeLastSeen(record, gateways, Date.now());
  await env.KV.put(LAST_SEEN_KV_KEY, JSON.stringify(next));
}
