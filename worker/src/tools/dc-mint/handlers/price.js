/**
 * Fetch current HNT/USD price from Pyth Hermes API.
 * Returns conversion rates for the HNT↔DC simulator.
 * Cached for 15 seconds to avoid hammering the Pyth API.
 */
import { jsonResponse } from "../../../lib/response.js";

const DC_PER_USD = 100_000;
const HNT_PRICE_FEED_ID = "649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756";
const CACHE_TTL_MS = 15_000;

let cachedResponse = null;
let cachedAt = 0;

export async function handlePrice() {
  const now = Date.now();
  if (cachedResponse && now - cachedAt < CACHE_TTL_MS) {
    return jsonResponse(cachedResponse);
  }

  try {
    const res = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${HNT_PRICE_FEED_ID}`,
    );
    if (!res.ok) throw new Error(`Pyth API returned ${res.status}`);

    const data = await res.json();
    const priceFeed = data.parsed?.[0]?.price;
    if (priceFeed?.price == null || priceFeed?.expo == null) throw new Error("No price data in response");

    const price = Number(priceFeed.price) * 10 ** priceFeed.expo;
    if (price <= 0) throw new Error("Invalid HNT price from oracle");

    const confidence = Number(priceFeed.conf || 0) * 10 ** priceFeed.expo;
    const hntUsd = Math.round(price * 100) / 100;

    const result = {
      hnt_usd: hntUsd,
      confidence: Math.round(confidence * 100) / 100,
      dc_per_hnt: Math.round(hntUsd * DC_PER_USD),
      dc_per_usd: DC_PER_USD,
      timestamp: priceFeed.publish_time ?? null,
    };

    cachedResponse = result;
    cachedAt = now;

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: `Failed to fetch HNT price: ${err.message}` }, 500);
  }
}
