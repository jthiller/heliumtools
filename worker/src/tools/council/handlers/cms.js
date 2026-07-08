import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import {
  COUNCIL_CHANNEL_ID,
  RATE_LIMIT,
  CMS_CACHE_KEY,
  NOMINATIONS_CACHE_TTL,
  META_KEY,
} from "../config.js";
import { getLiveMessages } from "../services/store.js";
import { assembleNominations } from "../services/assemble.js";
import { loadReviewMap, statusOf } from "../services/review.js";

// URL-friendly identifier; prefer the (unique) Discord handle, else the name, else id.
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// "🫡 13 · ✅ 5 · 🙏 3" — top reactions by count.
function reactionsSummary(reactions) {
  return [...reactions]
    .sort((a, b) => b.count - a.count)
    .map((r) => `${r.emoji} ${r.count}`)
    .join(" · ");
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * GET /council/cms — a flat, presentation-ready array shaped for an external CMS
 * (Framer) to sync from. Same public data as /nominations, reshaped: the lifted
 * candidate name, the preface-stripped markdown body, ISO dates, a reaction summary,
 * and endorsement counts. Cache-first before the rate limiter (like /nominations).
 */
export async function handleCms(request, env) {
  const cached = await kvGetJson(env, CMS_CACHE_KEY);
  if (cached) return jsonResponse(cached);

  const limited = await checkIpRateLimit(env, request, RATE_LIMIT);
  if (limited) return limited;

  const meta = await kvGetJson(env, META_KEY);
  const rows = await getLiveMessages(env, COUNCIL_CHANNEL_ID);
  const { nominations } = assembleNominations(rows);

  // Same review gate as /nominations: the marketing feed only carries approved items.
  // Fail closed on a review-store read error — serve an empty feed and don't cache, so
  // the Framer sync (update-only) simply makes no change rather than seeing held items.
  const { ok, map } = await loadReviewMap(env);
  if (!ok) {
    return jsonResponse({ generatedAt: Date.now(), scrapedAt: meta?.scrapedAt ?? null, count: 0, items: [], degraded: true });
  }
  const approved = nominations.filter((n) => statusOf(map, n.id) === "approved");

  const items = approved.map((n) => ({
    id: n.id,
    slug: slugify(n.authorUsername || n.candidateName || n.id),
    name: n.candidateName || n.authorDisplayName || "",
    handle: n.authorUsername || null,
    avatarUrl: n.avatarUrl || null,
    body: n.body || "", // markdown (preface stripped, mentions resolved)
    postedAt: iso(n.postedAt),
    editedAt: iso(n.editedAt),
    discordLink: n.link,
    reactionCount: n.reactions.reduce((sum, r) => sum + (r.count || 0), 0),
    reactions: reactionsSummary(n.reactions),
    endorsementCount: n.endorsements.length,
    endorsers: n.endorsements.map((e) => e.authorDisplayName).filter(Boolean).join(", "),
  }));

  const result = { generatedAt: Date.now(), scrapedAt: meta?.scrapedAt ?? null, count: items.length, items };
  await kvPutJson(env, CMS_CACHE_KEY, result, NOMINATIONS_CACHE_TTL);
  return jsonResponse(result);
}
