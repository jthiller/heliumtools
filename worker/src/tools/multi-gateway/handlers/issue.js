/**
 * Construct the issueDataOnlyEntityV0 + onboardDataOnlyIotHotspotV0
 * Solana transactions for a gateway's public key.
 *
 * Returns serialized transactions (base64) for the frontend wallet to sign.
 */
import { PublicKey, ComputeBudgetProgram, Transaction, VersionedTransaction, TransactionMessage, TransactionInstruction, SystemProgram, Connection } from "@solana/web3.js";
import { sha256 } from "js-sha256";
import bs58 from "bs58";
import { jsonResponse } from "../../../lib/response.js";

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
const SPL_NOOP = new PublicKey("noopb9bkMVfRPU8AsBHBnMs7hZnUBQ68qKEYUXJp5bR");
const SPL_TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SPL_ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const HNT_MINT = new PublicKey("hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux");
const IOT_MINT = new PublicKey("iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns");
const DC_MINT = new PublicKey("dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm");

// PDA helpers
function findPDA(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

const daoKey = () => findPDA([Buffer.from("dao"), HNT_MINT.toBuffer()], SUB_DAOS);
const iotSubDaoKey = () => findPDA([Buffer.from("sub_dao"), IOT_MINT.toBuffer()], SUB_DAOS);
const dataOnlyConfigKey = () => findPDA([Buffer.from("data_only_config"), daoKey().toBuffer()], ENTITY_MANAGER);
const dataOnlyEscrowKey = () => findPDA([Buffer.from("data_only_escrow"), dataOnlyConfigKey().toBuffer()], ENTITY_MANAGER);
const entityCreatorKey = () => findPDA([Buffer.from("entity_creator"), daoKey().toBuffer()], ENTITY_MANAGER);
const rewardableEntityConfigKey = () => findPDA([Buffer.from("rewardable_entity_config"), iotSubDaoKey().toBuffer(), Buffer.from("IOT")], ENTITY_MANAGER);
const dcKey = () => findPDA([Buffer.from("dc"), DC_MINT.toBuffer()], DATA_CREDITS);

function entityKeyHash(gatewayPubkeyB58) {
  const bytes = bs58.decode(gatewayPubkeyB58);
  return Buffer.from(sha256.arrayBuffer(bytes));
}

function keyToAssetKey(gatewayPubkeyB58) {
  return findPDA([Buffer.from("key_to_asset"), daoKey().toBuffer(), entityKeyHash(gatewayPubkeyB58)], ENTITY_MANAGER);
}

function iotInfoKey(gatewayPubkeyB58) {
  return findPDA([Buffer.from("iot_info"), rewardableEntityConfigKey().toBuffer(), entityKeyHash(gatewayPubkeyB58)], ENTITY_MANAGER);
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

function bubblegumSignerKey() {
  return findPDA([Buffer.from("collection_cpi")], BUBBLEGUM);
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
    { pubkey: dataOnlyConfigKey(), isSigner: false, isWritable: true },      // data_only_config
    { pubkey: entityCreatorKey(), isSigner: false, isWritable: false },      // entity_creator
    { pubkey: daoKey(), isSigner: false, isWritable: false },                // dao
    { pubkey: keyToAssetKey(gatewayPubkeyB58), isSigner: false, isWritable: true }, // key_to_asset
    { pubkey: treeAuthorityKey(merkleTree), isSigner: false, isWritable: true }, // tree_authority
    { pubkey: owner, isSigner: false, isWritable: false },                   // recipient
    { pubkey: merkleTree, isSigner: false, isWritable: true },               // merkle_tree
    { pubkey: dataOnlyEscrowKey(), isSigner: false, isWritable: true },      // data_only_escrow
    { pubkey: bubblegumSignerKey(), isSigner: false, isWritable: false },    // bubblegum_signer
    { pubkey: TOKEN_METADATA, isSigner: false, isWritable: false },          // token_metadata_program
    { pubkey: SPL_NOOP, isSigner: false, isWritable: false },                // log_wrapper
    { pubkey: BUBBLEGUM, isSigner: false, isWritable: false },               // bubblegum_program
    { pubkey: COMPRESSION, isSigner: false, isWritable: false },             // compression_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
  ];

  return new TransactionInstruction({ keys: accounts, programId: ENTITY_MANAGER, data });
}

/**
 * Build the onboardDataOnlyIotHotspotV0 instruction.
 * Requires the asset's compression proof from DAS.
 */
function buildOnboardInstruction(owner, gatewayPubkeyB58, merkleTree, asset, proof) {
  // OnboardDataOnlyIotHotspotArgsV0 { data_hash, creator_hash, index, root, elevation, gain, location }
  const disc = anchorDiscriminator("onboard_data_only_iot_hotspot_v0");

  const dataHash = Buffer.from(asset.compression.data_hash.slice(2), "hex"); // 32 bytes
  const creatorHash = Buffer.from(asset.compression.creator_hash.slice(2), "hex"); // 32 bytes
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(asset.compression.leaf_id);
  const root = Buffer.from(bs58.decode(proof.root));

  // elevation: Option<i32> = None (0x00)
  // gain: Option<i32> = None (0x00)
  // location: Option<u64> = None (0x00)
  const data = Buffer.concat([disc, dataHash, creatorHash, indexBuf, root, Buffer.from([0, 0, 0])]);

  const accounts = [
    { pubkey: owner, isSigner: true, isWritable: true },                     // payer
    { pubkey: owner, isSigner: true, isWritable: true },                     // dc_fee_payer
    { pubkey: iotInfoKey(gatewayPubkeyB58), isSigner: false, isWritable: true }, // iot_info
    { pubkey: owner, isSigner: true, isWritable: true },                     // hotspot_owner
    { pubkey: merkleTree, isSigner: false, isWritable: false },              // merkle_tree
    { pubkey: ataAddress(owner, DC_MINT), isSigner: false, isWritable: true }, // dc_burner
    { pubkey: rewardableEntityConfigKey(), isSigner: false, isWritable: false }, // rewardable_entity_config
    { pubkey: dataOnlyConfigKey(), isSigner: false, isWritable: false },     // data_only_config
    { pubkey: daoKey(), isSigner: false, isWritable: false },                // dao
    { pubkey: keyToAssetKey(gatewayPubkeyB58), isSigner: false, isWritable: false }, // key_to_asset
    { pubkey: iotSubDaoKey(), isSigner: false, isWritable: true },           // sub_dao
    { pubkey: DC_MINT, isSigner: false, isWritable: true },                  // dc_mint
    { pubkey: dcKey(), isSigner: false, isWritable: false },                 // dc
    { pubkey: COMPRESSION, isSigner: false, isWritable: false },             // compression_program
    { pubkey: DATA_CREDITS, isSigner: false, isWritable: false },            // data_credits_program
    { pubkey: SPL_TOKEN, isSigner: false, isWritable: false },               // token_program
    { pubkey: SPL_ATA, isSigner: false, isWritable: false },                 // associated_token_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    { pubkey: SUB_DAOS, isSigner: false, isWritable: false },                // helium_sub_daos_program
  ];

  // Add proof accounts as remaining accounts
  for (const proofKey of proof.proof) {
    accounts.push({ pubkey: new PublicKey(proofKey), isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({ keys: accounts, programId: ENTITY_MANAGER, data });
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

  // Get gateway public key and add-gateway txn from upstream
  const host = env.MULTI_GATEWAY_HOST || "hotspot.heliumtools.org";
  const apiKey = env.MULTI_GATEWAY_API_KEY;
  const writeKey = env.MULTI_GATEWAY_WRITE_API_KEY || apiKey;
  const REGIONS = [4468, 4469, 4470, 4471, 4472, 4473];

  let gatewayPubkey = null;
  let addTxnData = null;
  for (const port of REGIONS) {
    try {
      const res = await fetch(`http://${host}:${port}/gateways/${mac}`, {
        headers: { "X-API-Key": apiKey },
      });
      if (res.ok) {
        const data = await res.json();
        gatewayPubkey = data.public_key;
        // Get the gateway-signed add txn for ECC verification
        const addRes = await fetch(`http://${host}:${port}/gateways/${mac}/add`, {
          method: "POST",
          headers: { "X-API-Key": writeKey, "Content-Type": "application/json" },
          body: JSON.stringify({ owner: ownerStr, payer: ownerStr }),
        });
        if (addRes.ok) {
          addTxnData = await addRes.json();
        }
        break;
      }
    } catch { /* try next */ }
  }

  if (!gatewayPubkey) {
    return jsonResponse({ error: "Gateway not found" }, 404);
  }
  if (!addTxnData) {
    return jsonResponse({ error: "Failed to get gateway add transaction" }, 500);
  }

  try {
    const rpcUrl = env.SOLANA_RPC_URL;
    const connection = new Connection(rpcUrl);

    // Check if already issued
    const ktaKey = keyToAssetKey(gatewayPubkey);
    const ktaAccount = await connection.getAccountInfo(ktaKey);

    const transactions = [];

    if (!ktaAccount) {
      // Fetch dataOnlyConfig to get merkle tree and collection
      const configKey = dataOnlyConfigKey();
      const configAccount = await connection.getAccountInfo(configKey);
      if (!configAccount) {
        return jsonResponse({ error: "DataOnlyConfig account not found on-chain" }, 500);
      }

      // Parse DataOnlyConfigV0: skip 8-byte discriminator
      // Layout: authority(32) + collection(32) + merkle_tree(32) + ...
      const configData = configAccount.data;
      const collection = new PublicKey(configData.slice(8 + 32, 8 + 64));
      const merkleTree = new PublicKey(configData.slice(8 + 64, 8 + 96));

      const issueIx = buildIssueInstruction(ownerPubkey, gatewayPubkey, merkleTree, collection);
      const { blockhash } = await connection.getLatestBlockhash();

      // The ECC verifier expects compute budget instructions before the
      // entity manager instruction (it skips up to 2 compute budget ixs).
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
      const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

      const messageV0 = new TransactionMessage({
        payerKey: ownerPubkey,
        recentBlockhash: blockhash,
        instructions: [computeBudgetIx, computePriceIx, issueIx],
      }).compileToLegacyMessage();

      const vtx = new VersionedTransaction(messageV0);

      // Solana wire format IS the bincode format for VersionedTransaction.
      // VersionedMessage has custom Serialize that uses short_vec (compact_u16)
      // matching the wire format exactly. No conversion needed.
      // (Verified: solana-program/src/message/versions/mod.rs — custom Serialize impl)
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

      // Response is also in wire format (same as bincode for VersionedTransaction)
      const signedWire = Buffer.from(verifyData.transaction, "hex");

      transactions.push({
        type: "issue",
        transaction: signedWire.toString("base64"),
      });
    }

    return jsonResponse({
      gateway: gatewayPubkey,
      already_issued: !!ktaAccount,
      transactions,
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to build transactions: ${err.message}` }, 500);
  }
}
