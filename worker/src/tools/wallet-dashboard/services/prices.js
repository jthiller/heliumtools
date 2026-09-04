import { BALANCE_TOKENS, CACHE_TTL } from "../config.js";
import { fetchJupiterUsdPrices } from "../../../lib/jupiter.js";
import { kvGetJson, kvPutJson } from "../utils.js";

const PRICES_CACHE_KEY = "wd:prices";

/**
 * Fetch USD prices for the balance tokens.
 *   - Jupiter Price API v3 (by mint) for every priced token — HNT, MOBILE, IOT
 *     and SOL (as wrapped SOL) in one request, via the shared client in
 *     `worker/src/lib/jupiter.js` (hnt-price reads the same endpoint through it).
 *     CoinGecko is intentionally avoided — it blocks Worker egress IPs.
 *   - DC has a fixed value (100,000 DC = $1)
 * Pyth Hermes was the primary source for HNT / MOBILE / SOL until 2026-08, when
 * unauthenticated Hermes access was retired (Pyth pro migration). These are
 * display-only prices, so Jupiter alone is enough.
 * Returns { usd: { hnt, mobile, iot, sol, dc }, fetchedAt }. Missing prices are null.
 * Cached in KV for CACHE_TTL.prices seconds; never throws (price is best-effort).
 */
export async function fetchPrices(env) {
  const cached = await kvGetJson(env, PRICES_CACHE_KEY);
  if (cached) return cached;

  const usd = {};

  // ── Jupiter Price API v3 (by mint) — HNT, MOBILE, IOT, SOL ──
  const priced = Object.entries(BALANCE_TOKENS).filter(([, t]) => t.priceMint);
  try {
    const mints = [...new Set(priced.map(([, t]) => t.priceMint))];
    const quoted = await fetchJupiterUsdPrices(env, mints);
    for (const [key, t] of priced) {
      if (quoted[t.priceMint] != null) usd[key] = quoted[t.priceMint];
    }
  } catch {
    // leave missing prices as null
  }

  // ── Fixed-value tokens (DC: 100,000 DC = $1), driven from config ──
  for (const [key, t] of Object.entries(BALANCE_TOKENS)) {
    if (t.fixedUsdPerUnit != null) usd[key] = t.fixedUsdPerUnit;
  }

  // Normalize: ensure every balance token has a key (null if unavailable).
  for (const key of Object.keys(BALANCE_TOKENS)) {
    if (usd[key] == null) usd[key] = null;
  }

  const result = { usd, fetchedAt: Date.now() };
  await kvPutJson(env, PRICES_CACHE_KEY, result, CACHE_TTL.prices);
  return result;
}
