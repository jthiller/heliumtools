import { parseJson } from "./api.js";

const API_BASE = import.meta.env.DEV
  ? "/api/mobile-onboard"
  : "https://api.heliumtools.org/mobile-onboard";

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    const err = new Error(data?.error || `Server returned ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Current wifiDataOnly onboarding fees (DC). */
export async function fetchMobileFees() {
  const res = await fetch(`${API_BASE}/fees`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  return data;
}

/** On-chain issued/onboarded state for a gateway key. */
export function fetchGatewayStatus(gateway) {
  return post("/status", { gateway });
}

/**
 * Build the ECC-verified issue transaction.
 * @returns {{ already_issued: true } | { transaction: string }}
 */
export function requestIssue(owner, gateway, unsignedMsgHex, signatureHex) {
  return post("/issue", {
    owner,
    gateway,
    unsigned_msg: unsignedMsgHex,
    gateway_signature: signatureHex,
  });
}

/**
 * Build the onboard_data_only_mobile_hotspot_v0 transaction.
 * `location` is an H3 res-12 cell hex string.
 * @returns {{ already_onboarded: true } | { transaction } | { dc_needed, required_dc, current_dc } | throws with .data.not_indexed}
 */
export function requestOnboard(owner, gateway, location) {
  return post("/onboard", { owner, gateway, location });
}

/**
 * Build the update_mobile_info_v0 location re-assert transaction.
 * @returns {{ transaction } | { dc_needed, required_dc, current_dc }}
 */
export function requestUpdate(owner, gateway, location) {
  return post("/update", { owner, gateway, location });
}

/**
 * Proxy a signed certificate request to the RadSec certificate service.
 * @returns {{ location_address, nas_ids, radsec_private_key, radsec_certificate, radsec_ca_chain, radsec_cert_expire }}
 */
export function requestCert({ location_data, signature, dry_run }) {
  return post("/cert", { location_data, signature, ...(dry_run ? { dry_run: true } : {}) });
}
