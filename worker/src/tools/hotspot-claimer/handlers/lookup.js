import { jsonResponse } from "../../../lib/response.js";
import { resolveEntityKey } from "../services/entity.js";
import { checkIpRateLimit } from "../services/rateLimit.js";
import { MAX_LOOKUPS_PER_MINUTE } from "../config.js";
import { isValidEntityKey } from "../utils.js";

/**
 * GET /lookup?entityKey=<base58-encoded-entity-key>
 *
 * Resolves a hotspot entity key to metadata including owner, name, network type, etc.
 */
export async function handleLookup(url, env, request) {
  // Rate limit check
  const rateLimitError = await checkIpRateLimit(env, request, {
    prefix: "rl:lookup",
    maxRequests: MAX_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (rateLimitError) return rateLimitError;

  const entityKey = url.searchParams.get("entityKey");

  if (!isValidEntityKey(entityKey)) {
    return jsonResponse(
      { error: "Invalid entity key. Must be a base58-encoded hotspot key." },
      400
    );
  }

  try {
    const result = await resolveEntityKey(env, entityKey);

    if (!result) {
      return jsonResponse(
        { error: "Hotspot not found for the given entity key." },
        404
      );
    }

    return jsonResponse(result);
  } catch (err) {
    console.error("Lookup error:", err.message, err.stack);
    return jsonResponse({ error: "Failed to resolve hotspot." }, 500);
  }
}
