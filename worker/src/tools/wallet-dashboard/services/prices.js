import {
  BALANCE_TOKENS,
  PYTH_HERMES_BASE,
  JUPITER_PRICE_BASE,
  CACHE_TTL,
} from "../config.js";
import { kvGetJson, kvPutJson } from "../utils.js";

const PRICES_CACHE_KEY = "wd:prices";

const norm = (id) => (id || "").replace(/^0x/, "").toLowerCase();

/**
 * Fetch USD prices for the balance tokens.
 *   - Pyth Hermes multi-feed for HNT / MOBILE / SOL (one request)
 *   - Jupiter Price API v3 (by mint) fallback for anything missing (notably IOT,
 *     which has no Pyth feed). CoinGecko is intentionally avoided — it blocks
 *     Cloudflare Worker egress IPs.
 *   - DC has a fixed value (100,000 DC = $1)
 * Returns { usd: { hnt, mobile, iot, sol, dc }, fetchedAt }. Missing prices are null.
 * Cached in KV for CACHE_TTL.prices seconds; never throws (price is best-effort).
 */
export async function fetchPrices(env) {
  const cached = await kvGetJson(env, PRICES_CACHE_KEY);
  if (cached) return cached;

  const usd = {};

  // ── Pyth Hermes (HNT, MOBILE, SOL) ──
  const pythTokens = Object.entries(BALANCE_TOKENS).filter(([, t]) => t.pyth);
  try {
    const query = pythTokens.map(([, t]) => `ids[]=${t.pyth}`).join("&");
    const res = await fetch(
      `${PYTH_HERMES_BASE}/v2/updates/price/latest?${query}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (res.ok) {
      const data = await res.json();
      const parsed = data.parsed || [];
      for (const [key, t] of pythTokens) {
        const feed = parsed.find((p) => norm(p.id) === norm(t.pyth));
        const pr = feed?.price;
        if (pr?.price != null && pr?.expo != null) {
          const value = Number(pr.price) * 10 ** pr.expo;
          if (value > 0) usd[key] = value;
        }
      }
    }
  } catch {
    // fall through to Jupiter
  }

  // ── Jupiter Price API v3 (by mint) fallback for anything still missing ──
  const missing = Object.entries(BALANCE_TOKENS).filter(
    ([key, t]) => t.priceMint && usd[key] == null,
  );
  if (missing.length) {
    try {
      const ids = [...new Set(missing.map(([, t]) => t.priceMint))].join(",");
      const res = await fetch(`${JUPITER_PRICE_BASE}/price/v3?ids=${ids}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = await res.json();
        for (const [key, t] of missing) {
          const value = data?.[t.priceMint]?.usdPrice;
          if (typeof value === "number" && value > 0) usd[key] = value;
        }
      }
    } catch {
      // leave missing prices as null
    }
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
