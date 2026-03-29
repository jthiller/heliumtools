/**
 * Construct the issueDataOnlyEntityV0 + onboardDataOnlyIotHotspotV0
 * Solana transactions for a gateway's public key.
 *
 * Returns serialized transactions (base64) for the frontend wallet to sign.
 */
import { PublicKey, ComputeBudgetProgram, VersionedTransaction, TransactionMessage, TransactionInstruction, SystemProgram, Connection } from "@solana/web3.js";
import { sha256 } from "js-sha256";
import bs58 from "bs58";
import { jsonResponse } from "../../../lib/response.js";
import { findGateway } from "../lib/findGateway.js";

// ECC Verifier
const ECC_VERIFIER = new PublicKey("eccSAJM3tq7nQSpQTm8roxv4FPoipCkMsGizW2KBhqZ");
const ECC_VERIFIER_URL = "https://ecc-verifier.web.helium.io";

// Program IDs
const ENTITY_MANAGER = new PublicKey("hemjuPXBpNvggtaUnN1MwT3wrdhttKEfosTcc2P9Pg8");
const SUB_DAOS = new PublicKey("hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR");
const BUBBLEGUM = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
const COMPRESSION = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const DATA_CREDITS = new PublicKey("credMBJhYFzfn7NxBMdU4aUqFggAjgztaCcv2Fo6fPT");
const TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SPL_NOOP = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
const SPL_TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SPL_ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const HNT_MINT = new PublicKey("hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux");
const IOT_MINT = new PublicKey("iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns");
const DC_MINT = new PublicKey("dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm");

