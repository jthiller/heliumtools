import { PublicKey, ComputeBudgetProgram, VersionedTransaction, TransactionMessage, Connection } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import {
  ECC_VERIFIER_URL,
  DATA_ONLY_CONFIG_KEY,
  CONFIG_COLLECTION_OFFSET,
  CONFIG_MERKLE_OFFSET,
  keyToAssetKey,
  buildIssueInstruction,
} from "../../../lib/helium-solana.js";

/**
 * POST /issue
 * Body: { owner, gateway_pubkey, add_gateway_response: { unsigned_msg, gateway_signature } }
 *
 * Build the issueDataOnlyEntityV0 transaction, send through ECC verifier,
 * return the co-signed transaction for the user's wallet to sign.
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

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  try {
    const connection = new Connection(env.SOLANA_RPC_URL);
    const ktaKey = keyToAssetKey(gateway_pubkey);

    const [ktaAccount, configAccount, { blockhash }] = await Promise.all([
      connection.getAccountInfo(ktaKey),
      connection.getAccountInfo(DATA_ONLY_CONFIG_KEY),
      connection.getLatestBlockhash(),
    ]);

    if (ktaAccount) {
      return jsonResponse({ already_issued: true });
    }

    if (!configAccount) {
      return jsonResponse({ error: "DataOnlyConfig account not found on-chain" }, 500);
    }

    const configData = configAccount.data;
    const collection = new PublicKey(configData.slice(CONFIG_COLLECTION_OFFSET, CONFIG_COLLECTION_OFFSET + 32));
    const merkleTree = new PublicKey(configData.slice(CONFIG_MERKLE_OFFSET, CONFIG_MERKLE_OFFSET + 32));

    const issueIx = buildIssueInstruction(ownerPubkey, gateway_pubkey, merkleTree, collection);
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    const message = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: blockhash,
      instructions: [computeBudgetIx, computePriceIx, issueIx],
    }).compileToLegacyMessage();

    const vtx = new VersionedTransaction(message);
    const serializedTx = Buffer.from(vtx.serialize()).toString("hex");

    const verifyRes = await fetch(`${ECC_VERIFIER_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction: serializedTx,
        msg: add_gateway_txn,
        signature: add_gateway_txn,
      }),
    });

    if (!verifyRes.ok) {
      console.error("ECC verifier error:", verifyRes.status, await verifyRes.text());
      return jsonResponse({ error: "ECC verifier rejected the gateway signature" }, 500);
    }

    const verifyData = await verifyRes.json();
    const signedWire = Buffer.from(verifyData.transaction, "hex");

    return jsonResponse({
      already_issued: false,
      transaction: signedWire.toString("base64"),
    });
  } catch (err) {
    console.error("Issue error:", err.message, err.stack);
    return jsonResponse({ error: "Failed to build issue transaction" }, 500);
  }
}
