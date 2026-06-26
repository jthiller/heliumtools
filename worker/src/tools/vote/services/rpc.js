// Thin Solana JSON-RPC helpers for the vote tool. All requests go through the
// worker's own SOLANA_RPC_URL (Helius staked endpoint) — never the browser.

/**
 * Make a single Solana JSON-RPC call against env.SOLANA_RPC_URL.
 * Returns the `result` field, or throws on RPC error.
 */
export async function rpc(env, method, params, { timeoutMs = 15_000 } = {}) {
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
 * getAccountInfo → Buffer (base64-decoded) or null if the account is missing.
 */
export async function getAccount(env, pubkey) {
  const address = typeof pubkey === "string" ? pubkey : pubkey.toBase58();
  const result = await rpc(env, "getAccountInfo", [
    address,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  const value = result?.value;
  if (!value) return null;
  return { buf: Buffer.from(value.data[0], "base64"), owner: value.owner };
}

/**
 * getProgramAccounts with memcmp filters. Returns [{ pubkey, buf }].
 * `filters` is an array of { offset, bytesBase58 } memcmp specs.
 */
export async function getProgramAccounts(env, programId, filters, { timeoutMs = 25_000 } = {}) {
  const program = typeof programId === "string" ? programId : programId.toBase58();
  const result = await rpc(
    env,
    "getProgramAccounts",
    [
      program,
      {
        encoding: "base64",
        commitment: "confirmed",
        filters: filters.map((f) => ({
          memcmp: { offset: f.offset, bytes: f.bytesBase58, encoding: "base58" },
        })),
      },
    ],
    { timeoutMs },
  );
  return (result || []).map((item) => ({
    pubkey: item.pubkey,
    buf: Buffer.from(item.account.data[0], "base64"),
  }));
}

/**
 * getSignaturesForAddress → [{ signature, blockTime, slot, err, memo }].
 * Used to build the time-ordered live activity feed (newest first).
 */
export async function getSignaturesForAddress(env, address, { limit, before } = {}) {
  const opts = {};
  if (limit) opts.limit = limit;
  if (before) opts.before = before;
  const addr = typeof address === "string" ? address : address.toBase58();
  return (await rpc(env, "getSignaturesForAddress", [addr, opts])) || [];
}
