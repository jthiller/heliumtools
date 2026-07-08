import { jsonResponse } from "../../../lib/response.js";
import { pollCouncil } from "../services/poll.js";

/**
 * POST /council/refresh — admin-gated manual trigger for the Discord poll, so an
 * operator can force an immediate refresh instead of waiting for the 6-hourly cron.
 * Same token gate as /ingest (COUNCIL_INGEST_TOKEN, then ADMIN_TOKEN). Surfaces the
 * poll's own error (e.g. a 401/403 from Discord) as a 502 so setup problems are
 * diagnosable — those messages are token-free by construction.
 */
export async function handleRefresh(request, env) {
  const token = env.COUNCIL_INGEST_TOKEN || env.ADMIN_TOKEN;
  if (!token) return jsonResponse({ error: "Service unavailable" }, 503);
  if (request.headers.get("Authorization") !== `Bearer ${token}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const result = await pollCouncil(env);
    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    return jsonResponse({ error: String(err?.message || err) }, 502);
  }
}