// PDA helpers
function findPDA(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

// Static PDAs — derived from constants, computed once at module load
const DAO_KEY = findPDA([Buffer.from("dao"), HNT_MINT.toBuffer()], SUB_DAOS);
const IOT_SUB_DAO_KEY = findPDA([Buffer.from("sub_dao"), IOT_MINT.toBuffer()], SUB_DAOS);
const DATA_ONLY_CONFIG_KEY = findPDA([Buffer.from("data_only_config"), DAO_KEY.toBuffer()], ENTITY_MANAGER);
const DATA_ONLY_ESCROW_KEY = findPDA([Buffer.from("data_only_escrow"), DATA_ONLY_CONFIG_KEY.toBuffer()], ENTITY_MANAGER);
const ENTITY_CREATOR_KEY = findPDA([Buffer.from("entity_creator"), DAO_KEY.toBuffer()], ENTITY_MANAGER);
const REWARDABLE_ENTITY_CONFIG_KEY = findPDA([Buffer.from("rewardable_entity_config"), IOT_SUB_DAO_KEY.toBuffer(), Buffer.from("IOT")], ENTITY_MANAGER);
const DC_KEY = findPDA([Buffer.from("dc"), DC_MINT.toBuffer()], DATA_CREDITS);
const BUBBLEGUM_SIGNER_KEY = findPDA([Buffer.from("collection_cpi")], BUBBLEGUM);

function entityKeyHash(gatewayPubkeyB58) {
  const bytes = bs58.decode(gatewayPubkeyB58);
  return Buffer.from(sha256.arrayBuffer(bytes));
}

// Dynamic PDAs — depend on runtime arguments
function keyToAssetKey(gatewayPubkeyB58) {
  return findPDA([Buffer.from("key_to_asset"), DAO_KEY.toBuffer(), entityKeyHash(gatewayPubkeyB58)], ENTITY_MANAGER);
}

function iotInfoKey(gatewayPubkeyB58) {
  return findPDA([Buffer.from("iot_info"), REWARDABLE_ENTITY_CONFIG_KEY.toBuffer(), entityKeyHash(gatewayPubkeyB58)], ENTITY_MANAGER);
}

function collectionMetadataKey(collection) {
  return findPDA([Buffer.from("metadata"), TOKEN_METADATA.toBuffer(), collection.toBuffer()], TOKEN_METADATA);
}

function collectionMasterEditionKey(collection) {
  return findPDA([Buffer.from("metadata"), TOKEN_METADATA.toBuffer(), collection.toBuffer(), Buffer.from("edition")], TOKEN_METADATA);
}

function treeAuthorityKey(merkleTree) {
  return findPDA([merkleTree.toBuffer()], BUBBLEGUM);
}

function ataAddress(owner, mint) {
  return findPDA([owner.toBuffer(), SPL_TOKEN.toBuffer(), mint.toBuffer()], SPL_ATA);
}

// Anchor discriminators (first 8 bytes of sha256("global:<instruction_name>"))
function anchorDiscriminator(name) {
  const hash = sha256(`global:${name}`);
  return Buffer.from(hash.slice(0, 16), "hex");
}

/**
 * Build the issueDataOnlyEntityV0 instruction.
 */
function buildIssueInstruction(owner, gatewayPubkeyB58, merkleTree, collection) {
  const entityKey = bs58.decode(gatewayPubkeyB58);

  // Serialize args: IssueDataOnlyEntityArgsV0 { entity_key: Vec<u8> }
  // Anchor format: discriminator(8) + borsh(Vec<u8>) = disc + u32_le(len) + bytes
  const disc = anchorDiscriminator("issue_data_only_entity_v0");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(entityKey.length);
  const data = Buffer.concat([disc, lenBuf, Buffer.from(entityKey)]);

  const accounts = [
    { pubkey: owner, isSigner: true, isWritable: true },                    // payer
    { pubkey: ECC_VERIFIER, isSigner: true, isWritable: false }, // ecc_verifier
    { pubkey: collection, isSigner: false, isWritable: false },              // collection
    { pubkey: collectionMetadataKey(collection), isSigner: false, isWritable: true }, // collection_metadata
    { pubkey: collectionMasterEditionKey(collection), isSigner: false, isWritable: false }, // collection_master_edition
    { pubkey: DATA_ONLY_CONFIG_KEY, isSigner: false, isWritable: true },      // data_only_config
    { pubkey: ENTITY_CREATOR_KEY, isSigner: false, isWritable: false },      // entity_creator
    { pubkey: DAO_KEY, isSigner: false, isWritable: false },                 // dao
    { pubkey: keyToAssetKey(gatewayPubkeyB58), isSigner: false, isWritable: true }, // key_to_asset
    { pubkey: treeAuthorityKey(merkleTree), isSigner: false, isWritable: true }, // tree_authority
    { pubkey: owner, isSigner: false, isWritable: false },                   // recipient
    { pubkey: merkleTree, isSigner: false, isWritable: true },               // merkle_tree
    { pubkey: DATA_ONLY_ESCROW_KEY, isSigner: false, isWritable: true },     // data_only_escrow
    { pubkey: BUBBLEGUM_SIGNER_KEY, isSigner: false, isWritable: false },    // bubblegum_signer
    { pubkey: TOKEN_METADATA, isSigner: false, isWritable: false },          // token_metadata_program
    { pubkey: SPL_NOOP, isSigner: false, isWritable: false },                // log_wrapper
    { pubkey: BUBBLEGUM, isSigner: false, isWritable: false },               // bubblegum_program
    { pubkey: COMPRESSION, isSigner: false, isWritable: false },             // compression_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
  ];

  return new TransactionInstruction({ keys: accounts, programId: ENTITY_MANAGER, data });
}

// Borsh Option encoding helpers
function encodeOptionU64(hexStr) {
  if (!hexStr) return Buffer.from([0]);
  const buf = Buffer.alloc(9);
  buf[0] = 1;
  buf.writeBigUInt64LE(BigInt("0x" + hexStr), 1);
  return buf;
}

function encodeOptionI32(value) {
  if (value === null || value === undefined) return Buffer.from([0]);
  const buf = Buffer.alloc(5);
  buf[0] = 1;
  buf.writeInt32LE(value, 1);
  return buf;
}

/**
 * Build the onboardDataOnlyIotHotspotV0 instruction.
 * Requires the asset's compression proof from DAS.
 *
 * @param {PublicKey} owner
 * @param {string} gatewayPubkeyB58
 * @param {PublicKey} merkleTree
 * @param {object} asset - DAS getAsset response
 * @param {object} proof - { root: string (base58), proof: string[] }
 * @param {number} canopyDepth - number of proof nodes to trim (stored on-chain)
 * @param {{ location?: string, elevation?: number, gain?: number }} opts
 */
function buildOnboardInstruction(owner, gatewayPubkeyB58, merkleTree, asset, proof, canopyDepth, opts = {}) {
  const disc = anchorDiscriminator("onboard_data_only_iot_hotspot_v0");

  const dataHash = Buffer.from(asset.compression.data_hash.replace("0x", ""), "hex");
  const creatorHash = Buffer.from(asset.compression.creator_hash.replace("0x", ""), "hex");
  const root = Buffer.from(bs58.decode(proof.root));
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(asset.compression.leaf_id);

  // IDL field order: dataHash, creatorHash, root, index, location, elevation, gain
  const data = Buffer.concat([
    disc, dataHash, creatorHash, root, indexBuf,
    encodeOptionU64(opts.location),       // H3 cell hex string → u64
    encodeOptionI32(opts.elevation),      // meters
    encodeOptionI32(opts.gain),           // dBi × 10
  ]);

  const accounts = [
    { pubkey: owner, isSigner: true, isWritable: true },                     // payer
    { pubkey: owner, isSigner: true, isWritable: true },                     // dc_fee_payer
    { pubkey: iotInfoKey(gatewayPubkeyB58), isSigner: false, isWritable: true }, // iot_info
    { pubkey: owner, isSigner: true, isWritable: true },                     // hotspot_owner
    { pubkey: merkleTree, isSigner: false, isWritable: false },              // merkle_tree
    { pubkey: ataAddress(owner, DC_MINT), isSigner: false, isWritable: true }, // dc_burner
    { pubkey: REWARDABLE_ENTITY_CONFIG_KEY, isSigner: false, isWritable: false }, // rewardable_entity_config
    { pubkey: DATA_ONLY_CONFIG_KEY, isSigner: false, isWritable: false },    // data_only_config
    { pubkey: DAO_KEY, isSigner: false, isWritable: false },                 // dao
    { pubkey: keyToAssetKey(gatewayPubkeyB58), isSigner: false, isWritable: false }, // key_to_asset
    { pubkey: IOT_SUB_DAO_KEY, isSigner: false, isWritable: true },          // sub_dao
    { pubkey: DC_MINT, isSigner: false, isWritable: true },                  // dc_mint
    { pubkey: DC_KEY, isSigner: false, isWritable: false },                  // dc
    { pubkey: COMPRESSION, isSigner: false, isWritable: false },             // compression_program
    { pubkey: DATA_CREDITS, isSigner: false, isWritable: false },            // data_credits_program
    { pubkey: SPL_TOKEN, isSigner: false, isWritable: false },               // token_program
    { pubkey: SPL_ATA, isSigner: false, isWritable: false },                 // associated_token_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    { pubkey: SUB_DAOS, isSigner: false, isWritable: false },                // helium_sub_daos_program
  ];

  // Proof accounts, trimmed by canopy depth (upper nodes are stored on-chain)
  const proofPath = proof.proof.slice(0, proof.proof.length - canopyDepth);
  for (const proofKey of proofPath) {
    accounts.push({ pubkey: new PublicKey(proofKey), isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({ keys: accounts, programId: ENTITY_MANAGER, data });
}

// ---- DAS API helpers ----

async function fetchAsset(rpcUrl, assetId) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: assetId } }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`getAsset: ${data.error.message}`);
  return data.result;
}

