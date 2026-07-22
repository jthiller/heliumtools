/**
 * On-chain Mobile onboarding fee reader with KV caching.
 *
 * Reads the per-device-type DeviceFeesV1 schedule out of the MOBILE
 * RewardableEntityConfigV0 account (keyed by device type name; the wizard
 * uses wifiDataOnly, /update picks by the Hotspot's actual device type).
 * Values are cached in KV with a 7-hour TTL (refreshed by the 6-hourly cron —
 * TTL deliberately exceeds the cron interval so the cache never gaps). Falls
 * back to the documented defaults if RPC is unavailable.
 */
import { Connection } from "@solana/web3.js";
import {
  MOBILE_REWARDABLE_ENTITY_CONFIG_KEY,
  parseMobileConfigFees,
} from "../../../lib/helium-solana.js";

const KV_KEY = "mobile-onboard:fees:v1";
const KV_TTL_SECONDS = 7 * 60 * 60;

// Fallback defaults matching the live on-chain values (July 2026). All device
// types are listed so a stale fallback can't misprice /update's DC pre-check
// for a non-wifiDataOnly Hotspot (cbrs location asserts cost 1M DC). Used only
// when RPC is unavailable.
const DEFAULTS = {
  cbrs: { dc_onboarding_fee: 4_000_000, location_staking_fee: 1_000_000, mobile_onboarding_fee_usd: 0 },
  wifiIndoor: { dc_onboarding_fee: 2_000_000, location_staking_fee: 0, mobile_onboarding_fee_usd: 0 },
  wifiOutdoor: { dc_onboarding_fee: 3_000_000, location_staking_fee: 0, mobile_onboarding_fee_usd: 0 },
  wifiDataOnly: { dc_onboarding_fee: 200_000, location_staking_fee: 0, mobile_onboarding_fee_usd: 0 },
  stale: true,
  fetchedAt: null,
};

async function fetchFeesFromChain(env) {
  const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  const account = await connection.getAccountInfo(MOBILE_REWARDABLE_ENTITY_CONFIG_KEY);
  if (!account) {
    throw new Error("MOBILE RewardableEntityConfig account not found");
  }
  const fees = parseMobileConfigFees(Buffer.from(account.data));
  return { ...fees, stale: false, fetchedAt: new Date().toISOString() };
}

/** The fee entry for a device type, falling back to wifiDataOnly. */
export function feesForDeviceType(fees, deviceType) {
  return fees[deviceType] || fees.wifiDataOnly;
}

/**
 * Get wifiDataOnly onboarding fees, reading from KV cache first.
 */
export async function getMobileOnboardFees(env) {
  try {
    const cached = await env.KV.get(KV_KEY, "json");
    if (cached) return cached;
  } catch {}

  try {
    const fees = await fetchFeesFromChain(env);
    await env.KV.put(KV_KEY, JSON.stringify(fees), { expirationTtl: KV_TTL_SECONDS });
    return fees;
  } catch (err) {
    console.error("Failed to fetch on-chain mobile fees:", err.message);
    return DEFAULTS;
  }
}

/**
 * Force-refresh fees from chain into KV. Called by the cron handler.
 */
export async function refreshMobileOnboardFees(env) {
  try {
    const fees = await fetchFeesFromChain(env);
    await env.KV.put(KV_KEY, JSON.stringify(fees), { expirationTtl: KV_TTL_SECONDS });
    console.log("Refreshed mobile onboard fees:", JSON.stringify(fees));
    return fees;
  } catch (err) {
    console.error("Mobile fee cron refresh failed:", err.message);
    return null;
  }
}
