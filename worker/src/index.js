import {
  handleOuiNotifierRequest,
  runOuiNotifierDaily,
} from "./tools/oui-notifier/index.js";
import {
  handleDcPurchaseRequest,
  runDcPurchaseScheduled,
} from "./tools/dc-purchase/index.js";
import { handleHotspotClaimerRequest } from "./tools/hotspot-claimer/index.js";
import { handleHotspotMapRequest } from "./tools/hotspot-map/index.js";
import { handleMultiGatewayRequest } from "./tools/multi-gateway/index.js";

const routes = [
  { prefix: "/oui-notifier", handler: handleOuiNotifierRequest },
  { prefix: "/dc-purchase", handler: handleDcPurchaseRequest },
  { prefix: "/hotspot-claimer", handler: handleHotspotClaimerRequest },
  { prefix: "/hotspot-map", handler: handleHotspotMapRequest },
  { prefix: "/multi-gateway", handler: handleMultiGatewayRequest },
];

function stripPrefix(request, prefix) {
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(prefix.length) || "/";
  return new Request(url.toString(), request);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const { pathname } = new URL(request.url);

      for (const { prefix, handler } of routes) {
        if (pathname.startsWith(prefix + "/")) {
          return await handler(stripPrefix(request, prefix), env, ctx);
        }
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("Unhandled fetch error", err);
      return new Response("Internal server error", { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runOuiNotifierDaily(env));
    ctx.waitUntil(runDcPurchaseScheduled(env, ctx));
  },
};
