import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleLookup } from "./handlers/lookup.js";
import { handleRewards } from "./handlers/rewards.js";
import { handleClaim } from "./handlers/claim.js";
import { handleWallet } from "./handlers/wallet.js";

export async function handleHotspotClaimerRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/lookup" && request.method === "GET") {
    return handleLookup(url, env, request);
  }

  if (pathname === "/rewards" && request.method === "GET") {
    return handleRewards(url, env, request);
  }

  if (pathname === "/claim" && request.method === "POST") {
    return handleClaim(request, env);
  }

  if (pathname === "/wallet" && request.method === "GET") {
    return handleWallet(url, env, request);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
