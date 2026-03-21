const API_BASE = import.meta.env.DEV
  ? "/api/multi-gateway"
  : "https://api.heliumtools.org/multi-gateway";

const SSE_URL = "http://hotspot.heliumtools.org:4468/events";

async function parseJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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
