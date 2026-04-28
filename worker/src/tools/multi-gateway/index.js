import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { getOuiCache } from "./oui-cache.js";
import { handleBatchOnchainStatus } from "./handlers/onchain.js";
import { handleIssueAndOnboard, handleOnboard } from "./handlers/issue.js";
import { REGIONS } from "./regions.js";
import { getHost } from "./lib/host.js";

async function fetchUpstream(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, data: { error: "Upstream returned non-JSON response" } };
  }
}

export async function handleMultiGatewayRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const apiKey = env.MULTI_GATEWAY_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "Multi-gateway API is not configured" }, 500);
  }

  const host = getHost(env);
  const headers = { "X-API-Key": apiKey };

  if (pathname === "/gateways" && request.method === "GET") {
    const results = await Promise.allSettled(
      REGIONS.map(({ port }) =>
        fetchUpstream(`http://${host}:${port}/gateways`, headers),
      ),
    );

    let gateways = [];
    let total = 0;
    let connected = 0;

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.ok) {
        const v = result.value.data;
        gateways = gateways.concat(v.gateways || []);
        total += v.total || 0;
        connected += v.connected || 0;
      }
    }

    return jsonResponse({ gateways, total, connected });
  }

  const packetsMatch = pathname.match(
    /^\/gateways\/([A-Fa-f0-9]{16})\/packets$/,
  );
  if (packetsMatch && request.method === "GET") {
    const mac = packetsMatch[1];
    const results = await Promise.allSettled(
      REGIONS.map(({ port }) =>
        fetchUpstream(`http://${host}:${port}/gateways/${mac}/packets`, headers),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.ok) {
        return jsonResponse(result.value.data);
      }
    }
    return jsonResponse({ error: "Gateway not found" }, 404);
  }

  // /events — WebSocket fan-out via the MultiGatewayHub Durable Object.
  //
  // Why: the Rust LNS caps each region at MAX_SSE_CONNECTIONS=20. Per-client
  // SSE proxying means each browser tab consumes 6 upstream slots, so the
  // cap fills with a handful of dashboards open. The DO holds at most one
  // upstream SSE per region globally and broadcasts to every connected
  // client. See worker/src/tools/multi-gateway/hub.js.
  if (pathname === "/events" && request.method === "GET") {
    if (!env.MULTI_GATEWAY_HUB) {
      return jsonResponse({ error: "Hub binding missing" }, 500);
    }
    const id = env.MULTI_GATEWAY_HUB.idFromName("hub");
    const stub = env.MULTI_GATEWAY_HUB.get(id);
    // Forward to the DO's /ws path with the original Upgrade headers intact.
    // Construct a fresh Request so the URL is rewritten while headers
    // (including `Upgrade: websocket` and `Sec-WebSocket-Key`) carry over.
    const target = new URL(request.url);
    target.pathname = "/ws";
    const forwarded = new Request(target.toString(), request);
    return stub.fetch(forwarded);
  }

  // On-chain status check (batch)
  if (pathname === "/onchain" && request.method === "POST") {
    return handleBatchOnchainStatus(request, env);
  }

  // Issue data-only entity (Solana transaction)
  const issueMatch = pathname.match(/^\/gateways\/([A-Fa-f0-9]{16})\/issue$/);
  if (issueMatch && request.method === "POST") {
    return handleIssueAndOnboard(issueMatch[1], request, env);
  }

  // Onboard on IoT network + optional location assertion
  const onboardMatch = pathname.match(/^\/gateways\/([A-Fa-f0-9]{16})\/onboard$/);
  if (onboardMatch && request.method === "POST") {
    return handleOnboard(onboardMatch[1], request, env);
  }

  if (pathname === "/ouis" && request.method === "GET") {
    const data = await getOuiCache(env);
    return jsonResponse(data);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
