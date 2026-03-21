import { corsHeaders, jsonResponse } from "../../lib/response.js";

export async function handleMultiGatewayRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const apiBase = "http://hotspot.heliumtools.org:4468";
  const headers = { "X-API-Key": env.MULTI_GATEWAY_API_KEY };

  if (pathname === "/gateways" && request.method === "GET") {
    const res = await fetch(`${apiBase}/gateways`, { headers });
    const data = await res.json();
    return jsonResponse(data, res.status);
  }

  const packetsMatch = pathname.match(
    /^\/gateways\/([A-Fa-f0-9]{16})\/packets$/,
  );
  if (packetsMatch && request.method === "GET") {
    const mac = packetsMatch[1];
    const res = await fetch(`${apiBase}/gateways/${mac}/packets`, { headers });
    const data = await res.json();
    return jsonResponse(data, res.status);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
