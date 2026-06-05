import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleSummary } from "./handlers/summary.js";
import { handleFleet } from "./handlers/fleet.js";
import { handleTransactions } from "./handlers/transactions.js";
import { handleRewards } from "./handlers/rewards.js";

/**
 * Wallet Dashboard — read-only aggregation API.
 *   GET  /summary?wallet=       balances + USD prices + fleet stats
 *   GET  /fleet?wallet=         full per-Hotspot list + stats
 *   GET  /transactions?wallet=  categorized recent transactions
 *   POST /rewards               batched + cached pending/lifetime rewards
 *
 * Governance (veHNT) is served by the existing /ve-hnt endpoint, called from the
 * client. The shared /hotspot-claimer/wallet/rewards is intentionally NOT used
 * here — it stays live/uncached for actual claims; /rewards above is the cached path.
 */
export async function handleWalletDashboardRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/summary" && request.method === "GET") {
    return handleSummary(url, env, request);
  }
  if (pathname === "/fleet" && request.method === "GET") {
    return handleFleet(url, env, request);
  }
  if (pathname === "/transactions" && request.method === "GET") {
    return handleTransactions(url, env, request);
  }
  if (pathname === "/rewards" && request.method === "POST") {
    return handleRewards(request, env);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
