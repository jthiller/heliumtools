import { jsonResponse } from "../../../lib/response.js";
import { keyToAssetKey, iotInfoKey } from "../../../lib/helium-solana.js";
import { fetchAccount } from "../../hotspot-claimer/services/common.js";

/**
 * Check on-chain status for a gateway's public key.
 * Returns { onchain, iot_onboarded, has_location, entity_url? }
 */
export async function handleOnchainStatus(pubkey, env) {
  if (!pubkey) {
    return jsonResponse({ error: "Missing pubkey parameter" }, 400);
  }

  try {
    const ktaPda = keyToAssetKey(pubkey);
    const iotPda = iotInfoKey(pubkey);
    const [ktaAccount, iotAccount] = await Promise.all([
      fetchAccount(env, ktaPda),
      fetchAccount(env, iotPda),
    ]);

    if (!ktaAccount) {
      return jsonResponse({ onchain: false, iot_onboarded: false, has_location: false });
    }

    const iot_onboarded = !!iotAccount;
    // IotHotspotInfoV0: discriminator(8) + asset(32) + bump_seed(1) + location(Option<u64>)
    // location at offset 41: 0x00 = None, 0x01 = Some
    const has_location = iot_onboarded && iotAccount[41] === 1;

    return jsonResponse({
      onchain: true,
      iot_onboarded,
      has_location,
      entity_url: `https://world.helium.com/network/iot/hotspot/${pubkey}`,
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to check on-chain status: ${err.message}` }, 500);
  }
}

/**
 * Batch check on-chain status for multiple public keys.
 * Accepts POST { pubkeys: string[] }
 */
export async function handleBatchOnchainStatus(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { pubkeys } = body;
  if (!Array.isArray(pubkeys) || pubkeys.length === 0) {
    return jsonResponse({ error: "pubkeys must be a non-empty array" }, 400);
  }

  if (pubkeys.length > 50) {
    return jsonResponse({ error: "Maximum 50 pubkeys per request" }, 400);
  }

  const results = {};
  const checks = pubkeys.map(async (pubkey) => {
    try {
      const ktaPda = keyToAssetKey(pubkey);
      const iotPda = iotInfoKey(pubkey);
      const [ktaAccount, iotAccount] = await Promise.all([
        fetchAccount(env, ktaPda),
        fetchAccount(env, iotPda),
      ]);

      const onchain = !!ktaAccount;
      const iot_onboarded = !!iotAccount;
      const has_location = iot_onboarded && iotAccount[41] === 1;

      results[pubkey] = {
        onchain,
        iot_onboarded,
        has_location,
        entity_url: onchain
          ? `https://world.helium.com/network/iot/hotspot/${pubkey}`
          : undefined,
      };
    } catch {
      results[pubkey] = { onchain: false, iot_onboarded: false, has_location: false };
    }
  });

  await Promise.allSettled(checks);
  return jsonResponse({ results });
}
