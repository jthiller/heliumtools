import { PublicKey } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { KTA_ASSET_OFFSET, keyToAssetKey, mobileInfoKey, parseMobileInfo, fetchAsset } from "../../../lib/helium-solana.js";
import { fetchAccount } from "../../hotspot-claimer/services/common.js";
import { getMobileOnboardFees } from "../services/fees.js";

/**
 * POST /status
 * Body: { gateway }   // Helium-format entity key (the Hotspot pubkey)
 *
 * Reads the keyToAsset + mobileInfo PDAs and returns the Hotspot's on-chain
 * state. The wizard polls this between the issue confirm and the onboard
 * build (the DAS indexer can lag the issue transaction by up to ~60s), and
 * the resume flow uses it as the source of truth for which step comes next.
 */
export async function handleStatus(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { gateway } = body;
  if (!gateway) return jsonResponse({ error: "Missing gateway" }, 400);

  // keyToAssetKey/mobileInfoKey bound the key length before decoding (see
  // entityKeyHash), so a malformed or over-long gateway lands here as a 400.
  let ktaKey, infoKey;
  try {
    ktaKey = keyToAssetKey(gateway);
    infoKey = mobileInfoKey(gateway);
  } catch {
    return jsonResponse({ error: "Invalid gateway" }, 400);
  }

  try {
    const [ktaAccount, mobileAccount, fees] = await Promise.all([
      fetchAccount(env, ktaKey),
      fetchAccount(env, infoKey),
      getMobileOnboardFees(env),
    ]);

    const issued = !!ktaAccount;
    const onboarded = !!mobileAccount;
    const info = onboarded ? parseMobileInfo(mobileAccount) : null;

    // The kta account exists as soon as the issue txn confirms, but the DAS
    // indexer (which /onboard's asset+proof reads depend on) can lag by tens
    // of seconds. Report DAS visibility separately so the wizard's post-issue
    // poll waits for `issued && indexed` and never hands the user an
    // onboard build that is doomed to fail on getAsset.
    let indexed = null;
    if (issued) {
      try {
        const assetId = new PublicKey(
          ktaAccount.slice(KTA_ASSET_OFFSET, KTA_ASSET_OFFSET + 32),
        ).toBase58();
        const asset = await fetchAsset(env.SOLANA_RPC_URL, assetId);
        indexed = !!asset?.ownership?.owner;
      } catch {
        indexed = false;
      }
    }

    return jsonResponse({
      issued,
      indexed,
      onboarded,
      has_location: !!info?.location_dec,
      location_dec: info?.location_dec ?? null,
      location_hex: info?.location_dec ? BigInt(info.location_dec).toString(16) : null,
      device_type: info?.device_type ?? null,
      num_location_asserts: info?.num_location_asserts ?? 0,
      fees,
    });
  } catch (err) {
    console.error("mobile-onboard status error:", err.message);
    return jsonResponse({ error: "Status lookup failed" }, 500);
  }
}
