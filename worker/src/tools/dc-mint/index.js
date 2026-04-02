import { corsHeaders } from "../../lib/response.js";
import { handleBuildMint } from "./handlers/buildMint.js";
import { handleBuildDelegate } from "./handlers/buildDelegate.js";
import { handlePrice } from "./handlers/price.js";

export async function handleDcMintRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/build-mint" && request.method === "POST") {
    return handleBuildMint(request, env);
  }

  if (pathname === "/build-delegate" && request.method === "POST") {
    return handleBuildDelegate(request, env);
  }

  if (pathname === "/price" && request.method === "GET") {
    return handlePrice();
  }

  return new Response("Not found (dc-mint)", { status: 404 });
}
