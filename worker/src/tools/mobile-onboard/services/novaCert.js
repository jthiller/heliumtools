/**
 * Shared client for the Nova certificate service, used by both the passthrough
 * `/cert` proxy and the agent-brief generator.
 *
 * The service validates the wallet's ed25519 signature over `location_data`
 * against the Hotspot, so **a 2xx from Nova is our ownership proof** — it is
 * what lets `/agent-brief` write to D1 without the worker implementing any
 * signature verification of its own.
 *
 * PRIVACY: responses carry the RadSec private key. Never log bodies here.
 */
import { CERT_API_BASE, CERT_API_PATH } from "../config.js";

// The signed LocationData payload is a small JSON blob (address + NAS IDs +
// two pubkeys + timestamp); 4 KB of base64 is generous headroom.
export const MAX_LOCATION_DATA_LEN = 4096;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

/** Returns an error string, or null when the signed payload looks well-formed. */
export function validateSignedPayload({ location_data, signature }) {
  if (typeof location_data !== "string" || !location_data ||
      location_data.length > MAX_LOCATION_DATA_LEN || !BASE64_RE.test(location_data)) {
    return "Invalid location_data — expected base64";
  }
  if (typeof signature !== "string" || !signature ||
      signature.length > 256 || !BASE64_RE.test(signature)) {
    return "Invalid signature — expected base64";
  }
  return null;
}

/**
 * Decode the base64 LocationData JSON without verifying it (Nova does that).
 * Used to read `blockchain_pubkey` and `timestamp`. Returns null if unparseable.
 */
export function parseLocationData(locationDataB64) {
  try {
    const json = atob(locationDataB64);
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Replay guard for artifact creation: a captured {location_data, signature}
 * pair is valid forever as far as Nova is concerned, so anyone who observed one
 * could keep minting stored artifacts. Bounding the signature's age closes
 * that. Deliberately NOT applied to the plain `/cert` passthrough, which mints
 * nothing on our side.
 */
export function isTimestampFresh(timestamp, maxAgeSeconds = 600) {
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) return false;
  const ageMs = Date.now() - ts;
  // The timestamp comes from the browser's clock, so the future-side tolerance
  // has to absorb real client skew (minutes fast is common) or an operator with
  // a fast clock can never generate a link at all — an unrecoverable dead end,
  // since re-signing just produces another future timestamp.
  return ageMs <= maxAgeSeconds * 1000 && ageMs >= -15 * 60_000;
}

/**
 * POST the signed payload to Nova.
 * @returns {{ ok: boolean, status: number, data: object|null, error: string|null }}
 */
export async function requestNovaCert({ location_data, signature, dry_run }) {
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
      // The service returns an empty body on a bare 4xx (krakend gateway), so
      // supply the dominant cause as a hint. Map upstream 5xx to 502 so our own
      // 500s stay distinguishable.
      const status = upstream.status >= 500 ? 502 : upstream.status;
      const fallback = upstream.status < 500
        ? `Certificate service rejected the request (${upstream.status}). Check that the connected wallet owns this Hotspot and that it is onboarded.`
        : `Certificate service error (${upstream.status})`;
      return { ok: false, status, data: null, error: data?.message || fallback };
    }

    return { ok: true, status: 200, data: data ?? {}, error: null };
  } catch (err) {
    // Timeout / network failure only — never echo payload contents.
    console.error("mobile-onboard nova cert error:", err.name);
    return { ok: false, status: 502, data: null, error: "Certificate service unreachable" };
  }
}

/** True when a non-dry-run response actually carries the three PEM values. */
export function hasCertMaterial(data) {
  return (
    typeof data?.radsec_private_key === "string" &&
    typeof data?.radsec_certificate === "string" &&
    typeof data?.radsec_ca_chain === "string"
  );
}
