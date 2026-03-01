import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleResolve } from "./handlers/resolve.js";
import { handleWallet } from "./handlers/wallet.js";

export async function handleHotspotMapRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/resolve" && request.method === "POST") {
    return handleResolve(request, env);
  }

  if (pathname === "/wallet" && request.method === "GET") {
    return handleWallet(url, env, request);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
