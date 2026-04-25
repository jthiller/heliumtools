import { corsHeaders, jsonResponse } from "../../lib/response.js";
import { getOuiCache } from "./oui-cache.js";
import { handleBatchOnchainStatus } from "./handlers/onchain.js";
import { handleIssueAndOnboard, handleOnboard } from "./handlers/issue.js";
import { REGIONS } from "./regions.js";

function getHost(env) {
  return env.MULTI_GATEWAY_HOST || "hotspot.heliumtools.org";
}

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

  // SSE proxy — merge event streams from all regions
  if (pathname === "/events" && request.method === "GET") {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // The Rust LNS caps each region at MAX_SSE_CONNECTIONS=20 (api.rs).
    // Each upstream slot is freed only when its stream is dropped — i.e.
    // when our outbound fetch is aborted or its reader is cancelled. If
    // we never propagate the inbound client's disconnect, every page load
    // and every EventSource auto-retry leaks 6 upstream slots that linger
    // until upstream TCP timeout. The cap fills and subsequent /events
    // responses 503, which our handler reports as
    // {"error":"No upstream available"}. Tie request.signal to the
    // outbound fetches so disconnects release slots immediately.
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    request.signal.addEventListener("abort", onAbort);

    const sources = REGIONS.map(({ port }) =>
      fetch(`http://${host}:${port}/events`, { headers, signal: ac.signal }),
    );

    // Pipe each upstream SSE stream into the merged output.
    // Buffer by SSE event boundary (\n\n) to prevent interleaving
    // partial events from concurrent streams.
    Promise.allSettled(sources).then(async (results) => {
      const readers = [];
      for (const result of results) {
        if (result.status === "fulfilled" && result.value.ok) {
          readers.push(result.value.body.getReader());
        }
      }

      if (readers.length === 0) {
        try {
          await writer.write(
            encoder.encode('data: {"error":"No upstream available"}\n\n'),
          );
          await writer.close();
        } catch {
          /* client gone */
        }
        request.signal.removeEventListener("abort", onAbort);
        return;
      }

      await Promise.allSettled(
        readers.map(async (reader) => {
          let buffer = "";
          while (!ac.signal.aborted) {
            let chunk;
            try {
              chunk = await reader.read();
            } catch {
              return; // upstream errored / aborted
            }
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop();
            for (const event of events) {
              try {
                await writer.write(encoder.encode(event + "\n\n"));
              } catch {
                return; // client disconnected, stop forwarding
              }
            }
          }
          // Cancel the upstream reader so the underlying fetch releases its
          // SSE slot promptly instead of waiting on idle TCP GC.
          try { await reader.cancel(); } catch { /* already cancelled */ }
        }),
      );

      try {
        await writer.close();
      } catch {
        /* already closed */
      }
      request.signal.removeEventListener("abort", onAbort);
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...corsHeaders,
      },
    });
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

  // Add gateway transaction proxy (legacy protobuf)
  const addMatch = pathname.match(/^\/gateways\/([A-Fa-f0-9]{16})\/add$/);
  if (addMatch && request.method === "POST") {
    const mac = addMatch[1];
    const reqBody = await request.text();
    const writeKey = env.MULTI_GATEWAY_WRITE_API_KEY || apiKey;
    const addResults = await Promise.allSettled(
      REGIONS.map(({ port }) =>
        fetch(`http://${host}:${port}/gateways/${mac}/add`, {
          method: "POST",
          headers: { "X-API-Key": writeKey, "Content-Type": "application/json" },
          body: reqBody,
        }).then(async (res) => res.ok ? await res.json() : null)
      ),
    );
    const addResult = addResults.find(r => r.status === "fulfilled" && r.value)?.value;
    if (addResult) return jsonResponse(addResult);
    return jsonResponse({ error: "Gateway not found" }, 404);
  }

  if (pathname === "/ouis" && request.method === "GET") {
    const data = await getOuiCache(env);
    return jsonResponse(data);
  }

  return jsonResponse({ error: "Not found" }, 404);
}
