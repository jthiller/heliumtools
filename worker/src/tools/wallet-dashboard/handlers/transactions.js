import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { RATE_LIMIT, MAX_TRANSACTIONS } from "../config.js";
import { isValidWalletAddress } from "../utils.js";
import { fetchTransactions } from "../services/transactions.js";

/**
 * GET /transactions?wallet=<addr>&before=<sig>&limit=<n>
 * Recent categorized transactions, paginated via the `before` signature cursor.
 */
export async function handleTransactions(url, env, request) {
  const wallet = url.searchParams.get("wallet");
  if (!isValidWalletAddress(wallet)) {
    return jsonResponse({ error: "Invalid wallet address" }, 400);
  }

  const limited = await checkIpRateLimit(env, request, RATE_LIMIT);
  if (limited) return limited;

  // `before` is a base58 transaction signature; reject anything else so it can't
  // be used to inject query params into the upstream URL.
  const beforeRaw = url.searchParams.get("before");
  if (beforeRaw && !/^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(beforeRaw)) {
    return jsonResponse({ error: "Invalid before cursor" }, 400);
  }
  const before = beforeRaw || null;
  const limitParam = parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 50)
    : MAX_TRANSACTIONS;

  try {
    const data = await fetchTransactions(env, wallet, { before, limit });
    return jsonResponse({ wallet, ...data });
  } catch (err) {
    return jsonResponse({ error: `Failed to load transactions: ${err.message}` }, 502);
  }
}
