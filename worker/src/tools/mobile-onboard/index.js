import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { getMobileOnboardFees } from "./services/fees.js";
import { handleStatus } from "./handlers/status.js";
import { handleIssue } from "./handlers/issue.js";
import { handleOnboard } from "./handlers/onboard.js";
import { handleUpdate } from "./handlers/update.js";
import { handleCert } from "./handlers/cert.js";
import { handleCreateAgentBrief, handleGetArtifact } from "./handlers/agentBrief.js";

// Capability-link routes: /agent-brief/<id> (markdown, re-readable) and
// /agent-certs/<id> (single-use bundle). Ids are 192-bit base64url.
// Deliberately permissive on the id: a malformed or truncated id must fall
// through to the same 410 as an expired one, not a different status that
// tells a prober their id was merely the wrong shape.
const ARTIFACT_ROUTE = /^\/agent-(brief|certs)\/(.*)$/;

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

  // Agent capability links are fetched by LLMs/agents, so they are plain GETs
  // returning markdown or JSON (never the tool's usual JSON envelope).
  const artifact = ARTIFACT_ROUTE.exec(pathname);
  if (artifact) {
    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
    const kind = artifact[1] === "certs" ? "certs" : "brief";
    return handleGetArtifact(request, env, artifact[2], kind);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (pathname === "/status") return handleStatus(request, env);
  if (pathname === "/issue") return handleIssue(request, env);
  if (pathname === "/onboard") return handleOnboard(request, env);
  if (pathname === "/update") return handleUpdate(request, env);
  if (pathname === "/cert") return handleCert(request, env);
  if (pathname === "/agent-brief") return handleCreateAgentBrief(request, env);

  return jsonResponse({ error: "Not found" }, 404);
}

// Cron entries — re-exported through worker/src/index.js scheduled().
export { refreshMobileOnboardFees } from "./services/fees.js";
export { purgeExpiredArtifacts } from "./services/artifacts.js";
