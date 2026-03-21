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