async function fetchAssetProof(rpcUrl, assetId) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAssetProof", params: { id: assetId } }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`getAssetProof: ${data.error.message}`);
  return data.result;
}

/**
 * Compute canopy depth from merkle tree account data.
 * SPL Account Compression layout:
 *   header(56) + tree(24 + maxBufferSize * (40 + maxDepth*32) + maxDepth*32) + canopy
 */
function getCanopyDepth(treeAccountData) {
  const maxBufferSize = treeAccountData.readUInt32LE(2);
  const maxDepth = treeAccountData.readUInt32LE(6);
  const headerSize = 56; // accountType(1) + version(1) + maxBufferSize(4) + maxDepth(4) + authority(32) + creationSlot(8) + padding(6)
  const changeLogEntrySize = 32 + maxDepth * 32 + 4 + 4;
  const treeDataSize = 24 + maxBufferSize * changeLogEntrySize + maxDepth * 32;
  const canopyBytes = treeAccountData.length - headerSize - treeDataSize;
  if (canopyBytes <= 0) return 0;
  return Math.floor(Math.log2(canopyBytes / 32 + 2)) - 1;
}

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
  const host = env.MULTI_GATEWAY_HOST || "hotspot.heliumtools.org";
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

    // DataOnlyConfigV0 layout: discriminator(8) + authority(32) + bumpSeed(1) + collection(32) + merkleTree(32)
    const COLLECTION_OFFSET = 8 + 32 + 1;
    const MERKLE_OFFSET = COLLECTION_OFFSET + 32;
    const configData = configAccount.data;
    const collection = new PublicKey(configData.slice(COLLECTION_OFFSET, COLLECTION_OFFSET + 32));
    const merkleTree = new PublicKey(configData.slice(MERKLE_OFFSET, MERKLE_OFFSET + 32));

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
 * Body: { owner, location?, elevation?, gain? }
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

    // KeyToAssetV0 layout: discriminator(8) + asset(32) + ...
    const assetId = new PublicKey(ktaAccount.data.slice(8, 40)).toBase58();
    const MERKLE_OFFSET = 8 + 32 + 1 + 32;
    const merkleTree = new PublicKey(configAccount.data.slice(MERKLE_OFFSET, MERKLE_OFFSET + 32));

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
      { location: location || null, elevation: elevation ?? null, gain: gain ?? null },
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
