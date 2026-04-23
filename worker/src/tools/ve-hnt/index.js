import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handlePositions } from "./handlers/positions.js";
import { handleClaim } from "./handlers/claim.js";
import { handlePositionEpochs } from "./handlers/positionEpochs.js";

export async function handleVeHntRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/positions" && request.method === "GET") {
    return handlePositions(url, env, request);
  }

  if (pathname === "/position-epochs" && request.method === "GET") {
    return handlePositionEpochs(url, env, request);
  }

  if (pathname === "/claim" && request.method === "POST") {
    return handleClaim(request, env);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
