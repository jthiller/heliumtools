import { HELIUS_ENHANCED_BASE, MAX_TRANSACTIONS } from "../config.js";
import { rpc, getHeliusApiKey } from "../utils.js";

/**
 * Fetch a wallet's recent transactions, categorized when possible.
 *
 * Primary: Helius enhanced-transactions REST API, which returns a human type
 * (e.g. COMPRESSED_NFT_MINT, TRANSFER, ...), source, and English description.
 * Fallback: plain getSignaturesForAddress (signature + time + success only).
 *
 * Returns { transactions: [...], cursor, source: "enhanced" | "basic" }.
 * `cursor` is the last signature, to pass back as `before` for "load more".
 */
export async function fetchTransactions(env, wallet, { before = null, limit = MAX_TRANSACTIONS } = {}) {
  const apiKey = getHeliusApiKey(env);
  if (apiKey) {
    try {
      return await fetchEnhanced(wallet, apiKey, { before, limit });
    } catch (err) {
      console.error("wallet-dashboard: enhanced tx fetch failed, falling back:", err.message);
    }
  }
  return await fetchBasic(env, wallet, { before, limit });
}

async function fetchEnhanced(wallet, apiKey, { before, limit }) {
  let url = `${HELIUS_ENHANCED_BASE}/v0/addresses/${wallet}/transactions?api-key=${encodeURIComponent(apiKey)}&limit=${limit}`;
  if (before) url += `&before=${encodeURIComponent(before)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Helius enhanced API returned ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("Unexpected enhanced API response");

  const transactions = data.map((t) => ({
    signature: t.signature,
    timestamp: t.timestamp ?? null, // unix seconds
    type: t.type || "UNKNOWN",
    source: t.source || null,
    description: t.description || null,
    fee: t.fee ?? null, // lamports
    success: !t.transactionError,
  }));

  return {
    transactions,
    cursor: transactions.length === limit ? transactions[transactions.length - 1].signature : null,
    source: "enhanced",
  };
}

async function fetchBasic(env, wallet, { before, limit }) {
  const opts = { limit };
  if (before) opts.before = before;
  const sigs = (await rpc(env, "getSignaturesForAddress", [wallet, opts])) || [];

  const transactions = sigs.map((s) => ({
    signature: s.signature,
    timestamp: s.blockTime ?? null,
    type: "UNKNOWN",
    source: null,
    description: s.memo || null,
    fee: null,
    success: !s.err,
  }));

  return {
    transactions,
    cursor: transactions.length === limit ? transactions[transactions.length - 1].signature : null,
    source: "basic",
  };
}
