import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { keyToAssetKey, iotInfoKey, ataAddress, DC_MINT } from "../../../lib/helium-solana.js";
import { fetchAccount } from "../../hotspot-claimer/services/common.js";

const ONBOARDING_API = "https://onboarding.dewi.org/api/v3/hotspots";
// Maker must have at least 4M DC to cover full onboarding
const FULL_ONBOARD_DC_THRESHOLD = 4_000_000;

/**
 * POST /lookup
 * Body: { onboarding_key, gateway_pubkey }
 *
 * 1. Query the Helium onboarding server for maker info
 * 2. Check maker DC balance on-chain
 * 3. Check keyToAsset + iotInfo for on-chain status
 * 4. Return combined result
 */
export async function handleLookup(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { onboarding_key, gateway_pubkey } = body;
  if (!onboarding_key && !gateway_pubkey) {
    return jsonResponse({ error: "Missing onboarding_key or gateway_pubkey" }, 400);
  }

  try {
    // Run onboarding server lookup and on-chain checks in parallel
    const [makerResult, onchainResult] = await Promise.all([
      onboarding_key ? fetchMakerInfo(onboarding_key, env) : null,
      gateway_pubkey ? fetchOnchainStatus(gateway_pubkey, env) : null,
    ]);

    return jsonResponse({
      maker: makerResult,
      onchain: onchainResult || { issued: false, onboarded: false, has_location: false },
      hotspot_type: makerResult?.dc_sufficient ? "full" : "data_only",
    });
  } catch (err) {
    console.error("Lookup error:", err.message, err.stack);
    return jsonResponse({ error: "Lookup failed" }, 500);
  }
}

async function fetchMakerInfo(onboardingKey, env) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${ONBOARDING_API}/${onboardingKey}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Onboarding server returned ${res.status}`);
    }

    const data = await res.json();
    const hotspot = data?.data;
    if (!hotspot) return null;

    const maker = hotspot.maker;
    if (!maker) return { name: null, address: null, dc_balance: 0, dc_sufficient: false };

    // Convert Helium address to Solana pubkey (bytes 1-33 of base58-decoded address)
    let dcBalance = 0n;
    try {
      const heliumAddrBytes = bs58.decode(maker.address);
      const solanaKeyBytes = heliumAddrBytes.slice(1, 33);
      const makerSolanaPubkey = new PublicKey(solanaKeyBytes);
      const makerDcAta = ataAddress(makerSolanaPubkey, DC_MINT);
      const ataAccount = await fetchAccount(env, makerDcAta);
      if (ataAccount) {
        dcBalance = ataAccount.readBigUInt64LE(64);
      }
    } catch {
      // If we can't read maker balance, proceed with 0
    }

    return {
      name: maker.name || null,
      address: maker.address || null,
      dc_balance: dcBalance.toString(),
      dc_sufficient: dcBalance >= BigInt(FULL_ONBOARD_DC_THRESHOLD),
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return { name: null, address: null, dc_balance: 0, dc_sufficient: false };
    }
    throw err;
  }
}

async function fetchOnchainStatus(gatewayPubkey, env) {
  const [ktaAccount, iotAccount] = await Promise.all([
    fetchAccount(env, keyToAssetKey(gatewayPubkey)),
    fetchAccount(env, iotInfoKey(gatewayPubkey)),
  ]);

  const issued = !!ktaAccount;
  const onboarded = !!iotAccount;
  // IotHotspotInfoV0: discriminator(8) + asset(32) + bump_seed(1) + location(Option<u64>)
  const has_location = onboarded && iotAccount[41] === 1;

  return { issued, onboarded, has_location };
}
