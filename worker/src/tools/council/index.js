import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleIngest } from "./handlers/ingest.js";
import { handleRefresh } from "./handlers/refresh.js";
import { handleDiag } from "./handlers/diag.js";
import { handleNominations } from "./handlers/nominations.js";
import { handleCms } from "./handlers/cms.js";
import { handleReview } from "./handlers/review.js";
import { handleModerate } from "./handlers/moderate.js";

// Cron entry: the Discord-bot poller (primary ingest source). Re-exported so the
// top-level scheduled() handler can drive it on the 6-hourly ticks.
export { pollCouncil } from "./services/poll.js";

/**
 * Council (advisory-council nominations) tool — prefix `/council`. A blind page
 * (deliberately not listed on the landing page). Push-model: a local Discord
 * scraper POSTs classified snapshots to the admin-gated ingest endpoint; viewers
 * read a KV-cached public feed. The worker never talks to Discord, runs no cron,
 * and needs no new binding (ingest auth resolves COUNCIL_INGEST_TOKEN, falling
 * back to the shared ADMIN_TOKEN). See CLAUDE.md.
 *
 *   POST /council/ingest       — admin-token-gated snapshot push (manual override)
 *   POST /council/refresh      — admin-token-gated manual trigger for the Discord poll
 *   GET  /council/nominations  — public nominations tree (KV-cached, review-gated)
 *   GET  /council/cms          — public flat feed for an external CMS (KV-cached, review-gated)
 *   GET  /council/review       — admin: all nominations + review status (for the review pass)
 *   POST /council/moderate     — admin: set approve/reject/reset review decisions
 */
export async function handleCouncilRequest(request, env, ctx) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);

  switch (url.pathname) {
    case "/ingest":
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      return handleIngest(request, env);
    case "/refresh":
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      return handleRefresh(request, env);
    case "/diag":
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      return handleDiag(request, env);
    case "/nominations":
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      return handleNominations(request, env);
    case "/cms":
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      return handleCms(request, env);
    case "/review":
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      return handleReview(request, env);
    case "/moderate":
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      return handleModerate(request, env);
    default:
      return jsonResponse({ error: "Not found" }, 404);
  }
}
