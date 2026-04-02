/**
 * Fetch current HNT/USD price from Pyth Hermes API.
 * Returns conversion rates for the HNT↔DC simulator.
 */
import { jsonResponse } from "../../../lib/response.js";

const DC_PER_USD = 100_000;
// Pyth Hermes price feed ID for HNT/USD
const HNT_PRICE_FEED_ID = "649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756";

export async function handlePrice() {
  try {
    const res = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${HNT_PRICE_FEED_ID}`,
    );
    if (!res.ok) throw new Error(`Pyth API returned ${res.status}`);

    const data = await res.json();
    const priceFeed = data.parsed?.[0]?.price;
    if (!priceFeed) throw new Error("No price data in response");

    // Pyth returns price as integer with exponent, e.g. price=542 expo=-2 → $5.42
    const price = Number(priceFeed.price) * 10 ** priceFeed.expo;
    const confidence = Number(priceFeed.conf) * 10 ** priceFeed.expo;

    return jsonResponse({
      hnt_usd: Math.round(price * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      dc_per_hnt: Math.round(price * DC_PER_USD),
      dc_per_usd: DC_PER_USD,
      timestamp: data.parsed[0].price.publish_time,
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to fetch HNT price: ${err.message}` }, 500);
  }
}
