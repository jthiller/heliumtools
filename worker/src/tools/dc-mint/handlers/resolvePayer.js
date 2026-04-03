/**
 * Resolve a payer key to its escrow accounts on both IoT and Mobile subnets,
 * DC balances, and well-known OUI name.
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
  if (!Array.isArray(list)) return [];

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

  const balance = account.data.length >= 72
    ? Number(account.data.readBigUInt64LE(64))
    : 0;

  return { escrow: escrow.toBase58(), balance };
}

export async function handleResolvePayer(payerKey, env) {
  if (!payerKey || payerKey.length < 32 || payerKey.length > 64 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(payerKey)) {
    return jsonResponse({ error: "Invalid payer key (expected base58, 32-64 chars)" }, 400);
  }

  try {
    const connection = new Connection(env.SOLANA_RPC_URL);

    // Check both subnets in parallel
    const [iotResult, mobileResult, wellKnown] = await Promise.all([
      checkEscrow(connection, payerKey, "iot"),
      checkEscrow(connection, payerKey, "mobile"),
      getWellKnownList(env),
    ]);

    const match = wellKnown.find((w) => w.router_key === payerKey);

    return jsonResponse({
      payer: payerKey,
      name: match?.name || null,
      oui: match?.id || null,
      subnets: {
        iot: iotResult,
        mobile: mobileResult,
      },
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to resolve payer: ${err.message}` }, 500);
  }
}
