// Tool-specific Solana RPC wrappers for the vote tool, over the shared `rpc`
// primitive. All requests go through the worker's own SOLANA_RPC_URL — never the
// browser.

import { rpc } from "../../../lib/solanaRpc.js";

/**
 * getAccountInfo → Buffer (base64-decoded) or null if the account is missing.
 */
export async function getAccount(env, pubkey) {
  const address = typeof pubkey === "string" ? pubkey : pubkey.toBase58();
  const result = await rpc(env, "getAccountInfo", [
    address,
    { encoding: "base64", commitment: "confirmed" },
  ], { timeoutMs: 15_000 });
  const value = result?.value;
  if (!value) return null;
  return { buf: Buffer.from(value.data[0], "base64"), owner: value.owner };
}

/**
 * getProgramAccounts with memcmp filters. Returns [{ pubkey, buf }].
 * `filters` is an array of { offset, bytesBase58 } memcmp specs.
 */
export async function getProgramAccounts(env, programId, filters, { timeoutMs = 25_000, dataSlice } = {}) {
  const program = typeof programId === "string" ? programId : programId.toBase58();
  const config = {
    encoding: "base64",
    commitment: "confirmed",
    filters: filters.map((f) => ({
      memcmp: { offset: f.offset, bytes: f.bytesBase58, encoding: "base58" },
    })),
  };
  // dataSlice trims each account's returned data to a window — used when we only
  // need a few fields (e.g. position voting-power inputs) and the set is large.
  if (dataSlice) config.dataSlice = dataSlice;
  const result = await rpc(env, "getProgramAccounts", [program, config], { timeoutMs });
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
  // Generous timeout — the recorder fetches up to 1000 signatures per marker.
  return (await rpc(env, "getSignaturesForAddress", [addr, opts], { timeoutMs: 20_000 })) || [];
}

/** getTransaction (jsonParsed, v0-aware) → the parsed transaction, or null. */
export async function getTransaction(env, signature) {
  return rpc(env, "getTransaction", [
    signature,
    { maxSupportedTransactionVersion: 0, encoding: "jsonParsed", commitment: "confirmed" },
  ], { timeoutMs: 15_000 });
}
