// Wallet Dashboard — small shared helpers.

// Reuse the canonical validator (already cross-imported by hotspot-map) rather
// than keeping a third copy of the base58/length check.
export { isValidWalletAddress } from "../hotspot-claimer/utils.js";
// The Solana RPC primitive and KV JSON helpers now live in worker/src/lib so
// they aren't duplicated per tool — re-export to keep this module's API stable.
export { rpc } from "../../lib/solanaRpc.js";
export { kvGetJson, kvPutJson } from "../../lib/kv.js";

/**
 * Extract the Helius `api-key` query param from SOLANA_RPC_URL so we can reach
 * the Helius enhanced-transactions REST API (a different host than the RPC).
 * Returns null if the URL has no api-key (e.g. a non-Helius RPC).
 */
export function getHeliusApiKey(env) {
  try {
    return new URL(env.SOLANA_RPC_URL).searchParams.get("api-key");
  } catch {
    return null;
  }
}
