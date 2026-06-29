import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleStatus } from "./handlers/status.js";
import { handleBuildUpdate } from "./handlers/build.js";

/**
 * Update Hotspot Location — prefix `/update-location`.
 *
 * Wallet-driven re-assert of an already-onboarded IoT Hotspot's location /
 * elevation / antenna gain via the Helium Entity Manager `update_iot_info_v0`
 * instruction. The worker reads on-chain state and builds the unsigned txn; the
 * connected browser wallet (the Hotspot owner) signs and pays.
 *
 * Contrast with `iot-onboard` (initial onboard, proxied to onboarding.dewi.org)
 * and `multi-gateway` (issue + onboard, built locally). This tool builds the
 * update txn locally too, reusing the shared helium-solana lib.
 */
export async function handleUpdateLocationRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (pathname === "/status") return handleStatus(request, env);
  if (pathname === "/build") return handleBuildUpdate(request, env);

  return jsonResponse({ error: "Not found" }, 404);
}
