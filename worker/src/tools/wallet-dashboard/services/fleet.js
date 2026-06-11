import { ENTITY_API_BASE, IOT_DATA_ONLY_FEE_MAX, CACHE_TTL } from "../config.js";
import { kvGetJson, kvPutJson } from "../utils.js";

/**
 * Fetch a wallet's full Hotspot fleet from the Helium Entity API and derive
 * fleet-wide stats. One Entity API call returns every Hotspot with metadata.
 *
 * Returns { count, hotspots: [...], stats }. Cached in KV (shared by /summary
 * and /fleet so the Entity API is hit at most once per wallet per TTL).
 *
 * NOTE: never read `is_active` from the Entity API — it is always false and
 * meaningless. Activity is derived from rewards on the client instead.
 */
export async function fetchFleet(env, wallet) {
  const cacheKey = `wd:fleet:${wallet}`;
  const cached = await kvGetJson(env, cacheKey);
  if (cached) return cached;

  const res = await fetch(`${ENTITY_API_BASE}/v2/wallet/${wallet}`, {
    signal: AbortSignal.timeout(20_000),
  });
  // The Entity API returns 404 for any wallet it has never indexed — i.e. every
  // wallet that owns zero Hotspots. Treat that as an empty fleet, not an error,
  // so token-holder / governance-only wallets still get a dashboard (mirrors the
  // hotspot-claimer wallet handler). Only non-404 failures are errors.
  let data;
  if (res.ok) {
    data = await res.json();
  } else if (res.status === 404) {
    data = { hotspots: [], hotspots_count: 0 };
  } else {
    throw new Error(`Entity API returned ${res.status}`);
  }

  const hotspots = (data.hotspots || []).map(mapHotspot).filter(Boolean);
  const result = {
    count: data.hotspots_count ?? hotspots.length,
    hotspots,
    stats: deriveFleetStats(hotspots),
  };

  await kvPutJson(env, cacheKey, result, CACHE_TTL.fleet);
  return result;
}

/** Which networks a Hotspot is on, from the `networks` attribute (or inferred). */
function getNetworks(h) {
  const attr = (h.attributes || []).find((a) => a?.trait_type === "networks");
  const nets = Array.isArray(attr?.value) ? attr.value.slice() : [];
  if (nets.length) return nets;
  // Fallback when the networks attribute is empty (e.g. issued-but-not-yet-asserted
  // Hotspots): infer from hotspot_infos. Sub-object presence alone isn't proof —
  // the Entity API returns a husk ({ location: null }) for networks the Hotspot
  // isn't on — so require a field a real registration always carries (an asserted
  // location, the onboarding fee, or created_at; mobile records always have
  // device_type).
  const hi = h.hotspot_infos || {};
  const out = [];
  if (hi.iot && (hi.iot.location || hi.iot.dc_onboarding_fee_paid != null || hi.iot.created_at)) {
    out.push("iot");
  }
  if (hi.mobile && (hi.mobile.location || hi.mobile.device_type)) out.push("mobile");
  return out;
}

/**
 * Classify a Hotspot's device type.
 *   - Mobile: the on-chain device_type if the Entity API exposes it, else "mobile".
 *   - IoT: data-only vs full, inferred from the onboarding fee (data-only Hotspots
 *     pay ~50,000 DC; full IoT Hotspots pay ~1,000,000 DC).
 */
function deriveDeviceType(network, info, feePaid) {
  if (network === "mobile") return info.device_type || "mobile";
  if (network === "iot") {
    if (feePaid == null) return "iot";
    return feePaid < IOT_DATA_ONLY_FEE_MAX ? "iotDataOnly" : "iotFull";
  }
  return null;
}

