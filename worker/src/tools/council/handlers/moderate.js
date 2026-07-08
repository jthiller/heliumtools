import { jsonResponse } from "../../../lib/response.js";
import {
  COUNCIL_CHANNEL_ID,
  NOMINATIONS_CACHE_KEY,
  CMS_CACHE_KEY,
} from "../config.js";
import { getLiveMessages } from "../services/store.js";
import { assembleNominations } from "../services/assemble.js";
import { loadReviewMap, saveReviewMap, statusOf } from "../services/review.js";

/**
 * POST /council/moderate — admin: set review decisions. Body:
 *   { approve?: ["<id>"], reject?: [{ id, reason }] | ["<id>"], reset?: ["<id>"] }
 * approve → published; reject → held (with reason); reset → back to pending.
 * Only ids that are currently live nominations are honored (others reported in
 * `ignored`). Persists to KV and invalidates the public caches. Same token gate as
 * the other admin endpoints.
 */
export async function handleModerate(request, env) {
  const token = env.COUNCIL_INGEST_TOKEN || env.ADMIN_TOKEN;
  if (!token) return jsonResponse({ error: "Service unavailable" }, 503);
  if (request.headers.get("Authorization") !== `Bearer ${token}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const approve = Array.isArray(body.approve) ? body.approve : [];
  const reject = Array.isArray(body.reject) ? body.reject : [];
  const reset = Array.isArray(body.reset) ? body.reset : [];

  // Read first; on a read error, refuse to modify (starting from an empty map and
  // saving would wipe existing decisions). Fail closed.
  const { ok, map } = await loadReviewMap(env);
  if (!ok) return jsonResponse({ error: "Review store unavailable; not modifying" }, 503);

  const rows = await getLiveMessages(env, COUNCIL_CHANNEL_ID);
  const { nominations } = assembleNominations(rows);
  const validIds = new Set(nominations.map((n) => n.id));

  const at = Date.now();
  const applied = { approved: [], rejected: [], reset: [], ignored: [] };

  for (const id of approve) {
    if (!validIds.has(id)) { applied.ignored.push(id); continue; }
    map[id] = { status: "approved", at };
    applied.approved.push(id);
  }
  for (const entry of reject) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (!id || !validIds.has(id)) { applied.ignored.push(id ?? null); continue; }
    const reason =
      typeof entry === "object" && entry.reason ? String(entry.reason).slice(0, 200) : "flagged";
    map[id] = { status: "rejected", reason, at };
    applied.rejected.push(id);
  }
  for (const id of reset) {
    if (map[id]) { delete map[id]; applied.reset.push(id); }
  }

  try {
    await saveReviewMap(env, map);
  } catch (err) {
    return jsonResponse({ error: "Failed to persist review state: " + String(err?.message || err) }, 502);
  }

  if (env.KV) {
    try {
      await env.KV.delete(NOMINATIONS_CACHE_KEY);
      await env.KV.delete(CMS_CACHE_KEY);
    } catch {
      // best-effort cache bust
    }
  }

  const counts = { approved: 0, rejected: 0, pending: 0 };
  for (const n of nominations) counts[statusOf(map, n.id)]++;

  return jsonResponse({ ok: true, applied, counts });
}
