/**
 * Current HNT/USD conversion rates for the HNT↔DC simulator.
 *
 * The price itself comes from the **hnt-price** tool's shared `hntprice:snap`
 * KV snapshot — the same on-chain oracle account `mint_data_credits_v0` reads,
 * with Jupiter spot as a display-only fallback. That snapshot is the cache
 * (shared across isolates, refreshed behind the response when stale), so there
 * is nothing to cache in this module: `getSnapshotSwr` owns the whole
 * stale-while-revalidate policy, shared with `/hnt-price/current` so the two
 * surfaces can't drift apart on staleness. This handler is pure shape-mapping.
 *
 * Every figure reported here is on the **conservative mint price**
 * (`ema − 2×conf`) — what the burn actually pays — not the headline EMA, so
 * `hnt_usd` and `dc_per_hnt` always agree with each other and with the chain.
 *
 * The response shape is a long-standing contract with `lib/dcMintApi.js` →
 * `DcMintTool.jsx` / `DcMintModal.jsx`. Keep the keys stable.
 */
import { jsonResponse } from "../../../lib/response.js";
import { DC_PER_USD, dcPerHnt, getSnapshotSwr } from "../../hnt-price/services/price.js";

/**
 * `hnt_usd` is rendered raw (no `toFixed`) by both `DcMintTool` and
 * `DcMintModal`, so its cent rounding is part of the display contract — dropping
 * it would turn "HNT $0.17" into "HNT $0.169912". `dc_per_hnt`, the number the
 * DC conversion actually rides on, keeps full snapshot precision.
 */
function toCents(usd) {
  return Math.round(usd * 100) / 100;
}

/**
 * Map an hnt-price snapshot onto this endpoint's response shape.
 *
 * The oracle half is preferred: it is the exact account and formula the mint
 * program uses, so the preview lines up with what the burn will actually pay.
 * `spot` is only a fallback for a snapshot whose oracle read failed (either
 * half may be null — see hnt-price's CLAUDE.md).
 *
 * @param snapshot a payload from `getSnapshotSwr`, which returns one or throws.
 * @returns the mapped payload, or `null` when neither half carries a price.
 */
function mapSnapshot(snapshot) {
  const { oracle, spot, dc_per_hnt } = snapshot;
  // `mint_price_usd` (ema − 2×conf), not the headline `oracle.usd` EMA: it is
  // the price `mint_data_credits_v0` charges, and the basis the snapshot's
  // `dc_per_hnt` is already computed on. Reporting the EMA here instead would
  // leave the two figures disagreeing by the confidence margin. The spot
  // fallback needs no such adjustment — spot carries no confidence interval,
  // and its `dc_per_hnt` below is derived from the same `spot.usd`.
  const usd = oracle?.mint_price_usd ?? spot?.usd;
  if (typeof usd !== "number" || !(usd > 0)) return null;

  return {
    hnt_usd: toCents(usd),
    // Full precision, deliberately: no UI reads this, and a confidence interval
    // is usually sub-cent, so rounding it would report a flat 0.
    confidence: oracle ? oracle.conf_usd : null,
    // Snapshot `dc_per_hnt` is derived from the conservative mint price and is
    // null exactly when `oracle` is, hence the spot-derived fallback.
    dc_per_hnt: dc_per_hnt ?? dcPerHnt(usd),
    dc_per_usd: DC_PER_USD,
    timestamp: (oracle ? oracle.publish_time : spot?.updated_at) ?? null,
  };
}

export async function handlePrice(env, ctx) {
  try {
    const mapped = mapSnapshot(await getSnapshotSwr(env, ctx));
    if (!mapped) throw new Error("snapshot carried no usable HNT price");
    return jsonResponse(mapped);
  } catch (err) {
    return jsonResponse({ error: `Failed to fetch HNT price: ${err.message}` }, 500);
  }
}
