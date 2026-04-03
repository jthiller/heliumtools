/**
 * Build an unsigned delegate_data_credits_v0 transaction.
 * Supports OUI number or direct payer key. When hnt_amount is provided,
 * combines mint + delegate in a single atomic transaction.
 */
import { PublicKey, Connection } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { HNT_DECIMALS } from "../../dc-purchase/lib/constants.js";
import { getOuiByNumber } from "../../oui-notifier/services/ouis.js";
import {
  buildMintInstruction, buildDelegateInstruction, buildUnsignedTx,
} from "../lib/solana.js";

export async function handleBuildDelegate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, amount, oui, payer_key, subnet = "iot", hnt_amount } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!oui && !payer_key) return jsonResponse({ error: "Specify oui or payer_key" }, 400);
  if (!amount || !Number.isInteger(amount) || amount <= 0) {
    return jsonResponse({ error: "amount (positive integer DC) is required" }, 400);
  }
  if (hnt_amount && (typeof hnt_amount !== "number" || !Number.isFinite(hnt_amount) || hnt_amount <= 0)) {
    return jsonResponse({ error: "hnt_amount must be a positive number" }, 400);
  }
  if (subnet !== "iot" && subnet !== "mobile") {
    return jsonResponse({ error: "subnet must be 'iot' or 'mobile'" }, 400);
  }

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  try {
    // Resolve router key from OUI or use direct payer key
    let routerKey;
    if (oui) {
      const ouiNum = parseInt(oui, 10);
      if (!ouiNum || ouiNum <= 0) return jsonResponse({ error: "Invalid OUI number" }, 400);
      const ouiData = await getOuiByNumber(env, ouiNum);
      if (!ouiData?.payer) return jsonResponse({ error: `OUI ${oui} not found or has no payer key` }, 404);
      routerKey = ouiData.payer;
    } else {
      // Validate payer_key is not garbage (it'll be hashed for the PDA, so any string "works",
      // but we want to catch obvious mistakes before the user pays a tx fee)
      if (!payer_key || payer_key.length < 32) {
        return jsonResponse({ error: "Invalid payer key" }, 400);
      }
      routerKey = payer_key;
    }

    const connection = new Connection(env.SOLANA_RPC_URL);
    const instructions = [];

    // If hnt_amount provided, add mint instruction first (atomic mint+delegate)
    if (hnt_amount) {
      instructions.push(buildMintInstruction(ownerPubkey, { hnt_amount }, ownerPubkey, HNT_DECIMALS));
    }

    const { instruction: delegateIx, escrow } = await buildDelegateInstruction(
      ownerPubkey, amount, routerKey, subnet,
    );
    instructions.push(delegateIx);

    const vtx = await buildUnsignedTx(connection, ownerPubkey, instructions);

    return jsonResponse({
      transaction: Buffer.from(vtx.serialize()).toString("base64"),
      oui: oui ? parseInt(oui, 10) : undefined,
      payer: routerKey,
      escrow,
      subnet,
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to build delegate transaction: ${err.message}` }, 500);
  }
}
