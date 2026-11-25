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

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `{ ["REGION:MAC"]: lastSeenMs }`, holding only times inside the window. No
 * TTL: it has to outlive any gap in the cron.
 */
export const LAST_SEEN_KV_KEY = "multi-gateway:last-seen";

/**
 * A gateway's key in the record, or null. Each region is its own aggregator
 * instance with its own keypair per MAC, so a MAC that has connected to two
 * regions is two gateways, and each is measured on its own.
 */
function recordKey({ region, mac }) {
  return typeof region === "string" && typeof mac === "string" ? `${region}:${mac}` : null;
}

/** When the aggregator's own report says this gateway was last alive, or null. */
function observedLastSeen(gateway, now) {
  if (gateway.connected) return now;
  const ago = gateway.last_uplink_seconds_ago;
  return Number.isFinite(ago) ? now - ago * 1000 : null;
}

/** The later of the recorded and the reported last-seen time, or null. */
export function lastSeenOf(gateway, record, now) {
  const key = recordKey(gateway);
  const times = [observedLastSeen(gateway, now), key && record?.[key]].filter(
    Number.isFinite,
  );
  return times.length ? Math.max(...times) : null;
}

const insideWindow = (seen, now) => now - seen < STALE_AFTER_MS;

export function isStale(gateway, record, now) {
  if (gateway.connected) return false;
  const seen = lastSeenOf(gateway, record, now);
  return seen == null || !insideWindow(seen, now);
}

/**
 * The record brought up to date with one fetch of the fleet. Times only move
 * forward, and a gateway missing from `gateways` (its region was unreachable)
 * keeps what it had.
 *
 * Times past the window are dropped, here and from what was stored: an offline
 * gateway that old is stale with or without an entry, so they change no
 * verdict and would only make the record grow for ever.
 */
export function mergeLastSeen(record, gateways, now) {
  const next = {};
  for (const [key, seen] of Object.entries(record || {})) {
    if (insideWindow(seen, now)) next[key] = seen;
  }
  for (const g of gateways) {
    const key = recordKey(g);
    const seen = lastSeenOf(g, record, now);
    if (key && seen != null && insideWindow(seen, now)) next[key] = seen;
  }
  return next;
}

/**
 * Request path: the fleet minus the stale. The record is read best-effort; if
 * KV can't be read, the rule runs on the aggregator's report alone.
 */
export async function fetchListedGateways(env) {
  const [gateways, record] = await Promise.all([
    fetchAllGateways(env),
    kvGetJson(env, LAST_SEEN_KV_KEY),
  ]);
  const now = Date.now();
  return gateways.filter((g) => !isStale(g, record, now));
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
