import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { keyToAssetKey, iotInfoKey, ataAddress, DC_MINT } from "../../../lib/helium-solana.js";
import { fetchAccount } from "../../hotspot-claimer/services/common.js";
import { getOnboardFees } from "../services/fees.js";

const ONBOARDING_API = "https://onboarding.dewi.org/api/v3/hotspots";

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
    // Run onboarding server lookup, on-chain checks, and fee fetch in parallel
    const [makerResult, onchainResult, fees] = await Promise.all([
      onboarding_key ? fetchMakerInfo(onboarding_key, env) : null,
      gateway_pubkey ? fetchOnchainStatus(gateway_pubkey, env) : null,
      getOnboardFees(env),
    ]);

    // Compare maker DC balance against full onboarding cost (base + location)
    if (makerResult) {
      const fullCost = fees.full.base + fees.full.location;
      makerResult.dc_sufficient = BigInt(makerResult.dc_balance) >= BigInt(fullCost);
    }

    return jsonResponse({
      maker: makerResult,
      onchain: onchainResult || { issued: false, onboarded: false, has_location: false },
      suggested_mode: makerResult?.dc_sufficient ? "full" : "data_only",
      fees,
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

    // Convert Helium address to Solana pubkey
    // Helium format: [version(1), net_type(1), ed25519_pubkey(32), checksum(4)]
    let dcBalance = 0n;
    try {
      const heliumAddrBytes = bs58.decode(maker.address);
      const solanaKeyBytes = heliumAddrBytes.slice(2, 34);
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
      dc_sufficient: false, // set dynamically in handleLookup using on-chain fees
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
