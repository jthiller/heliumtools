import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleLabels, handleRuns, handleSeat, handleSummary } from "./handlers/views.js";
import { handleAdminIndex, handleAdminRebuild } from "./handlers/admin.js";
import { runCouncilEmissionsIndex } from "./services/indexer.js";

// Re-exported so src/index.js scheduled() can drive the indexer on FAST_CRON.
export { runCouncilEmissionsIndex };

/**
 * Council Emissions (HIP-149 Advisory Council emissions) — prefix `/council-emissions`.
 *   GET  /summary        totals, per-seat rollups and the emissions timeline lanes
 *   GET  /seat?wallet=   one seat: every emission with where it went, every outflow
 *   GET  /runs           distribution runs, council mints and failed distribution attempts
 *   GET  /labels         the address labels the trace uses (registry + identity)
 *   POST /admin/index    run one indexer pass (Bearer ADMIN_TOKEN)
 *   POST /admin/rebuild  replay stored history with current rules, no RPC (Bearer ADMIN_TOKEN)
 *
 * Viewers read KV documents the cron indexer writes; they never reach the RPC.
 */
export async function handleCouncilEmissionsRequest(request, env, ctx) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const url = new URL(request.url);

  if (request.method === "POST") {
    switch (url.pathname) {
      case "/admin/index": return handleAdminIndex(request, env);
      case "/admin/rebuild": return handleAdminRebuild(request, env);
      default: return jsonResponse({ error: "Not found" }, 404);
    }
  }
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  switch (url.pathname) {
    case "/summary": return handleSummary(env, request, ctx);
    case "/seat": return handleSeat(url, env, request, ctx);
    case "/runs": return handleRuns(env, request, ctx);
    case "/labels": return handleLabels(env, request, ctx);
    default: return jsonResponse({ error: "Not found" }, 404);
  }
}
