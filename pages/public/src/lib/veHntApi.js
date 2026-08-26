import { ApiError, parseJson, throwIfApiError } from "./api.js";
import { dedupeAsync } from "./requestDedupe.js";

export { ApiError };

export const API_BASE = import.meta.env.DEV
  ? "/api/ve-hnt"
  : "https://api.heliumtools.org/ve-hnt";

// Deduped: the WebMCP tool fetches and drives the page input, whose
// debounced effect would otherwise re-run this heavy analysis moments later.
export const fetchPositions = dedupeAsync(async (wallet) => {
  const query = new URLSearchParams({ wallet });
  const res = await fetch(`${API_BASE}/positions?${query.toString()}`);
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
});

export async function fetchPositionEpochs(positionMint) {
  const query = new URLSearchParams({ positionMint });
  const res = await fetch(`${API_BASE}/position-epochs?${query.toString()}`);
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}

export async function buildClaimTransactions({ wallet, positionMint }) {
  const res = await fetch(`${API_BASE}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, positionMint }),
  });
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}
