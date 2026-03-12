import { parseJson } from "./api.js";

export const API_BASE = import.meta.env.DEV
  ? "/api/hotspot-claimer"
  : "https://api.heliumtools.org/hotspot-claimer";

/**
 * Custom error class that preserves rate limit metadata from 429 responses.
 */
export class ApiError extends Error {
  constructor(message, { status, rateLimited, retryAfterSeconds } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.rateLimited = rateLimited || false;
    this.retryAfterSeconds = retryAfterSeconds || 0;
  }
}

function throwIfError(res, data) {
  if (res.ok) return;
  if (res.status === 429 || data?.rateLimited) {
    throw new ApiError(data?.error || "Too many requests", {
      status: 429,
      rateLimited: true,
      retryAfterSeconds: data?.retryAfterSeconds || 60,
    });
  }
  throw new ApiError(data?.error || `Request failed (${res.status})`, {
    status: res.status,
  });
}

export async function lookupHotspot(entityKey) {
  const query = new URLSearchParams({ entityKey });
  const res = await fetch(`${API_BASE}/lookup?${query.toString()}`);
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}

export async function fetchRewards(entityKey) {
  const query = new URLSearchParams({ entityKey });
  const res = await fetch(`${API_BASE}/rewards?${query.toString()}`);
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}

export async function claimRewards(entityKey) {
  const res = await fetch(`${API_BASE}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityKey }),
  });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}

export async function fetchWalletHotspots(address) {
  const query = new URLSearchParams({ address });
  const res = await fetch(`${API_BASE}/wallet?${query.toString()}`);
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}
