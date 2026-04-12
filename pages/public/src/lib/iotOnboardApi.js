import { parseJson } from "./api.js";

const API_BASE = import.meta.env.DEV
  ? "/api/iot-onboard"
  : "https://api.heliumtools.org/iot-onboard";

export async function lookupHotspot(onboardingKey, gatewayPubkey) {
  const res = await fetch(`${API_BASE}/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboarding_key: onboardingKey, gateway_pubkey: gatewayPubkey }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || "Lookup failed");
  return data;
}

export async function requestIssue(owner, gatewayPubkey, addGatewayTxn) {
  const res = await fetch(`${API_BASE}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner,
      gateway_pubkey: gatewayPubkey,
      add_gateway_txn: addGatewayTxn,
    }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  return data;
}

export async function requestOnboard(owner, gatewayPubkey, { location, elevation, gain, mode }) {
  const res = await fetch(`${API_BASE}/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, gateway_pubkey: gatewayPubkey, location, elevation, gain, mode }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  return data;
}
