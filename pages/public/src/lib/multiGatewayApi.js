import { parseJson } from "./api.js";

const API_BASE = import.meta.env.DEV
  ? "/api/multi-gateway"
  : "https://api.heliumtools.org/multi-gateway";

const SSE_URL = `${API_BASE}/events`;

export async function fetchGateways() {
  const res = await fetch(`${API_BASE}/gateways`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to fetch gateways");
  return data;
}

export async function fetchGatewayPackets(mac) {
  const res = await fetch(`${API_BASE}/gateways/${mac}/packets`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to fetch packets");
  return data;
}

export function createEventSource() {
  return new EventSource(SSE_URL);
}

export async function fetchOuis() {
  const res = await fetch(`${API_BASE}/ouis`);
  const data = await parseJson(res);
  if (!res.ok) return null;
  return data;
}

let geoPromise = null;
export function fetchGeo() {
  if (!geoPromise) {
    geoPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/geo`);
        if (!res.ok) return null;
        const data = await parseJson(res);
        if (data?.latitude == null || data?.longitude == null) return null;
        return { latitude: data.latitude, longitude: data.longitude };
      } catch {
        return null;
      }
    })();
  }
  return geoPromise;
}

export async function checkOnchainStatus(pubkeys) {
  const res = await fetch(`${API_BASE}/onchain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkeys }),
  });
  const data = await parseJson(res);
  if (!res.ok) return {};
  return data?.results || {};
}

export async function requestIssueTxns(mac, owner) {
  const res = await fetch(`${API_BASE}/gateways/${mac}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  if (!data) throw new Error("Empty response from server");
  return data;
}

export async function requestAddGatewayTxn(mac, owner, payer) {
  const res = await fetch(`${API_BASE}/gateways/${mac}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, payer: payer || owner }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  if (!data) throw new Error("Empty response from server");
  return data;
}

export async function requestOnboardTxn(mac, owner, { location, elevation, gain } = {}) {
  const res = await fetch(`${API_BASE}/gateways/${mac}/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, location, elevation, gain }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  if (!data) throw new Error("Empty response from server");
  return data;
}
