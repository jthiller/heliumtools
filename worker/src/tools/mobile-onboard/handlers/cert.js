import { jsonResponse } from "../../../lib/response.js";
import {
  validateSignedPayload,
  requestNovaCert,
  hasCertMaterial,
} from "../services/novaCert.js";

/**
 * POST /cert
 * Body: { location_data, signature, dry_run? }
 *   location_data: base64 of the LocationData JSON built and signed client-side
 *   signature:     base64 of the wallet's ed25519 signature over the
 *                  location_data string bytes
 *   dry_run:       optional — validate without creating a certificate
 *
 * Pure pass-through to the Nova certificate service (it sends no CORS headers,
 * so the browser cannot reach it directly). The worker adds nothing and stores
 * nothing on this path.
 *
 * PRIVACY: the response carries the network's RadSec PRIVATE KEY. Never log
 * request or response bodies here, and never persist them.
 *
 * NOTE: `/agent-brief` is the one path that *does* store cert material (in D1,
 * single-use, short-lived) so an agent can fetch it. That is a deliberate,
 * scoped exception — see handlers/agentBrief.js and the tool's CLAUDE.md. This
 * handler's own no-persistence guarantee is unchanged.
 */
export async function handleCert(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { location_data, signature, dry_run } = body;
  const invalid = validateSignedPayload({ location_data, signature });
  if (invalid) return jsonResponse({ error: invalid }, 400);

  const result = await requestNovaCert({ location_data, signature, dry_run });
  if (!result.ok) return jsonResponse({ error: result.error }, result.status);

  // Guard the success shape: an upstream 2xx with an empty or non-JSON body
  // must not reach the client as 200 {} — the frontend would offer downloads of
  // the string "undefined". dry_run responses are exempt (they validate without
  // minting certificates).
  if (!dry_run && !hasCertMaterial(result.data)) {
    return jsonResponse({ error: "Unexpected certificate service response" }, 502);
  }

  return jsonResponse(result.data);
}
