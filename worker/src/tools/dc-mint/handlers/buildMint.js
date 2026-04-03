/**
 * Build an unsigned mint_data_credits_v0 transaction.
 * The user's browser wallet signs and submits it.
 */
import { PublicKey, Connection } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { HNT_DECIMALS } from "../../dc-purchase/lib/constants.js";
import { buildMintInstruction, buildUnsignedTx } from "../lib/solana.js";

export async function handleBuildMint(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, hnt_amount, dc_amount, recipient: recipientStr } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!hnt_amount && !dc_amount) return jsonResponse({ error: "Specify hnt_amount or dc_amount" }, 400);
  if (hnt_amount && dc_amount) return jsonResponse({ error: "Specify only one of hnt_amount or dc_amount" }, 400);
  if (hnt_amount && (typeof hnt_amount !== "number" || !Number.isFinite(hnt_amount) || hnt_amount <= 0)) {
    return jsonResponse({ error: "hnt_amount must be a positive number" }, 400);
  }
  if (dc_amount && (!Number.isInteger(dc_amount) || dc_amount <= 0)) {
    return jsonResponse({ error: "dc_amount must be a positive integer" }, 400);
  }

  let ownerPubkey, recipientPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
    recipientPubkey = recipientStr ? new PublicKey(recipientStr) : ownerPubkey;
  } catch {
    return jsonResponse({ error: "Invalid address" }, 400);
  }

  try {
    const connection = new Connection(env.SOLANA_RPC_URL);
    const mintIx = buildMintInstruction(ownerPubkey, { hnt_amount, dc_amount }, recipientPubkey, HNT_DECIMALS);
    const vtx = await buildUnsignedTx(connection, ownerPubkey, [mintIx]);

    return jsonResponse({
      transaction: Buffer.from(vtx.serialize()).toString("base64"),
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to build mint transaction: ${err.message}` }, 500);
  }
}
