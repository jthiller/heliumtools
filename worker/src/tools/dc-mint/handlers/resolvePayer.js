/**
 * Resolve a payer key to its escrow account, DC balance, subnet, and well-known name.
 * Tries IoT SubDAO first, falls back to Mobile SubDAO.
 */
import { Connection } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { delegatedDcPda, escrowPda } from "../lib/solana.js";
import { WELL_KNOWN_OUIS_URL } from "../../oui-notifier/config.js";

const KV_WELL_KNOWN_KEY = "dc-mint-well-known-ouis";
const KV_CACHE_TTL = 3600;

async function getWellKnownList(env) {
  if (env.KV) {
    try {
      const cached = await env.KV.get(KV_WELL_KNOWN_KEY, "json");
      if (cached) return cached;
    } catch { /* ignore */ }
  }

  const res = await fetch(WELL_KNOWN_OUIS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) return [];
  const list = await res.json();

  if (env.KV) {
    try { await env.KV.put(KV_WELL_KNOWN_KEY, JSON.stringify(list), { expirationTtl: KV_CACHE_TTL }); }
    catch { /* ignore */ }
  }

  return list;
}

async function checkEscrow(connection, payerKey, subnet) {
  const delDc = await delegatedDcPda(payerKey, subnet);
  const escrow = escrowPda(delDc);
  const account = await connection.getAccountInfo(escrow);
  if (!account) return null;

  // Parse DC balance from the token account (SPL Token layout: mint(32) + owner(32) + amount(u64 LE at offset 64))
  const balance = account.data.length >= 72
    ? Number(account.data.readBigUInt64LE(64))
    : 0;

  return { escrow: escrow.toBase58(), balance, subnet };
}

export async function handleResolvePayer(payerKey, env) {
  if (!payerKey || payerKey.length < 32) {
    return jsonResponse({ error: "Invalid payer key" }, 400);
  }

  try {
    const connection = new Connection(env.SOLANA_RPC_URL);

    // Try IoT first, then Mobile
    let result = await checkEscrow(connection, payerKey, "iot");
    if (!result) {
      result = await checkEscrow(connection, payerKey, "mobile");
    }

    // Look up well-known name
    const wellKnown = await getWellKnownList(env);
    const match = wellKnown.find((w) => w.router_key === payerKey);

    return jsonResponse({
      payer: payerKey,
      subnet: result?.subnet || null,
      escrow: result?.escrow || null,
      balance: result?.balance ?? null,
      name: match?.name || null,
      oui: match?.id || null,
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to resolve payer: ${err.message}` }, 500);
  }
}
