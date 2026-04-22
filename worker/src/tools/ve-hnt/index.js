import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handlePositions } from "./handlers/positions.js";

export async function handleVeHntRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/positions" && request.method === "GET") {
    return handlePositions(url, env, request);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