/** Map one Entity API Hotspot record to the dashboard's fleet row shape. */
function mapHotspot(h) {
  const entityKey =
    h.entity_key_str ||
    (h.attributes || []).find((a) => a?.trait_type === "entity_key_string")?.value ||
    null;
  const assetId =
    h.asset_id || h.hotspot_infos?.iot?.asset || h.hotspot_infos?.mobile?.asset || null;
  // Both are required to look up rewards downstream.
  if (!entityKey || !assetId) return null;

  const networks = getNetworks(h);
  const network = networks[0] || null;

  // Read the IoT and Mobile sub-objects directly. They carry disjoint fields
  // (IoT: location/city/state/created_at/fee/elevation/gain; Mobile: location/
  // device_type), so a dual-network Hotspot must not be funneled through a single
  // sub-object — that would drop half its metadata. Merge per-field, preferring
  // IoT (it has the rich on-chain data): the Entity API returns an `iot`
  // sub-object even for mobile-only Hotspots ({ location: null }), so an
  // object-level `iot || mobile` would latch onto that husk and drop the
  // Mobile location/geo entirely.
  const iot = h.hotspot_infos?.iot || null;
  const mobile = h.hotspot_infos?.mobile || null;
  const pick = (field) => iot?.[field] ?? mobile?.[field] ?? null;
  const num = (v) => (v == null ? null : Number(v));

  return {
    entityKey,
    assetId,
    keyToAssetKey: h.key_to_asset_key || null,
    name: h.name || null,
    network,
    networks: networks.length ? networks : network ? [network] : [],
    location: pick("location"), // H3 cell index (decoded to lat/lng on the client)
    city: pick("city"),
    state: pick("state"),
    country: pick("country"),
    street: pick("street"),
    createdAt: pick("created_at"),
    elevation: num(pick("elevation")),
    gain: num(pick("gain")),
    // The row's fee (and the fleet onboarding-DC total) counts either network's;
    // data-only vs full inference is IoT-specific, so it reads only the IoT fee.
    dcOnboardingFeePaid: num(pick("dc_onboarding_fee_paid")),
    deviceType: deriveDeviceType(network, { device_type: mobile?.device_type }, num(iot?.dc_onboarding_fee_paid)),
  };
}

const topN = (obj, n = 8) =>
  Object.entries(obj)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);

/** Compute fleet-wide aggregates used by the summary cards. */
function deriveFleetStats(hotspots) {
  const byNetwork = {};
  const byDeviceType = {};
  const countries = {};
  const states = {};
  const cities = {};
  const monthBuckets = {};
  let asserted = 0;
  let onboardingDcTotal = 0;
  let oldest = null;
  let newest = null;

  for (const h of hotspots) {
    // Count each Hotspot once under its primary network so sum(byNetwork) === total
    // and stays consistent with byDeviceType (dual-network Hotspots are rare).
    if (h.network) byNetwork[h.network] = (byNetwork[h.network] || 0) + 1;
    if (h.deviceType) byDeviceType[h.deviceType] = (byDeviceType[h.deviceType] || 0) + 1;
    if (h.location) asserted++;
    if (h.dcOnboardingFeePaid != null) onboardingDcTotal += h.dcOnboardingFeePaid;
    if (h.country) countries[h.country] = (countries[h.country] || 0) + 1;
    if (h.state) states[h.state] = (states[h.state] || 0) + 1;
    if (h.city) {
      const label = h.state ? `${h.city}, ${h.state}` : h.city;
      cities[label] = (cities[label] || 0) + 1;
    }
    if (h.createdAt) {
      const month = h.createdAt.slice(0, 7); // YYYY-MM
      monthBuckets[month] = (monthBuckets[month] || 0) + 1;
      if (!oldest || h.createdAt < oldest) oldest = h.createdAt;
      if (!newest || h.createdAt > newest) newest = h.createdAt;
    }
  }

  const timeline = Object.entries(monthBuckets)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  return {
    total: hotspots.length,
    byNetwork,
    byDeviceType,
    asserted,
    unasserted: hotspots.length - asserted,
    onboardingDcTotal,
    oldestCreatedAt: oldest,
    newestCreatedAt: newest,
    timeline,
    regions: {
      countriesDistinct: Object.keys(countries).length,
      statesDistinct: Object.keys(states).length,
      citiesDistinct: Object.keys(cities).length,
      topCountries: topN(countries),
      topStates: topN(states),
      topCities: topN(cities),
    },
  };
}
