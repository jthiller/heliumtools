import { PublicKey } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { keyToAssetKey } from "../../../lib/helium-solana.js";
import { fetchAccount } from "../../hotspot-claimer/services/common.js";

const ONBOARDING_API = "https://onboarding.dewi.org/api/v3";

/**
 * POST /issue
 * Body: { owner, gateway_pubkey, add_gateway_txn }
 *
 * Forwards the BLE-signed add_gateway transaction to the Helium onboarding
 * server, which returns ready-to-sign Solana transactions for issuing the
 * compressed NFT entity.
 */
export async function handleIssue(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, gateway_pubkey, add_gateway_txn } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!gateway_pubkey) return jsonResponse({ error: "Missing gateway_pubkey" }, 400);
  if (!add_gateway_txn) {
    return jsonResponse({ error: "Missing add_gateway_txn (hex-encoded BLE response)" }, 400);
  }

  try {
    new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  try {
    // Short-circuit if already issued
    const ktaAccount = await fetchAccount(env, keyToAssetKey(gateway_pubkey));
    if (ktaAccount) {
      return jsonResponse({ already_issued: true });
    }

    // The BLE returns a base64-encoded signed AddGatewayV1 protobuf.
    // Pass it through to the onboarding server as-is.
    const res = await fetch(`${ONBOARDING_API}/transactions/create-hotspot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: add_gateway_txn }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Onboarding server error:", res.status, errText);
      return jsonResponse({
        error: `Onboarding server rejected the Hotspot signature (${res.status})`,
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

    // Return the transactions as base64 strings for the frontend to sign
    const transactions = solanaTransactions.map((txBytes) =>
      Buffer.from(txBytes).toString("base64")
    );

    return jsonResponse({
      already_issued: false,
      transactions,
    });
  } catch (err) {
    console.error("Issue error:", err.message, err.stack);
    return jsonResponse({ error: "Failed to build issue transaction" }, 500);
  }
}
