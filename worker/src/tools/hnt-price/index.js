// hnt-price — public pseudo-realtime HNT price service. See README.md for the
// external API reference and CLAUDE.md for the internals.
//
// The top-level prefix router (worker/src/index.js) strips `/hnt-price` before
// this router sees the path, so the paths matched below are rebased.

import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { handleCurrent } from "./handlers/current.js";
import { handleInstant } from "./handlers/instant.js";

export async function handleHntPriceRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/current" && request.method === "GET") {
    return handleCurrent(request, env, ctx);
  }

  if (pathname === "/instant" && request.method === "GET") {
    return handleInstant(request, env);
  }

  // /ws — WebSocket price stream via the HntPriceHub Durable Object.
  //
  // Why: one DO instance polls the chain + Jupiter once per interval and fans
  // the result out to every subscriber, instead of each streaming client
  // costing its own RPC read. See worker/src/tools/hnt-price/hub.js.
  if (pathname === "/ws" && request.method === "GET") {
    if (!env.HNT_PRICE_HUB) {
      return jsonResponse({ error: "Hub binding missing" }, 500);
    }
    const id = env.HNT_PRICE_HUB.idFromName("hub");
    const stub = env.HNT_PRICE_HUB.get(id);
    // Forward to the DO's /ws path with the original Upgrade headers intact.
    // Construct a fresh Request so the URL is rewritten while headers
    // (including `Upgrade: websocket` and `Sec-WebSocket-Key`) carry over.
    const target = new URL(request.url);
    target.pathname = "/ws";
    const forwarded = new Request(target.toString(), request);
    return stub.fetch(forwarded);
  }

  return jsonResponse({ error: "Not found" }, 404);
}

// Cron entry point — the ≤15-minute backstop that keeps the KV snapshot warm
// for GET consumers when nobody is streaming.
export { refreshSnapshot } from "./services/price.js";
