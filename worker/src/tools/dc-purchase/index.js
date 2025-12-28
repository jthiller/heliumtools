import { handleResolveOui } from "./handlers/resolveOui.js";
import { handleCreateOrder } from "./handlers/createOrder.js";
import { handleGetOrder } from "./handlers/getOrder.js";
import { handleCoinbaseWebhook } from "./handlers/coinbaseWebhook.js";
import { runReconciliation } from "./services/reconciliation.js";

export async function handleDcPurchaseRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^\/dc-purchase/, "") || "/";

  // Note: CORS allows all origins intentionally - this is a public API
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Coinbase-Signature",
      },
    });
  }

  // Routes: pathname has /dc-purchase stripped, so we match relative paths
  if (pathname.startsWith("/oui/")) {
    const ouiStr = pathname.split("/oui/")[1];
    return handleResolveOui(request, env, ouiStr);
  }

  if (pathname === "/orders" && request.method === "POST") {
    return handleCreateOrder(request, env, ctx);
  }

  if (pathname.startsWith("/orders/") && request.method === "GET") {
    const orderId = pathname.split("/orders/")[1];
    return handleGetOrder(orderId, env);
  }

  if (pathname === "/webhooks/coinbase" && request.method === "POST") {
    return handleCoinbaseWebhook(request, env, ctx);
  }

  return new Response("Not found (dc-purchase)", { status: 404 });
}

export async function runDcPurchaseScheduled(env, ctx) {
  ctx.waitUntil(runReconciliation(env));
}
