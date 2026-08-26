import { fetchInstantPrice } from "../lib/hntPriceApi.js";

/**
 * WebMCP tools for the /hnt-price page. The site-wide `get-hnt-price`
 * (cached snapshot) is always available; this adds the live chain read
 * that only makes sense to expose where its rate limits are documented.
 */
export const hntPriceTools = [
  {
    name: "get-hnt-price-instant",
    title: "Get HNT price (live chain read)",
    description:
      "Read the HNT price live: the on-chain Pyth oracle account the Data Credits mint pays (fresh RPC read) plus the Jupiter market price. Slower and per-IP rate limited — prefer get-hnt-price (cached ~1 min) unless to-the-second freshness matters.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute() {
      return fetchInstantPrice();
    },
  },
];
