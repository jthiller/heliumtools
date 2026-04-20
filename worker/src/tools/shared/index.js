import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleGeo } from "./handlers/geo.js";

export async function handleSharedRequest(request, env, ctx) {
  const { pathname } = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/geo" && request.method === "GET") {
    return handleGeo(request);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
