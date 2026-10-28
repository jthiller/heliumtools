import { jsonResponse } from "../../../lib/response.js";
import { rebuild, runCouncilEmissionsIndex } from "../services/indexer.js";

// Operator-only routes, gated by the existing ADMIN_TOKEN secret. CORS doesn't
// allow the Authorization header, so these are curl-only by design.

function authorized(request, env) {
  const expected = `Bearer ${env.ADMIN_TOKEN || ""}`;
  const got = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** POST /admin/index: run one indexer pass now (same work as a cron tick). */
export async function handleAdminIndex(request, env) {
  if (!env.ADMIN_TOKEN) return jsonResponse({ error: "Admin routes are not configured" }, 503);
  if (!authorized(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
  try {
    return jsonResponse({ ok: true, result: await runCouncilEmissionsIndex(env) });
  } catch (err) {
    return jsonResponse({ error: `Index run failed: ${err.message}` }, 500);
  }
}

/** POST /admin/rebuild: replay every stored transaction with the current rules. No RPC. */
export async function handleAdminRebuild(request, env) {
  if (!env.ADMIN_TOKEN) return jsonResponse({ error: "Admin routes are not configured" }, 503);
  if (!authorized(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
  try {
    return jsonResponse({ ok: true, result: await rebuild(env) });
  } catch (err) {
    return jsonResponse({ error: `Rebuild failed: ${err.message}` }, 500);
  }
}
