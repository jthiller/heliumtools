import { parseJson } from "./api.js";

const API_BASE = import.meta.env.DEV
  ? "/api/dc-mint"
  : "https://api.heliumtools.org/dc-mint";

const DC_PURCHASE_API = import.meta.env.DEV
  ? "/api/dc-purchase"
  : "https://api.heliumtools.org/dc-purchase";

export async function buildMintTransaction({ owner, hnt_amount, dc_amount, recipient }) {
  const res = await fetch(`${API_BASE}/build-mint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, hnt_amount, dc_amount, recipient }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  return data;
}

export async function buildDelegateTransaction({ owner, amount, oui, payer_key, subnet, hnt_amount }) {
  const res = await fetch(`${API_BASE}/build-delegate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, amount, oui, payer_key, subnet, hnt_amount }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  return data;
}

export async function fetchHntPrice() {
  const res = await fetch(`${API_BASE}/price`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to fetch price");
  return data;
}

export async function resolveOui(oui) {
  const res = await fetch(`${DC_PURCHASE_API}/oui/${oui}`);
  const data = await parseJson(res);
  if (!res.ok) return null;
  return data;
}

export async function resolvePayerKey(payerKey) {
  const res = await fetch(`${API_BASE}/resolve-payer/${encodeURIComponent(payerKey)}`);
  const data = await parseJson(res);
  if (!res.ok) return null;
  return data;
}
