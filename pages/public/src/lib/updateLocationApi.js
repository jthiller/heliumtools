import { parseJson } from "./api.js";

const API_BASE = import.meta.env.DEV
  ? "/api/update-location"
  : "https://api.heliumtools.org/update-location";

/**
 * Read a Hotspot's current on-chain asserted location / elevation / gain plus
 * its device type and the current location-assert fees.
 * @param {string} gatewayPubkey Helium-format entity key
 */
export async function fetchHotspotStatus(gatewayPubkey) {
  const res = await fetch(`${API_BASE}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gateway_pubkey: gatewayPubkey }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  return data;
}

/**
 * Build the unsigned update_iot_info_v0 transaction. Only pass the fields that
 * changed — omitted/null fields are left unchanged on-chain.
 * @returns {{ transaction: string } | { dc_needed: true, required_dc, current_dc, device_type }}
 */
export async function buildUpdate(owner, gatewayPubkey, { location, elevation, gain }) {
  const res = await fetch(`${API_BASE}/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, gateway_pubkey: gatewayPubkey, location, elevation, gain }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  return data;
}
