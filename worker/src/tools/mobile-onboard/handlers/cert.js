import { jsonResponse } from "../../../lib/response.js";
import { CERT_API_BASE, CERT_API_PATH } from "../config.js";

// The signed LocationData payload is a small JSON blob (address + NAS IDs +
// two pubkeys + timestamp); 4 KB of base64 is generous headroom.
const MAX_LOCATION_DATA_LEN = 4096;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

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
 * nothing.
 *
 * PRIVACY: the response carries the network's RadSec PRIVATE KEY. Never log
 * request or response bodies here, and never persist them to KV/D1.
 */
export async function handleCert(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { location_data, signature, dry_run } = body;
  if (typeof location_data !== "string" || !location_data ||
      location_data.length > MAX_LOCATION_DATA_LEN || !BASE64_RE.test(location_data)) {
    return jsonResponse({ error: "Invalid location_data — expected base64" }, 400);
  }
  if (typeof signature !== "string" || !signature ||
      signature.length > 256 || !BASE64_RE.test(signature)) {
    return jsonResponse({ error: "Invalid signature — expected base64" }, 400);
  }

  try {
    const upstream = await fetch(`${CERT_API_BASE}${CERT_API_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_data,
        signature,
        ...(dry_run ? { dry_run: true } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    let data = null;
    try {
      data = await upstream.json();
    } catch {}

    if (!upstream.ok) {
      // Surface the service's error message when present ({ message }); on a
      // bare 4xx the service returns an empty body, so give the dominant
      // causes as a hint. Map upstream 5xx to 502 so our own 500s stay
      // distinguishable.
      const status = upstream.status >= 500 ? 502 : upstream.status;
      const fallback = upstream.status < 500
        ? `Certificate service rejected the request (${upstream.status}). Check that the connected wallet owns this Hotspot and that it is onboarded.`
        : `Certificate service error (${upstream.status})`;
      return jsonResponse({ error: data?.message || fallback }, status);
    }

    // Guard the success shape: an upstream 2xx with an empty or non-JSON body
    // must not reach the client as 200 {} — the frontend would offer
    // downloads of the string "undefined". dry_run responses are exempt
    // (they validate without minting certificates).
    if (!dry_run && (
      typeof data?.radsec_private_key !== "string" ||
      typeof data?.radsec_certificate !== "string" ||
      typeof data?.radsec_ca_chain !== "string"
    )) {
      return jsonResponse({ error: "Unexpected certificate service response" }, 502);
    }

    return jsonResponse(data ?? {});
  } catch (err) {
    // Timeout / network failure only — never echo payload contents.
    console.error("mobile-onboard cert proxy error:", err.name);
    return jsonResponse({ error: "Certificate service unreachable" }, 502);
  }
}
