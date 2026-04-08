import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleMigrate } from "./handlers/migrate.js";

export async function handleL1MigrationRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/migrate" && request.method === "POST") {
    return handleMigrate(request, env);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
