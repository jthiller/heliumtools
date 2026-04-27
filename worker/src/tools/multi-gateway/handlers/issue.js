/**
 * Construct the issueDataOnlyEntityV0 + onboardDataOnlyIotHotspotV0
 * Solana transactions for a gateway's public key.
 *
 * Returns serialized transactions (base64) for the frontend wallet to sign.
 */
import { PublicKey, ComputeBudgetProgram, VersionedTransaction, TransactionMessage, Connection } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import {
  ECC_VERIFIER_URL,
  DATA_ONLY_CONFIG_KEY,
  CONFIG_COLLECTION_OFFSET,
  CONFIG_MERKLE_OFFSET,
  KTA_ASSET_OFFSET,
  keyToAssetKey,
  iotInfoKey,
  buildIssueInstruction,
  buildOnboardInstruction,
  fetchAsset,
  fetchAssetProof,
  getCanopyDepth,
} from "../../../lib/helium-solana.js";
import { findGateway } from "../lib/findGateway.js";
import { getHost } from "../lib/host.js";

/**
 * Handler: construct issue + onboard transactions for wallet signing.
 * POST /gateways/{mac}/issue
 * Body: { owner: "<solana_address>" }
 */
export async function handleIssueAndOnboard(mac, request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  const found = await findGateway(mac, env);
  if (!found) return jsonResponse({ error: "Gateway not found" }, 404);

  const gatewayPubkey = found.data.public_key;
  const host = getHost(env);
  const writeKey = env.MULTI_GATEWAY_WRITE_API_KEY || env.MULTI_GATEWAY_API_KEY;
  const addRes = await fetch(`http://${host}:${found.port}/gateways/${mac}/add`, {
    method: "POST",
    headers: { "X-API-Key": writeKey, "Content-Type": "application/json" },
    body: JSON.stringify({ owner: ownerStr, payer: ownerStr }),
  });
  if (!addRes.ok) {
    return jsonResponse({ error: "Failed to get gateway add transaction" }, 500);
  }
  const addTxnData = await addRes.json();

  try {
    const connection = new Connection(env.SOLANA_RPC_URL);
    const ktaKey = keyToAssetKey(gatewayPubkey);

    // Fetch key-to-asset, config, and blockhash in parallel.
    // Config and blockhash are only needed if not yet issued, but the
    // config account is static and the wasted RPC call is worth the latency win.
    const [ktaAccount, configAccount, { blockhash }] = await Promise.all([
      connection.getAccountInfo(ktaKey),
      connection.getAccountInfo(DATA_ONLY_CONFIG_KEY),
      connection.getLatestBlockhash(),
    ]);

    if (ktaAccount) {
      return jsonResponse({ gateway: gatewayPubkey, already_issued: true, transactions: [] });
    }

    if (!configAccount) {
      return jsonResponse({ error: "DataOnlyConfig account not found on-chain" }, 500);
    }

    const configData = configAccount.data;
    const collection = new PublicKey(configData.slice(CONFIG_COLLECTION_OFFSET, CONFIG_COLLECTION_OFFSET + 32));
    const merkleTree = new PublicKey(configData.slice(CONFIG_MERKLE_OFFSET, CONFIG_MERKLE_OFFSET + 32));

    const issueIx = buildIssueInstruction(ownerPubkey, gatewayPubkey, merkleTree, collection);
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
        msg: addTxnData.unsigned_msg,
        signature: addTxnData.gateway_signature,
      }),
    });

    if (!verifyRes.ok) {
      const errText = await verifyRes.text();
      return jsonResponse({ error: `ECC verifier failed: ${errText}` }, 500);
    }

    const verifyData = await verifyRes.json();
    const signedWire = Buffer.from(verifyData.transaction, "hex");

    return jsonResponse({
      gateway: gatewayPubkey,
      already_issued: false,
      transactions: [{ type: "issue", transaction: signedWire.toString("base64") }],
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to build transactions: ${err.message}` }, 500);
  }
}

/**
 * Handler: construct onboardDataOnlyIotHotspotV0 transaction.
 * Called after issue succeeds and DAS has indexed the asset.
 * POST /gateways/{mac}/onboard
 * Body: { owner, location, elevation, gain }
 *   location: H3 resolution-12 cell index as hex string (e.g. "8c283474434d1ff")
 *   elevation: altitude in meters (integer)
 *   gain: antenna gain in dBi × 10 (integer, e.g. 12 = 1.2 dBi)
 */
export async function handleOnboard(mac, request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, location, elevation, gain } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!location) return jsonResponse({ error: "Missing location" }, 400);
  if (elevation === null || elevation === undefined) return jsonResponse({ error: "Missing elevation" }, 400);
  if (gain === null || gain === undefined) return jsonResponse({ error: "Missing gain" }, 400);

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  const found = await findGateway(mac, env);
  if (!found) return jsonResponse({ error: "Gateway not found" }, 404);

  const gatewayPubkey = found.data.public_key;

  try {
    const rpcUrl = env.SOLANA_RPC_URL;
    const connection = new Connection(rpcUrl);

    // Batch 1: read keyToAsset, iotInfo, and dataOnlyConfig in parallel
    const ktaKey = keyToAssetKey(gatewayPubkey);
    const [ktaAccount, iotInfoAccount, configAccount] = await Promise.all([
      connection.getAccountInfo(ktaKey),
      connection.getAccountInfo(iotInfoKey(gatewayPubkey)),
      connection.getAccountInfo(DATA_ONLY_CONFIG_KEY),
    ]);

    if (!ktaAccount) {
      return jsonResponse({ error: "Gateway not yet issued on-chain. Run issue step first." }, 400);
    }
    if (iotInfoAccount) {
      return jsonResponse({ gateway: gatewayPubkey, already_onboarded: true });
    }

    const assetId = new PublicKey(ktaAccount.data.slice(KTA_ASSET_OFFSET, KTA_ASSET_OFFSET + 32)).toBase58();
    const merkleTree = new PublicKey(configAccount.data.slice(CONFIG_MERKLE_OFFSET, CONFIG_MERKLE_OFFSET + 32));

    // Batch 2: DAS calls, blockhash, and merkle tree account all in parallel
    const [asset, proof, { blockhash }, treeAccount] = await Promise.all([
      fetchAsset(rpcUrl, assetId),
      fetchAssetProof(rpcUrl, assetId),
      connection.getLatestBlockhash(),
      connection.getAccountInfo(merkleTree),
    ]);

    if (!treeAccount) {
      return jsonResponse({ error: "Merkle tree account not found" }, 500);
    }
    const canopyDepth = getCanopyDepth(treeAccount.data);

    const onboardIx = buildOnboardInstruction(
      ownerPubkey, gatewayPubkey, merkleTree, asset, proof, canopyDepth,
      { location, elevation, gain },
    );

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    const message = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: blockhash,
      instructions: [computeBudgetIx, computePriceIx, onboardIx],
    }).compileToLegacyMessage();

    const vtx = new VersionedTransaction(message);

    return jsonResponse({
      gateway: gatewayPubkey,
      already_onboarded: false,
      transaction: Buffer.from(vtx.serialize()).toString("base64"),
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to build onboard transaction: ${err.message}` }, 500);
  }
}
