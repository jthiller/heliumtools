import { getOuiByNumber } from "../../oui-notifier/services/ouis.js";
import { fetchEscrowBalanceDC } from "../../oui-notifier/services/solana.js";
import { jsonResponse } from "../../../lib/response.js";

export async function handleResolveOui(_request, env, ouiStr) {
  const oui = Number(ouiStr);
  if (!Number.isInteger(oui)) {
    return jsonResponse({ error: "Invalid OUI" }, 400);
  }

  const record = await getOuiByNumber(env, oui);
  if (!record) {
    return jsonResponse({ error: "OUI not found" }, 404);
  }

  // Fetch live balance from Solana RPC
  let escrowDcBalance = null;
  if (record.escrow) {
    try {
      const balanceDc = await fetchEscrowBalanceDC(env, record.escrow);
      escrowDcBalance = String(balanceDc);
    } catch (err) {
      console.warn(`Failed to fetch escrow balance for OUI ${oui}:`, err.message);
    }
  }

  return jsonResponse({
    oui: record.oui,
    payer: record.payer,
    escrow: record.escrow,
    escrowDcBalance,
  });
}
