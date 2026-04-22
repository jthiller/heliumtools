import { parseJson } from "./api.js";

export const API_BASE = import.meta.env.DEV
  ? "/api/ve-hnt"
  : "https://api.heliumtools.org/ve-hnt";

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

export async function fetchPositions(wallet) {
  const query = new URLSearchParams({ wallet });
  const res = await fetch(`${API_BASE}/positions?${query.toString()}`);
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}

export async function buildClaimTransactions({ wallet, positionMint }) {
  const res = await fetch(`${API_BASE}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, positionMint }),
  });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data;
}
