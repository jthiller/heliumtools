import { throwIfAborted, withTimeout } from "./abort.js";
import { parseJson, throwIfApiError } from "./api.js";

export const API_BASE = import.meta.env?.DEV
  ? "/api/council-emissions"
  : "https://api.heliumtools.org/council-emissions";

// Every endpoint serves a KV document the worker's cron rebuilds; a 202
// `{ warming: true }` means the history is still being built.
async function get(path, params, { signal } = {}) {
  throwIfAborted(signal);
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}${path}${query ? `?${query}` : ""}`, { signal: withTimeout(signal, 20_000) });
  const data = await parseJson(res);
  throwIfApiError(res, data);
  return data;
}

/** Totals, per-seat rollups and the emissions timeline lanes. */
export function fetchCouncilSummary(options) {
  return get("/summary", {}, options);
}

/** One seat: every emission with where it went, every outflow, other inflows. */
export function fetchCouncilSeat(wallet, options) {
  return get("/seat", { wallet }, options);
}

/** Distribution runs, council mints and failed distribution attempts. */
export function fetchCouncilRuns(options) {
  return get("/runs", {}, options);
}

/** The address labels the trace uses (committed registry + wallet identity). */
export function fetchCouncilLabels(options) {
  return get("/labels", {}, options);
}
