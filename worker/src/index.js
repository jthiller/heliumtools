import {
  handleOuiNotifierRequest,
  runOuiNotifierDaily,
} from "./tools/oui-notifier/index.js";
import {
  handleDcPurchaseRequest,
  runDcPurchaseScheduled,
} from "./tools/dc-purchase/index.js";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // Route oui-notifier endpoints
      if (pathname.startsWith("/oui-notifier/")) {
        const subUrl = new URL(request.url);
        subUrl.pathname = pathname.replace(/^\/oui-notifier/, "") || "/";
        const subRequest = new Request(subUrl.toString(), request);
        return await handleOuiNotifierRequest(subRequest, env, ctx);
      }

      if (pathname.startsWith("/dc-purchase/")) {
        const subUrl = new URL(request.url);
        subUrl.pathname = pathname.replace(/^\/dc-purchase/, "") || "/";
        const subRequest = new Request(subUrl.toString(), request);
        return await handleDcPurchaseRequest(subRequest, env, ctx);
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
