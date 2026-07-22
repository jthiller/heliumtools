import { PublicKey, ComputeBudgetProgram, VersionedTransaction, TransactionMessage, Connection } from "@solana/web3.js";
import bs58 from "bs58";
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
 * Body: {
 *   owner:             connected wallet (Solana base58) — payer + recipient
 *   gateway:           Helium-format entity key (the generated Hotspot pubkey)
 *   unsigned_msg:      hex — the AddGatewayV1 protobuf with signature fields cleared
 *   gateway_signature: hex — the gateway key's ed25519 signature over unsigned_msg
 * }
 *
 * Builds the issue_data_only_entity_v0 transaction (the same instruction IoT
 * data-only entities use — data-only entities share the HNT-DAO config across
 * networks) and has the Helium ECC verifier co-sign it after checking the
 * gateway signature. The frontend derives unsigned_msg + gateway_signature
 * from the onboarding token (browser-generated or pasted from the
 * `helium-wallet hotspots add mobile token` CLI).
 *
 * Adapted from multi-gateway/handlers/issue.js handleIssueAndOnboard — same
 * flow, but the add-gateway material arrives from the client instead of the
 * multi-gateway fork's /add endpoint.
 */
export async function handleIssue(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, gateway, unsigned_msg, gateway_signature } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!gateway) return jsonResponse({ error: "Missing gateway" }, 400);
  if (!unsigned_msg || !gateway_signature) {
    return jsonResponse({ error: "Missing unsigned_msg or gateway_signature" }, 400);
  }

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  // The AddGatewayV1 message is tiny (a few dozen bytes); the signature is a
  // 64-byte ed25519. Bound both so a hostile payload can't be relayed to the
  // verifier at size.
  if (typeof unsigned_msg !== "string" || !/^[0-9a-fA-F]{2,2048}$/.test(unsigned_msg)) {
    return jsonResponse({ error: "Invalid unsigned_msg — expected hex" }, 400);
  }
  if (typeof gateway_signature !== "string" || !/^[0-9a-fA-F]{2,256}$/.test(gateway_signature)) {
    return jsonResponse({ error: "Invalid gateway_signature — expected hex" }, 400);
  }

  // Sanity: the gateway's Helium binary address is embedded verbatim in the
  // protobuf, so it must appear in the message we forward. The protobuf field
  // is the 33-byte bin form (tag + pubkey) — the b58check decode's version
  // byte and 4-byte checksum are NOT part of it, so slice them off before
  // comparing. Catches a token/key mixup before the verifier rejects it
  // opaquely.
  let ktaKey;
  try {
    ktaKey = keyToAssetKey(gateway);
    const decoded = bs58.decode(gateway); // [version, tag, pubkey(32), checksum(4)]
    const gatewayBinHex = Buffer.from(decoded.slice(1, decoded.length - 4)).toString("hex").toLowerCase();
    if (!unsigned_msg.toLowerCase().includes(gatewayBinHex)) {
      return jsonResponse({ error: "gateway does not match unsigned_msg" }, 400);
    }
  } catch {
    return jsonResponse({ error: "Invalid gateway" }, 400);
  }

  try {
    const connection = new Connection(env.SOLANA_RPC_URL);

    const [ktaAccount, configAccount, { blockhash }] = await Promise.all([
      connection.getAccountInfo(ktaKey),
      connection.getAccountInfo(DATA_ONLY_CONFIG_KEY),
      connection.getLatestBlockhash(),
    ]);

    if (ktaAccount) {
      return jsonResponse({ gateway, already_issued: true });
    }
    if (!configAccount) {
      return jsonResponse({ error: "DataOnlyConfig account not found on-chain" }, 500);
    }

    const configData = configAccount.data;
    const collection = new PublicKey(configData.slice(CONFIG_COLLECTION_OFFSET, CONFIG_COLLECTION_OFFSET + 32));
    const merkleTree = new PublicKey(configData.slice(CONFIG_MERKLE_OFFSET, CONFIG_MERKLE_OFFSET + 32));

    const issueIx = buildIssueInstruction(ownerPubkey, gateway, merkleTree, collection);
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    // Legacy message — the ECC verifier deserializes the wire format with
    // bincode; multi-gateway established that legacy encoding round-trips.
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
        msg: unsigned_msg,
        signature: gateway_signature,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!verifyRes.ok) {
      const errText = await verifyRes.text();
      return jsonResponse({ error: `ECC verifier failed: ${errText}` }, 502);
    }

    const verifyData = await verifyRes.json();
    const signedWire = Buffer.from(verifyData.transaction, "hex");

    return jsonResponse({
      gateway,
      already_issued: false,
      transaction: signedWire.toString("base64"),
    });
  } catch (err) {
    console.error("mobile-onboard issue error:", err.message);
    return jsonResponse({ error: `Failed to build issue transaction: ${err.message}` }, 500);
  }
}
