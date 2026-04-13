import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleLookup } from "./handlers/lookup.js";
import { handleIssue } from "./handlers/issue.js";
import { handleOnboard } from "./handlers/onboard.js";
import { handleGetFees } from "./handlers/fees.js";
export { refreshOnboardFees } from "./services/fees.js";

export async function handleIotOnboardRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/fees" && request.method === "GET") {
    return handleGetFees(env);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (pathname === "/lookup") return handleLookup(request, env);
  if (pathname === "/issue") return handleIssue(request, env);
  if (pathname === "/onboard") return handleOnboard(request, env);

  return jsonResponse({ error: "Not found" }, 404);
}
