import { jsonResponse } from "../../../lib/response.js";

/**
 * Get client IP from request headers.
 * CF-Connecting-IP in production, fallback for local dev.
 */
function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "127.0.0.1"
  );
}

/**
 * Check IP-based rate limit using KV.
 * Returns null if under limit, or a 429 Response if over limit.
 */
export async function checkIpRateLimit(
  env,
  request,
  { prefix, maxRequests, windowSeconds }
) {
  const ip = getClientIp(request);
  const key = `${prefix}:${ip}`;

  const current = parseInt((await env.KV.get(key)) || "0", 10);
  if (current >= maxRequests) {
    return jsonResponse(
      {
        error: "Too many requests. Please try again later.",
        rateLimited: true,
        retryAfterSeconds: windowSeconds,
      },
      429
    );
  }

  await env.KV.put(key, String(current + 1), {
    expirationTtl: windowSeconds,
  });

  return null;
}
