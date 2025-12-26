import { getOuiByNumber } from "../../oui-notifier/services/ouis.js";
import { fetchEscrowBalanceDC } from "../../oui-notifier/services/solana.js";

export async function handleResolveOui(_request, env, ouiStr) {
  const oui = Number(ouiStr);
  if (!Number.isInteger(oui)) {
    return new Response(JSON.stringify({ error: "Invalid OUI" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const record = await getOuiByNumber(env, oui);
  if (!record) {
    return new Response(JSON.stringify({ error: "OUI not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
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

  return new Response(
    JSON.stringify({
      oui: record.oui,
      payer: record.payer,
      escrow: record.escrow,
      escrowDcBalance,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }
  );
}
