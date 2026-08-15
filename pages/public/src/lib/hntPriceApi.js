import { parseJson, throwIfApiError } from "./api.js";


/**
 * Same-origin in dev (the vite /api proxy forwards plain GETs and SSE alike),
 * the absolute API origin in prod. Used for anything this page fetches itself.
 */
export const API_BASE = import.meta.env.DEV
  ? "/api/hnt-price"
  : "https://api.heliumtools.org/hnt-price";

/**
 * The origin external consumers integrate against. Always absolute, never the
 * dev proxy: every snippet rendered on the page is meant to be copied straight
 * into somebody else's project.
 */
export const PUBLIC_API_BASE = "https://api.heliumtools.org/hnt-price";
export const PUBLIC_WS_BASE = "wss://api.heliumtools.org/hnt-price";

/** The stream the live ticker demo subscribes to. */
export const SSE_URL = `${API_BASE}/sse`;

/** Cached snapshot, stale-while-revalidate. Rate limited per IP; limits are documented in the worker README. */
export async function fetchCurrentPrice() {
  const res = await fetch(`${API_BASE}/current`);
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}

/** Live chain plus market read on every call. Rate limited per IP; limits are documented in the worker README. */
export async function fetchInstantPrice() {
  const res = await fetch(`${API_BASE}/instant`);
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}
