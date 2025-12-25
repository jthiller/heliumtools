import { getOuiByNumber } from "../../oui-notifier/services/ouis.js";

async function fetchLatestBalance(env, oui) {
  const row = await env.DB.prepare(
    `SELECT balance_dc, fetched_at FROM oui_balances WHERE oui = ? ORDER BY date DESC LIMIT 1`
  )
    .bind(oui)
    .first();
  if (!row) return { balance: null, fetchedAt: null };
  return { balance: String(row.balance_dc), fetchedAt: row.fetched_at || null };
}

export async function handleResolveOui(_request, env, ouiStr) {
  const oui = Number(ouiStr);
  if (!Number.isInteger(oui)) {
    return new Response(JSON.stringify({ error: "Invalid OUI" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const record = await getOuiByNumber(env, oui);
  if (!record) {
    return new Response(JSON.stringify({ error: "OUI not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { balance, fetchedAt } = await fetchLatestBalance(env, oui);

  return new Response(
    JSON.stringify({
      oui: record.oui,
      payer: record.payer,
      escrow: record.escrow,
      escrowDcBalance: balance,
      escrowDcBalanceUsd: null,
      balanceLastUpdated: fetchedAt,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }
  );
}
