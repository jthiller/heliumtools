import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import {
  COUNCIL_CHANNEL_ID,
  RATE_LIMIT,
  NOMINATIONS_CACHE_KEY,
  NOMINATIONS_CACHE_TTL,
  META_KEY,
} from "../config.js";
import { getLiveMessages } from "../services/store.js";
import { assembleNominations } from "../services/assemble.js";
import { loadReviewMap, statusOf } from "../services/review.js";

/**
 * GET /council/nominations — public nominations tree, gated to review-approved items.
 * Cache-first (KV, NOMINATIONS_CACHE_TTL) BEFORE the rate limiter, so a cached
 * response never spends a token (the limiter only protects the D1 read + assembly;
 * wallet-dashboard summary.js pattern). Empty DB → 200 with `nominations: []`.
 * Only "approved" nominations are served; pending/rejected are held (see services/review.js).
 */
export async function handleNominations(request, env) {
  const cached = await kvGetJson(env, NOMINATIONS_CACHE_KEY);
  if (cached) return jsonResponse(cached);

  const limited = await checkIpRateLimit(env, request, RATE_LIMIT);
  if (limited) return limited;

  // `scrapedAt` (page-freshness) comes from the last ingest's meta, not the rows.
  const meta = await kvGetJson(env, META_KEY);
  const rows = await getLiveMessages(env, COUNCIL_CHANNEL_ID);
  const { nominations, unattachedSupports } = assembleNominations(rows);

  // Gate: only review-approved nominations are public (services/review.js).
  const { ok, map } = await loadReviewMap(env);
  if (!ok) {
    // Fail closed: can't read the review store, so serve nothing and DON'T cache — the
    // next request retries and self-heals once KV recovers. Never leak unreviewed items.
    return jsonResponse({
      generatedAt: Date.now(),
      scrapedAt: meta?.scrapedAt ?? null,
      nominations: [],
      unattachedSupports,
      heldForReview: nominations.length,
      degraded: true,
    });
  }
  const approved = nominations.filter((n) => statusOf(map, n.id) === "approved");

  const result = {
    generatedAt: Date.now(),
    scrapedAt: meta?.scrapedAt ?? null,
    nominations: approved,
    unattachedSupports,
    heldForReview: nominations.length - approved.length,
  };

  await kvPutJson(env, NOMINATIONS_CACHE_KEY, result, NOMINATIONS_CACHE_TTL);
  return jsonResponse(result);
}
