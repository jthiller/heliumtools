/**
 * On-chain IoT onboarding fee reader with KV caching.
 *
 * Reads SubDaoV0.onboarding_dc_fee, SubDaoV0.onboarding_data_only_dc_fee
 * and RewardableEntityConfigV0 IotConfig location staking fees from Solana.
 *
 * Values are cached in KV with a 7-hour TTL (refreshed by the scheduled cron).
 * Falls back to HIP-based defaults if RPC is unavailable.
 */
import { Connection } from "@solana/web3.js";
import { IOT_SUB_DAO_KEY, REWARDABLE_ENTITY_CONFIG_KEY } from "../../../lib/helium-solana.js";

const KV_KEY = "iot-onboard:fees:v1";
const KV_TTL_SECONDS = 7 * 60 * 60; // 7 hours (longer than 6h cron interval to avoid gaps)

// HIP-based fallback defaults (used when RPC is unavailable)
const DEFAULTS = {
  full: { base: 1_000_000, location: 100_000 },
  data_only: { base: 50_000, location: 50_000 },
  stale: true,
  fetchedAt: null,
};

// SubDaoV0 layout: the onboarding_dc_fee u64 is at byte offset 304
// (8 disc + 32 dao + 32 dnt_mint + 32 treasury + 32 rewards_escrow +
//  32 delegator_pool + 16 vehnt_delegated + 8 vehnt_last_calc_ts +
//  16 vehnt_fall_rate + 32 authority + 32 active_device_auth + 32 dc_burn_auth)
const SUB_DAO_ONBOARDING_FEE_OFFSET = 304;

function parseSubDaoFees(buf) {
  const fullBase = Number(buf.readBigUInt64LE(SUB_DAO_ONBOARDING_FEE_OFFSET));

  // onboarding_data_only_dc_fee is after emission_schedule Vec, bump_seed, registrar, _deprecated
  // emission_schedule: u32 length + N * 16 bytes (each: i64 + u64)
  const emissionLen = buf.readUInt32LE(SUB_DAO_ONBOARDING_FEE_OFFSET + 8);
  const afterEmission = SUB_DAO_ONBOARDING_FEE_OFFSET + 8 + 4 + emissionLen * 16;
  // bump_seed(1) + registrar(32) + _deprecated_delegator_rewards_percent(u64 = 8)
  const dataOnlyOffset = afterEmission + 1 + 32 + 8;
  const dataOnlyBase = Number(buf.readBigUInt64LE(dataOnlyOffset));

  return { fullBase, dataOnlyBase };
}

function parseIotConfigFees(buf) {
  // Search for the IoT config by finding min_gain=10 (1 dBi), max_gain=150 (15 dBi)
  // then validate the following fee values are plausible DC amounts
  for (let i = 0; i < buf.length - 24; i++) {
    const minGain = buf.readInt32LE(i);
    const maxGain = buf.readInt32LE(i + 4);
    if (minGain === 10 && maxGain === 150) {
      const fullLocation = Number(buf.readBigUInt64LE(i + 8));
      const dataOnlyLocation = Number(buf.readBigUInt64LE(i + 16));
      // Plausibility: fees should be 0-100M DC range
      if (fullLocation >= 0 && fullLocation <= 100_000_000 &&
          dataOnlyLocation >= 0 && dataOnlyLocation <= 100_000_000) {
        return { fullLocation, dataOnlyLocation };
      }
    }
  }
  return null;
}

/**
 * Fetch fresh fees from on-chain accounts.
 */
async function fetchFeesFromChain(env) {
  const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  const accounts = await connection.getMultipleAccountsInfo([
    IOT_SUB_DAO_KEY,
    REWARDABLE_ENTITY_CONFIG_KEY,
  ]);

  if (!accounts[0] || !accounts[1]) {
    throw new Error("Failed to fetch SubDao or RewardableEntityConfig accounts");
  }

  const subDaoBuf = Buffer.from(accounts[0].data);
  const recBuf = Buffer.from(accounts[1].data);

  const { fullBase, dataOnlyBase } = parseSubDaoFees(subDaoBuf);
  const configFees = parseIotConfigFees(recBuf);

  if (!configFees) {
    throw new Error("Could not parse IoT config settings from RewardableEntityConfig");
  }

  return {
    full: { base: fullBase, location: configFees.fullLocation },
    data_only: { base: dataOnlyBase, location: configFees.dataOnlyLocation },
    stale: false,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Get onboarding fees, reading from KV cache first.
 * If cache is empty, fetches from chain and caches.
 */
export async function getOnboardFees(env) {
  // Try KV cache first
  try {
    const cached = await env.KV.get(KV_KEY, "json");
    if (cached) return cached;
  } catch {}

  // Cache miss — fetch from chain
  try {
    const fees = await fetchFeesFromChain(env);
    await env.KV.put(KV_KEY, JSON.stringify(fees), { expirationTtl: KV_TTL_SECONDS });
    return fees;
  } catch (err) {
    console.error("Failed to fetch on-chain fees:", err.message);
    return DEFAULTS;
  }
}

/**
 * Force-refresh fees from chain into KV. Called by the cron handler.
 */
export async function refreshOnboardFees(env) {
  try {
    const fees = await fetchFeesFromChain(env);
    await env.KV.put(KV_KEY, JSON.stringify(fees), { expirationTtl: KV_TTL_SECONDS });
    console.log("Refreshed IoT onboard fees:", JSON.stringify(fees));
    return fees;
  } catch (err) {
    console.error("Cron fee refresh failed:", err.message);
    return null;
  }
}
