// Jupiter Price API v3 — the one place this worker asks for a token's USD price.
//
// Shared by hnt-price (the `spot` half of its snapshot) and wallet-dashboard
// (HNT / MOBILE / IOT / SOL balances), so a change to Jupiter's contract is a
// one-file fix rather than two drifting copies. CoinGecko is intentionally
// avoided — it blocks Cloudflare Worker egress IPs.
//
// Host: `api.jup.ag`, the keyed host, with `JUPITER_API_KEY` when it is set.
// The old `lite-api.jup.ag` hostname is deprecated and its keyless access is
// being retired; that endpoint is the same product that Hermes was before it
// started returning 401, and it is the sole price source for two surfaces, so
// this moved ahead of the deadline rather than after it.

const JUPITER_PRICE_URL = "https://api.jup.ag/price/v3";

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
 * @param {object} env — for `JUPITER_API_KEY`; prices still resolve without it
 * @param {string[]} mints
 * @returns {Promise<Record<string, number|null>>}
 */
export async function fetchJupiterUsdPrices(env, mints) {
  const apiKey = env?.JUPITER_API_KEY;
  let res = await requestPrices(mints, apiKey);

  // A key Jupiter rejects is worse than no key at all: the host still serves
  // keyless requests today, so a stale or wrong-product key would black out
  // every USD figure on two surfaces. Retry once without it and make the
  // misconfiguration loud in the logs rather than silent on the wire.
  if (apiKey && (res.status === 401 || res.status === 403)) {
    console.error(
      `Jupiter rejected JUPITER_API_KEY (${res.status}); retrying keyless. Fix or clear the secret.`,
    );
    res = await requestPrices(mints, undefined);
  }

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

function requestPrices(mints, apiKey) {
  return fetch(`${JUPITER_PRICE_URL}?ids=${mints.join(",")}`, {
    headers: apiKey ? { "x-api-key": apiKey } : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}
