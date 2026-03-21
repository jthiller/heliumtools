import { corsHeaders, jsonResponse } from "../../lib/response.js";

const REGIONS = [
  { region: "US915", port: 4468 },
  { region: "EU868", port: 4469 },
];

const HOST = "hotspot.heliumtools.org";

export async function handleMultiGatewayRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const headers = { "X-API-Key": env.MULTI_GATEWAY_API_KEY };

  if (pathname === "/gateways" && request.method === "GET") {
    const results = await Promise.allSettled(
      REGIONS.map(({ port }) =>
        fetch(`http://${HOST}:${port}/gateways`, { headers }).then((r) =>
          r.json(),
        ),
      ),
    );

    let gateways = [];
    let total = 0;
    let connected = 0;

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        gateways = gateways.concat(result.value.gateways || []);
        total += result.value.total || 0;
        connected += result.value.connected || 0;
      }
    }

    return jsonResponse({ gateways, total, connected });
  }

  const packetsMatch = pathname.match(
    /^\/gateways\/([A-Fa-f0-9]{16})\/packets$/,
  );
  if (packetsMatch && request.method === "GET") {
    const mac = packetsMatch[1];
    for (const { port } of REGIONS) {
      const res = await fetch(`http://${HOST}:${port}/gateways/${mac}/packets`, {
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        return jsonResponse(data);
      }
    }
    return jsonResponse({ error: "Gateway not found" }, 404);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
