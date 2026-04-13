import { PublicKey } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { keyToAssetKey, iotInfoKey } from "../../../lib/helium-solana.js";
import { fetchAccount } from "../../hotspot-claimer/services/common.js";

const ONBOARDING_API = "https://onboarding.dewi.org/api/v3";

/**
 * POST /onboard
 * Body: { owner, gateway_pubkey, user_pays?, location?, elevation?, gain? }
 *   user_pays?: when true, owner pays DC; otherwise the maker covers DC and SOL
 *   location?: H3 resolution-12 cell index as hex string
 *   elevation?: altitude in meters
 *   gain?: antenna gain in dBi × 10
 *
 * Forwards to the Helium onboarding server which builds the appropriate
 * Solana transactions based on the maker's configuration (full PoC vs data-only).
 */
export async function handleOnboard(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, gateway_pubkey, location, elevation, gain, user_pays } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!gateway_pubkey) return jsonResponse({ error: "Missing gateway_pubkey" }, 400);
  if (location !== undefined && location !== null && !/^[0-9a-fA-F]+$/.test(location)) {
    return jsonResponse({ error: "Invalid location (must be hex H3 cell index)" }, 400);
  }

  try {
    new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  try {
    const [ktaAccount, iotAccount] = await Promise.all([
      fetchAccount(env, keyToAssetKey(gateway_pubkey)),
      fetchAccount(env, iotInfoKey(gateway_pubkey)),
    ]);

    if (!ktaAccount) {
      return jsonResponse({ error: "Gateway not yet issued on-chain. Run issue step first." }, 400);
    }
    if (iotAccount && !location) {
      return jsonResponse({ already_onboarded: true });
    }

    // Convert H3 hex string to decimal (onboarding server expects decimal u64)
    const locationDecimal = location ? BigInt("0x" + location).toString() : undefined;

    // Only set `payer` when the user is paying DC (data-only mode or insufficient maker DC).
    // Omitting `payer` makes the maker cover both DC and SOL fees.
    const payload = { entityKey: gateway_pubkey };
    if (user_pays) payload.payer = ownerStr;
    if (locationDecimal !== undefined) payload.location = locationDecimal;
    if (elevation !== undefined && elevation !== null) payload.elevation = elevation;
    if (gain !== undefined && gain !== null) payload.gain = gain;

    const res = await fetch(`${ONBOARDING_API}/transactions/iot/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Onboarding server error:", res.status, errText);
      return jsonResponse({
        error: `Onboarding server error (${res.status})`,
      }, 500);
    }

    const data = await res.json();
    if (data?.errorMessage) {
      console.error("Onboarding server errorMessage:", data.errorMessage);
      return jsonResponse({ error: data.errorMessage }, 500);
    }

    const solanaTransactions = data?.data?.solanaTransactions;
    if (!Array.isArray(solanaTransactions) || solanaTransactions.length === 0) {
      return jsonResponse({ error: "Onboarding server returned no transactions" }, 500);
    }

    const transactions = solanaTransactions.map((txBytes) =>
      Buffer.from(txBytes).toString("base64")
    );

    return jsonResponse({
      already_onboarded: false,
      transactions,
    });
  } catch (err) {
    console.error("Onboard error:", err.message, err.stack);
    return jsonResponse({ error: "Failed to build onboard transaction" }, 500);
  }
}
