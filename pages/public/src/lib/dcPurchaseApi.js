export const DC_API_BASE = import.meta.env.DEV
  ? "/api/dc-purchase"
  : "https://api.heliumtools.org/dc-purchase";

async function parseJson(res) {
  const contentType = res.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  try {
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function resolveOui(oui) {
  const res = await fetch(`${DC_API_BASE}/oui/${oui}`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || "Unable to resolve OUI");
  return data;
}

export async function createDcOrder(payload) {
  const res = await fetch(`${DC_API_BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || "Unable to create order");
  return data;
}

export async function fetchOrder(orderId) {
  const res = await fetch(`${DC_API_BASE}/orders/${orderId}`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || "Unable to load order");
  return data;
}
