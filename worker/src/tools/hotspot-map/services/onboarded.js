import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import { hotspotInfoCreatedAt } from "../../../lib/helium-solana.js";
import { ONBOARDED_CACHE_TTL, ONBOARDED_UNKNOWN_CACHE_TTL } from "../config.js";
import { deriveIotInfoPDA, deriveMobileInfoPDA, hashEntityKey } from "./pda.js";

/**
 * On-chain onboard dates for one Hotspot, per network — for the map's detail
 * card. See `hotspotInfoCreatedAt` (lib/helium-solana.js) for what the date is,
 * the L1-migration caveat, and why not the Entity API's `created_at`.
 *
 * The info-account addresses are derived here from the entity key (same PDAs
 * as /resolve), never taken from the client, so this can't be pointed at
 * arbitrary accounts.
 */

const PDA_BY_NETWORK = { iot: deriveIotInfoPDA, mobile: deriveMobileInfoPDA };
export const ONBOARD_NETWORKS = Object.keys(PDA_BY_NETWORK);

// Keyed by the info account — a fixed function of (network, entity key) — so
// the key stays short whatever the entity key's length.
const cacheKey = (address) => `hm:onb:${address}`;

/** The info-account address for each requested network. */
export async function infoAccountsFor(entityKey, networks) {
  const hash = await hashEntityKey(entityKey);
  return Object.fromEntries(networks.map((net) => [net, PDA_BY_NETWORK[net](hash).toBase58()]));
}

/**
 * Read cached dates. Returns { [network]: iso | null } for hits only. (Cached
 * as { at } so a cached null is distinguishable from a miss.)
 */
export async function readCachedOnboardDates(env, accounts) {
  const nets = Object.keys(accounts);
  const entries = await Promise.all(nets.map((net) => kvGetJson(env, cacheKey(accounts[net]))));
  const hits = {};
  nets.forEach((net, i) => {
    if (entries[i] && "at" in entries[i]) hits[net] = entries[i].at;
  });
  return hits;
}

/**
 * Resolve dates from chain for `accounts` ({ [network]: address }). Returns
 * { [network]: iso | null }. A failed lookup resolves null and isn't cached,
 * so the next view retries it.
 */
export async function resolveOnboardDates(env, accounts) {
  const nets = Object.keys(accounts);
  const times = await Promise.all(
    nets.map((net) => hotspotInfoCreatedAt(env, accounts[net]).catch(() => undefined)),
  );
  const results = {};
  const writes = [];
  nets.forEach((net, i) => {
    if (times[i] === undefined) {
      results[net] = null;
      return;
    }
    const at = times[i] == null ? null : new Date(times[i] * 1000).toISOString();
    results[net] = at;
    writes.push(kvPutJson(env, cacheKey(accounts[net]), { at }, at ? ONBOARDED_CACHE_TTL : ONBOARDED_UNKNOWN_CACHE_TTL));
  });
  await Promise.all(writes);
  return results;
}
