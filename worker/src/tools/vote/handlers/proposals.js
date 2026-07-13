import { jsonResponse } from "../../../lib/response.js";
import { listCatalog } from "../services/catalog.js";

/**
 * GET /vote/proposals
 * The vote index: every proposal this page has tracked (current and past), as
 * compact catalog rows (name, status, dates, tallies, choice summary) from D1 —
 * durable long after snapshots expire and markers close. Live votes sort first.
 */
export async function handleProposals(env) {
  try {
    return jsonResponse(await listCatalog(env));
  } catch (err) {
    console.error("vote proposals error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load proposals." }, 500);
  }
}
