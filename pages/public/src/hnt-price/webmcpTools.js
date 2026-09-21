import {
  PUBLIC_API_BASE,
  PUBLIC_WS_BASE,
  fetchInstantPrice,
} from "../lib/hntPriceApi.js";

/**
 * WebMCP tools for the /hnt-price page. The site-wide `get-hnt-price`
 * (cached snapshot) is always available. This page adds the live chain read
 * and an integration reference covering all four public API surfaces.
 */
export const hntPriceTools = [
  {
    name: "get-hnt-price-instant",
    title: "Get HNT price (live chain read)",
    description:
      "Read HNT pricing from its live sources: a fresh RPC read of the on-chain Pyth oracle account the Data Credits mint uses, plus a fresh Jupiter market quote. The oracle account itself normally advances about every 5 minutes. This endpoint is slower and limited to 15 requests/minute/IP; prefer get-hnt-price for polling and ordinary displays.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute() {
      return fetchInstantPrice();
    },
  },
  {
    name: "get-hnt-price-api-reference",
    title: "Get HNT price API integration reference",
    description:
      "Get the public, keyless HNT price API endpoints, recommended use cases, rate limits, streaming behavior, and payload semantics. Use this when choosing or integrating /current, /instant, /sse, or /ws; use get-hnt-price or get-hnt-price-instant when you only need one snapshot.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute() {
      return {
        authentication: "None",
        cors: "Open",
        payload: {
          symbol: 'Always "HNT".',
          spot:
            'Market price for display; nullable when that source is unavailable. spot.usd is USD per HNT, spot.source identifies the market source (currently "jupiter"), and spot.updated_at is Unix seconds.',
          oracle:
            "On-chain Pyth state used by the Data Credits program; nullable when the chain read fails. oracle.usd is the posted USD price, oracle.conf_usd is its confidence interval in USD, oracle.mint_price_usd is the conservative EMA minus 2× confidence price a DC burn pays, oracle.publish_time is Unix seconds and normally advances about every 5 minutes, and oracle.account is the governance-resolved base58 feed address.",
          dc_per_hnt:
            "Integer DC yielded by burning 1 HNT at oracle.mint_price_usd; null when oracle is null. Do not derive DC yield from spot.usd.",
          dc_per_usd: "Always 100000.",
          snapshot_at: "Unix milliseconds when the snapshot was assembled.",
        },
        endpoints: {
          current: {
            url: `${PUBLIC_API_BASE}/current`,
            transport: "HTTP GET",
            useFor: "Polling, dashboards, and ordinary displays; poll every 15–30 seconds.",
            behavior:
              "Returns the cached snapshot immediately. Snapshots older than 30 seconds trigger a background refresh.",
            rateLimit: "60 requests/minute/IP",
            webmcpTool: "get-hnt-price (available site-wide)",
          },
          instant: {
            url: `${PUBLIC_API_BASE}/instant`,
            transport: "HTTP GET",
            useFor: "One-off live reads, especially immediately before building a DC mint transaction.",
            behavior:
              "Reads RPC and Jupiter on every call. This refreshes the account read, but the oracle value only changes when its crank posts, roughly every 5 minutes.",
            rateLimit: "15 requests/minute/IP",
            webmcpTool: "get-hnt-price-instant",
          },
          sse: {
            url: `${PUBLIC_API_BASE}/sse`,
            transport: "Server-Sent Events",
            useFor: "Live browser displays and clients that want native reconnection and a liveness heartbeat.",
            behavior:
              "Sends one snapshot on connect, changed snapshots at roughly 15-second checks, comment heartbeats when unchanged, and retry: 3000. Close EventSource when done.",
            subscriberLimit: "500 concurrent subscribers shared with /ws",
          },
          websocket: {
            url: `${PUBLIC_WS_BASE}/ws`,
            transport: "WebSocket",
            useFor: "Live clients that specifically require WebSocket transport.",
            behavior:
              "Sends one snapshot on connect and changed snapshots thereafter. It has no ping or heartbeat frames, so clients must implement reconnection.",
            subscriberLimit: "500 concurrent subscribers shared with /sse",
          },
        },
      };
    },
  },
];
