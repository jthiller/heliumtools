import { jsonResponse } from "../../../lib/response.js";
import { COUNCIL_CHANNEL_ID } from "../config.js";
import { getLiveMessages } from "../services/store.js";
import { assembleNominations } from "../services/assemble.js";
import { loadReviewMap, statusOf } from "../services/review.js";

/**
 * GET /council/review — admin view of every nomination with its review status, so the
 * local Claude review can see what's pending and judge it. Returns the fields a
 * reviewer needs (name, handle, full body, link, tallies) plus status + reason.
 * Not cached (admin, low traffic). Same token gate as the other admin endpoints.
 */
export async function handleReview(request, env) {
  const token = env.COUNCIL_INGEST_TOKEN || env.ADMIN_TOKEN;
  if (!token) return jsonResponse({ error: "Service unavailable" }, 503);
  if (request.headers.get("Authorization") !== `Bearer ${token}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { ok, map } = await loadReviewMap(env);
  if (!ok) return jsonResponse({ error: "Review store unavailable" }, 503);

  const rows = await getLiveMessages(env, COUNCIL_CHANNEL_ID);
  const { nominations } = assembleNominations(rows);

  const items = nominations.map((n) => ({
    id: n.id,
    status: statusOf(map, n.id),
    reason: map[n.id]?.reason ?? null,
    name: n.candidateName || n.authorDisplayName || "",
    handle: n.authorUsername || null,
    postedAt: n.postedAt,
    link: n.link,
    reactionCount: n.reactions.reduce((sum, r) => sum + (r.count || 0), 0),
    endorsementCount: n.endorsements.length,
    body: n.body || n.content || "",
  }));

  const counts = { approved: 0, rejected: 0, pending: 0 };
  for (const it of items) counts[it.status]++;

  return jsonResponse({ generatedAt: Date.now(), counts, items });
}
