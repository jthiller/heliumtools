/**
 * Build + sign a certificate request for the RadSec certificate service —
 * the browser equivalent of `helium-wallet hotspots add mobile cert`.
 *
 * The service verifies an ed25519 signature by the OWNER WALLET over the
 * base64-encoded LocationData JSON (signed as the base64 string's bytes, not
 * the raw JSON). wallet-adapter signMessage provides exactly that; hardware
 * wallets (Ledger) don't support signMessage — callers must feature-detect.
 */
import { bytesToBase64 } from "./gatewayToken.js";

// btoa() throws on non-Latin-1 (street addresses like "Zürich"), so encode
// the JSON through UTF-8 bytes. Byte-identical to btoa() for ASCII input.
function utf8ToBase64(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

/**
 * @param {Function} signMessage  wallet-adapter signMessage (must exist)
 * @param {string}   wallet      owner wallet, Solana base58
 * @param {string}   gateway     Hotspot key, Helium b58
 * @param {{ locationAddress?: string, nasIds?: string[] }} [info]
 *   Provide on first-time cert creation; omit to fetch existing certificates.
 * @returns {{ location_data: string, signature: string }} the /cert payload
 */
export async function signCertRequest(signMessage, wallet, gateway, info = {}) {
  const locationData = {
    ...(info.locationAddress && info.nasIds?.length
      ? { location_address: info.locationAddress, nas_ids: info.nasIds }
      : {}),
    wallet,
    blockchain_pubkey: gateway,
    timestamp: new Date().toISOString(),
  };

  const locationDataB64 = utf8ToBase64(JSON.stringify(locationData));
  const signatureBytes = await signMessage(new TextEncoder().encode(locationDataB64));
  return {
    location_data: locationDataB64,
    signature: bytesToBase64(signatureBytes),
  };
}
