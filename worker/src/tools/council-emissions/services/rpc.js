// RPC access for the council indexer. Single calls reuse the shared `rpc`
// primitive; transaction fetches go out as JSON-RPC batches. Errors carry only
// the method and the RPC's own message, never the URL or its api-key.

import { rpc } from "../../../lib/solanaRpc.js";
import { getHeliusApiKey } from "../../../lib/helius.js";
import { SIG_PAGE } from "../config.js";

/**
 * Send many calls in one JSON-RPC array POST. Returns results in call order;
 * a failed item comes back as { error } so the caller can retry it later.
 * @param {{ method: string, params: any[] }[]} calls
 */
export async function rpcBatch(env, calls, { timeoutMs = 25_000 } = {}) {
  if (!calls.length) return [];
  if (!env.SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL is not configured");
  const res = await fetch(env.SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }))),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${calls[0].method} batch: HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`${calls[0].method} batch: ${body?.error?.message || "unexpected response"}`);
  const byId = new Map(body.map((item) => [item.id, item]));
  return calls.map((_, i) => {
    const item = byId.get(i);
    if (!item) return { error: "missing" };
    if (item.error) return { error: item.error.message || "error" };
    return { result: item.result };
  });
}

/** getSignaturesForAddress, newest first (finalized). */
export async function getSignatures(env, address, { before, until, limit = SIG_PAGE } = {}) {
  const opts = { limit };
  if (before) opts.before = before;
  if (until) opts.until = until;
  return (await rpc(env, "getSignaturesForAddress", [address, opts], { timeoutMs: 20_000 })) || [];
}

export function getTransactionCall(signature) {
  return {
    method: "getTransaction",
    params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
  };
}

/** Raw token amounts for token accounts (null entries for missing accounts). */
export async function getTokenBalances(env, addresses) {
  const out = {};
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    // Finalized, like the signature lists, so an emission seen in one is seen in both.
    const result = await rpc(env, "getMultipleAccounts", [chunk, { encoding: "jsonParsed", commitment: "finalized" }], { timeoutMs: 15_000 });
    (result?.value || []).forEach((v, j) => {
      out[chunk[j]] = v ? v.data?.parsed?.info?.tokenAmount?.amount ?? "0" : "0";
    });
  }
  return out;
}

/** HNT token accounts an owner holds, under both token programs. */
export async function getOwnerTokenAccounts(env, owner, mint) {
  const out = [];
  for (const programId of ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]) {
    const result = await rpc(env, "getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }], { timeoutMs: 15_000 });
    for (const a of result?.value || []) {
      if (a.account?.data?.parsed?.info?.mint === mint) out.push(a.pubkey);
    }
  }
  return out;
}

/** The fanout account's raw bytes, or null if it no longer exists. */
export async function getAccountData(env, address) {
  const result = await rpc(env, "getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }], { timeoutMs: 15_000 });
  const value = result?.value;
  return value ? Buffer.from(value.data[0], "base64") : null;
}

/**
 * Helius Wallet Identity for one address, trimmed to what labels use.
 * Returns { none: true } when Helius knows nothing, or null on a transient
 * failure (not cached, retried on a later run).
 */
export async function getIdentity(env, address) {
  const key = getHeliusApiKey(env);
  if (!key) return null;
  let res;
  try {
    res = await fetch(`https://api.helius.xyz/v1/wallet/${address}/identity?api-key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (res.status === 404) return { none: true };
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  if (!j) return null;
  const trimmed = { type: j.type || "unknown", name: j.name || null, category: j.category || null, tags: Array.isArray(j.tags) ? j.tags.slice(0, 5) : [] };
  return trimmed.name || trimmed.type !== "unknown" || trimmed.tags.length ? trimmed : { none: true };
}
