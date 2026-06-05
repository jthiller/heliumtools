// Wallet Dashboard — small shared helpers.

// Reuse the canonical validator (already cross-imported by hotspot-map) rather
// than keeping a third copy of the base58/length check.
export { isValidWalletAddress } from "../hotspot-claimer/utils.js";

/**
 * Make a single Solana JSON-RPC call against env.SOLANA_RPC_URL.
 * Returns the `result` field, or throws on RPC error.
 */
export async function rpc(env, method, params, { timeoutMs = 10_000 } = {}) {
  if (!env.SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL is not configured");
  const res = await fetch(env.SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

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

/** Read a JSON value from KV, swallowing errors (cache is best-effort). */
export async function kvGetJson(env, key) {
  try {
    return await env.KV.get(key, "json");
  } catch {
    return null;
  }
}

/** Write a JSON value to KV with a TTL, swallowing errors (cache is best-effort). */
export async function kvPutJson(env, key, value, ttlSeconds) {
  try {
    await env.KV.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch {
    // best-effort
  }
}
