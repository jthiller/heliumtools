// Single Solana JSON-RPC primitive shared across tools. Posts to
// env.SOLANA_RPC_URL and returns the `result` field (throws on RPC error).
// Per-call timeout override; the error message carries only the method name and
// the RPC's own message — never the URL/api-key.

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
