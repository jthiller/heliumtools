import { jsonResponse } from "../../../lib/response.js";
import { kvGetJson, withKvLock } from "../../../lib/kv.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import { KV, LOCK_TTL_SECONDS, RATE_LIMIT } from "../config.js";
import { isValidWalletAddress } from "../../hotspot-claimer/utils.js";
import { rebuild } from "../services/indexer.js";

// Every view is a KV document the cron rewrites; a hit never touches the RPC
// and is served before the rate limiter. A miss (first deploy, or KV loss)
// rebuilds the views from D1 in the background, still with no RPC call.

const CACHE_HEADERS = { "Cache-Control": "public, max-age=60" };

function withCache(response) {
  for (const [k, v] of Object.entries(CACHE_HEADERS)) response.headers.set(k, v);
  return response;
}

async function warming(env, request, ctx) {
  const limited = await checkIpRateLimit(env, request, RATE_LIMIT);
  if (limited) return limited;
  if (env.DB && ctx?.waitUntil) {
    // Shares the indexer's lock: one rebuild at a time, and none mid-run.
    ctx.waitUntil(
      withKvLock(env, KV.lock, LOCK_TTL_SECONDS, () => rebuild(env))
        .catch((err) => console.error("council-emissions: cold rebuild failed:", err.message)),
    );
  }
  return jsonResponse({ warming: true, message: "The council emission history is being built. Try again shortly." }, 202);
}

export async function handleSummary(env, request, ctx) {
  const summary = await kvGetJson(env, KV.summary);
  if (summary) return withCache(jsonResponse(summary));
  return warming(env, request, ctx);
}

export async function handleSeat(url, env, request, ctx) {
  const wallet = url.searchParams.get("wallet");
  if (!isValidWalletAddress(wallet)) return jsonResponse({ error: "Invalid wallet address" }, 400);
  const detail = await kvGetJson(env, KV.seat(wallet));
  if (detail) return withCache(jsonResponse(detail));
  const summary = await kvGetJson(env, KV.summary);
  if (summary) return jsonResponse({ error: "Not a council seat wallet" }, 404);
  return warming(env, request, ctx);
}

export async function handleRuns(env, request, ctx) {
  const runs = await kvGetJson(env, KV.runs);
  if (runs) return withCache(jsonResponse(runs));
  return warming(env, request, ctx);
}

export async function handleLabels(env, request, ctx) {
  const labels = await kvGetJson(env, KV.labels);
  if (labels) return withCache(jsonResponse(labels));
  return warming(env, request, ctx);
}
