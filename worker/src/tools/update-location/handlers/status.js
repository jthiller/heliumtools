import { jsonResponse } from "../../../lib/response.js";
import { keyToAssetKey, iotInfoKey, parseIotInfo } from "../../../lib/helium-solana.js";
import { fetchAccount } from "../../hotspot-claimer/services/common.js";
import { getOnboardFees } from "../../iot-onboard/services/fees.js";

/**
 * POST /status
 * Body: { gateway_pubkey }   // Helium-format entity key (the Hotspot pubkey)
 *
 * Reads the keyToAsset + iotInfo PDAs and returns the Hotspot's current
 * on-chain asserted location / elevation / gain (so the editor can pre-fill),
 * its device type (full vs data-only), and the current location-assert fees.
 */
export async function handleStatus(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { gateway_pubkey } = body;
  if (!gateway_pubkey) return jsonResponse({ error: "Missing gateway_pubkey" }, 400);

  let ktaKey, infoKey;
  try {
    ktaKey = keyToAssetKey(gateway_pubkey);
    infoKey = iotInfoKey(gateway_pubkey);
  } catch {
    return jsonResponse({ error: "Invalid gateway_pubkey" }, 400);
  }

  try {
    const [ktaAccount, iotAccount, fees] = await Promise.all([
      fetchAccount(env, ktaKey),
      fetchAccount(env, infoKey),
      getOnboardFees(env),
    ]);

    const issued = !!ktaAccount;
    const onboarded = !!iotAccount;
    const info = onboarded ? parseIotInfo(iotAccount) : null;
    const device_type = info?.is_full_hotspot ? "full" : "data_only";

    return jsonResponse({
      issued,
      onboarded,
      has_location: !!info?.location_dec,
      location_dec: info?.location_dec ?? null,
      location_hex: info?.location_dec ? BigInt(info.location_dec).toString(16) : null,
      elevation: info?.elevation ?? null,
      gain: info?.gain ?? null,
      num_location_asserts: info?.num_location_asserts ?? 0,
      device_type,
      fees,
    });
  } catch (err) {
    console.error("update-location status error:", err.message);
    return jsonResponse({ error: "Status lookup failed" }, 500);
  }
}
