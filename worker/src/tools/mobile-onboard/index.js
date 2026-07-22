import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { getMobileOnboardFees } from "./services/fees.js";
import { handleStatus } from "./handlers/status.js";
import { handleIssue } from "./handlers/issue.js";
import { handleOnboard } from "./handlers/onboard.js";
import { handleUpdate } from "./handlers/update.js";
import { handleCert } from "./handlers/cert.js";

/**
 * Mobile WiFi Onboarding — prefix `/mobile-onboard`.
 *
 * Onboards self-serve converted WiFi networks as Mobile data-only Hotspots,
 * replicating the `helium-wallet hotspots add mobile {token|onboard|cert}`
 * CLI flow: the browser generates the gateway token, the worker builds the
 * issue (ECC-verified) + onboard transactions locally via the shared
 * helium-solana lib, and /cert proxies the RadSec certificate service. Also
 * serves the Manage surface: /update re-asserts location on an onboarded
 * network, /cert re-serves its certificates.
 *
 * Contrast with `iot-onboard` (dewi-proxied txns) and `multi-gateway`
 * (locally-built IoT txns) — this tool builds Mobile txns locally.
 */
export async function handleMobileOnboardRequest(request, env) {
  const { pathname } = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/fees") {
    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
    return jsonResponse(await getMobileOnboardFees(env));
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (pathname === "/status") return handleStatus(request, env);
  if (pathname === "/issue") return handleIssue(request, env);
  if (pathname === "/onboard") return handleOnboard(request, env);
  if (pathname === "/update") return handleUpdate(request, env);
  if (pathname === "/cert") return handleCert(request, env);

  return jsonResponse({ error: "Not found" }, 404);
}

// Cron entry — re-exported through worker/src/index.js scheduled().
export { refreshMobileOnboardFees } from "./services/fees.js";
