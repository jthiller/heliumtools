// Review/moderation gate. Nothing reaches the public surfaces (/nominations, /cms)
// until it has been reviewed "approved"; anything not explicitly approved is held.
// State lives in KV (REVIEW_KEY) and is set only by the admin /moderate endpoint — the
// hourly Discord poll never touches it, so decisions are durable across re-polls.
//
// FAIL CLOSED: reads return `{ ok, map }`. `ok:false` means the store could not be
// read (KV error or no binding); callers MUST then serve nothing and MUST NOT persist,
// so a transient KV blip can never (a) wipe real decisions or (b) leak held items by
// re-approving. `ok:true` with an empty map means the store is genuinely uninitialized
// (everything pending until seeded via /moderate). There is deliberately NO
// auto-grandfather: approval only ever comes from an explicit /moderate call.

import { REVIEW_KEY } from "../config.js";

export async function loadReviewMap(env) {
  if (!env.KV) return { ok: false, map: {} };
  try {
    const map = await env.KV.get(REVIEW_KEY, "json");
    return { ok: true, map: map || {} };
  } catch {
    return { ok: false, map: {} };
  }
}

// Persist the map with NO TTL. Throws on failure so /moderate reports 502 rather than
// falsely claiming success.
export async function saveReviewMap(env, map) {
  if (!env.KV) throw new Error("KV unavailable");
  await env.KV.put(REVIEW_KEY, JSON.stringify(map));
}

// "approved" | "rejected" | "pending" (default for ids not in the map).
export function statusOf(map, id) {
  return map?.[id]?.status || "pending";
}
