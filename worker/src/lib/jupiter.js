// Jupiter Price API v3 — the one place this worker asks for a token's USD price.
//
// Shared by hnt-price (the `spot` half of its snapshot) and wallet-dashboard
// (HNT / MOBILE / IOT / SOL balances), so a change to Jupiter's contract is a
// one-file fix rather than two drifting copies. CoinGecko is intentionally
// avoided — it blocks Cloudflare Worker egress IPs.

const JUPITER_PRICE_URL = "https://lite-api.jup.ag/price/v3";

// One ceiling for both consumers; a hung Jupiter must not hold a request open.
const TIMEOUT_MS = 10_000;

/**
 * USD prices for a set of mints, in one request.
 *
 * Every requested mint gets a key back: the number Jupiter quoted, or `null`
 * when it quoted nothing usable (missing, non-finite, or non-positive). Only
 * network/HTTP failure throws, so callers pick their own posture — hnt-price
 * treats a missing HNT price as a failed source, wallet-dashboard nulls the row
 * and carries on.
 *
 * @param {string[]} mints
 * @returns {Promise<Record<string, number|null>>}
 */
export async function fetchJupiterUsdPrices(mints) {
  const res = await fetch(`${JUPITER_PRICE_URL}?ids=${mints.join(",")}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Jupiter price API returned ${res.status}`);
  }
  const data = await res.json();

  const prices = {};
  for (const mint of mints) {
    const usd = data?.[mint]?.usdPrice;
    prices[mint] = typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : null;
  }
  return prices;
}
