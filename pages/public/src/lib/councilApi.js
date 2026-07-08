import { parseJson, throwIfApiError } from "./api.js";

export const API_BASE = import.meta.env.DEV
  ? "/api/council"
  : "https://api.heliumtools.org/council";

/** Assembled nominations tree (nominations + endorsements) served from KV cache. */
export async function fetchNominations() {
  const res = await fetch(`${API_BASE}/nominations`);
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}
