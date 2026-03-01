import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../hotspot-claimer/services/rateLimit.js";
import { MAX_RESOLVE_PER_MINUTE, MAX_ENTITY_KEYS_PER_REQUEST } from "../config.js";
import { resolveLocations } from "../services/location.js";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function isValidEntityKey(key) {
  if (!key || typeof key !== "string") return false;
  if (key.length < 20 || key.length > 500) return false;
  return BASE58_RE.test(key);
}

/**
 * POST /resolve
 * Body: { entityKeys: string[] }
 * Returns: { hotspots: [...], errors: [...] }
 */
export async function handleResolve(request, env) {
  // Rate limit
  const rateLimitError = await checkIpRateLimit(env, request, {
    prefix: "rl:hm:resolve",
    maxRequests: MAX_RESOLVE_PER_MINUTE,
    windowSeconds: 60,
  });
  if (rateLimitError) return rateLimitError;

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { entityKeys } = body;
  if (!Array.isArray(entityKeys) || entityKeys.length === 0) {
    return jsonResponse({ error: "entityKeys must be a non-empty array" }, 400);
  }
  if (entityKeys.length > MAX_ENTITY_KEYS_PER_REQUEST) {
    return jsonResponse(
      { error: `Maximum ${MAX_ENTITY_KEYS_PER_REQUEST} entity keys per request` },
      400
    );
  }

  // Validate each key
  const invalid = entityKeys.filter((k) => !isValidEntityKey(k));
  if (invalid.length > 0) {
    return jsonResponse(
      { error: `Invalid entity keys: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? "..." : ""}` },
      400
    );
  }

  // Deduplicate
  const uniqueKeys = [...new Set(entityKeys)];

  try {
    const result = await resolveLocations(env, uniqueKeys);

    console.log(
      JSON.stringify({
        event: "hotspot_map_resolve",
        count: uniqueKeys.length,
        found: result.hotspots.length,
        errors: result.errors.length,
      })
    );

    return jsonResponse(result);
  } catch (err) {
    console.error("resolve error:", err);
    return jsonResponse({ error: "Failed to resolve hotspot locations" }, 500);
  }
}
