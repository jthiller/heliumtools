// Helius REST helpers. The repo's only Helius credential is the `api-key` query
// param on SOLANA_RPC_URL, so REST hosts (enhanced transactions, wallet
// identity) reuse it. Never put the key, or a URL carrying it, in an error,
// log line or response.

/**
 * Extract the Helius `api-key` from SOLANA_RPC_URL. Returns null if the URL has
 * no api-key (e.g. a non-Helius RPC).
 */
export function getHeliusApiKey(env) {
  try {
    return new URL(env.SOLANA_RPC_URL).searchParams.get("api-key");
  } catch {
    return null;
  }
}
