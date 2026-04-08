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
import { handleDcMintRequest } from "./tools/dc-mint/index.js";
import { handleL1MigrationRequest } from "./tools/l1-migration/index.js";
import { refreshOuiCache } from "./tools/multi-gateway/oui-cache.js";

const routes = [
  { prefix: "/oui-notifier", handler: handleOuiNotifierRequest },
  { prefix: "/dc-purchase", handler: handleDcPurchaseRequest },
  { prefix: "/hotspot-claimer", handler: handleHotspotClaimerRequest },
  { prefix: "/hotspot-map", handler: handleHotspotMapRequest },
  { prefix: "/multi-gateway", handler: handleMultiGatewayRequest },
  { prefix: "/dc-mint", handler: handleDcMintRequest },
  { prefix: "/l1-migration", handler: handleL1MigrationRequest },
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
    // OUI data changes infrequently — refresh once daily at midnight UTC
    const hour = new Date(event.scheduledTime).getUTCHours();
    if (hour === 0) ctx.waitUntil(refreshOuiCache(env));
  },
};
