import { handleSubscribe } from "./handlers/subscribe.js";
import { handleVerify } from "./handlers/verify.js";
import { handleListOuis } from "./handlers/listOuis.js";
import { handleBalance } from "./handlers/balance.js";
import { handleTimeseries } from "./handlers/timeseries.js";
import { handleUpdateOuis } from "./handlers/updateOuis.js";
import { handlePreview } from "./handlers/preview.js";
import { handleKnownOuis } from "./handlers/knownOuis.js";
import { jsonHeaders } from "./responseUtils.js";

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: jsonHeaders });
  }

  if (request.method === "GET" && pathname.startsWith("/preview/")) {
    const templateName = pathname.replace("/preview/", "");
    return handlePreview(templateName);
  }

  if (request.method === "POST" && pathname === "/subscribe") {
    return handleSubscribe(request, env);
  }

  if (request.method === "GET" && pathname === "/verify") {
    return handleVerify(request, env);
  }

  if (request.method === "GET" && pathname === "/health") {
    return new Response(JSON.stringify({ ok: true, tool: "oui-notifier" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (request.method === "GET" && pathname === "/known-ouis") {
    return handleKnownOuis(env);
  }

  if (request.method === "GET" && pathname === "/ouis") {
    return handleListOuis(env);
  }

  if (request.method === "GET" && pathname === "/balance") {
    return handleBalance(url, env);
  }

  if (request.method === "GET" && pathname === "/timeseries") {
    return handleTimeseries(url, env);
  }

  if (request.method === "POST" && pathname.startsWith("/update-ouis")) {
    const match = pathname.match(/^\/update-ouis\/(\d+)\/?$/);
    const targetOui = match ? Number(match[1]) : null;
    return handleUpdateOuis(env, targetOui);
  }

  return new Response("Not found (oui-notifier)", { status: 404 });
}
