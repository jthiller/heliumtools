/**
 * Shared Helium × Solana helpers for issuing and onboarding data-only
 * (and full) IoT Hotspot entities.
 *
 * Extracted from multi-gateway/handlers/issue.js so that iot-onboard
 * (and any future tool) can reuse the same constants, PDA derivations,
 * instruction builders, Borsh encoders, and DAS helpers.
 */
import { PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { sha256 } from "js-sha256";
import bs58 from "bs58";

// ---------------------------------------------------------------------------
// ECC Verifier
// ---------------------------------------------------------------------------
export const ECC_VERIFIER = new PublicKey("eccSAJM3tq7nQSpQTm8roxv4FPoipCkMsGizW2KBhqZ");
export const ECC_VERIFIER_URL = "https://ecc-verifier.web.helium.io";

// ---------------------------------------------------------------------------
// Program IDs
// ---------------------------------------------------------------------------
export const ENTITY_MANAGER = new PublicKey("hemjuPXBpNvggtaUnN1MwT3wrdhttKEfosTcc2P9Pg8");
export const SUB_DAOS = new PublicKey("hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR");
export const BUBBLEGUM = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
export const COMPRESSION = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
export const DATA_CREDITS = new PublicKey("credMBJhYFzfn7NxBMdU4aUqFggAjgztaCcv2Fo6fPT");
export const TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const SPL_NOOP = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
export const SPL_TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const SPL_ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const HNT_MINT = new PublicKey("hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux");
export const IOT_MINT = new PublicKey("iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns");
export const DC_MINT = new PublicKey("dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm");

// Voter Stake Registry (veHNT positions)
export const VSR_PROGRAM = new PublicKey("hvsrNC3NKbcryqDs2DocYHZ9yPKEVzdSjQG6RVtK1s8");
// SPL governance program (realm lives under this)
export const SPL_GOVERNANCE_PROGRAM = new PublicKey("hgovkRU6Ghe1Qoyb54HdSLdqN7VtxaifBzRmh9jtd3S");
// Circuit breaker program (reward pool rate limiter)
export const CIRCUIT_BREAKER_PROGRAM = new PublicKey("circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g");

// veHNT constants
export const SCALED_FACTOR_BASE = 1_000_000_000n;
export const SECONDS_PER_EPOCH = 86400;

// Realm PDA for HNT: [b"governance", "Helium"] under SPL governance program
export const HELIUM_REALM = findPDA(
  [Buffer.from("governance"), Buffer.from("Helium")],
  SPL_GOVERNANCE_PROGRAM,
);
// HNT registrar: [realm, "registrar", HNT_MINT] under VSR
export const HNT_REGISTRAR_KEY = findPDA(
  [HELIUM_REALM.toBuffer(), Buffer.from("registrar"), HNT_MINT.toBuffer()],
  VSR_PROGRAM,
);
// Position collection NFT: [b"collection", registrar] under VSR
export const HNT_POSITION_COLLECTION_KEY = findPDA(
  [Buffer.from("collection"), HNT_REGISTRAR_KEY.toBuffer()],
  VSR_PROGRAM,
);

// --- VSR / sub-DAO PDAs ---

export function positionKey(mint) {
  return findPDA([Buffer.from("position"), mint.toBuffer()], VSR_PROGRAM);
}

export function delegatedPositionKey(position) {
  return findPDA([Buffer.from("delegated_position"), position.toBuffer()], SUB_DAOS);
}

export function daoEpochInfoKey(dao, epoch) {
  const epochBuf = Buffer.alloc(8);
  epochBuf.writeBigUInt64LE(BigInt(epoch));
  return findPDA([Buffer.from("dao_epoch_info"), dao.toBuffer(), epochBuf], SUB_DAOS);
}

export function subDaoEpochInfoKey(subDao, epoch) {
  const epochBuf = Buffer.alloc(8);
  epochBuf.writeBigUInt64LE(BigInt(epoch));
  return findPDA([Buffer.from("sub_dao_epoch_info"), subDao.toBuffer(), epochBuf], SUB_DAOS);
}

export function circuitBreakerKey(tokenAccount) {
  return findPDA(
    [Buffer.from("account_windowed_breaker"), tokenAccount.toBuffer()],
    CIRCUIT_BREAKER_PROGRAM,
  );
}

export function currentEpoch(nowSeconds) {
  return Math.floor(nowSeconds / SECONDS_PER_EPOCH);
}

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------
export function findPDA(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

// Static PDAs — derived from constants, computed once at module load
export const DAO_KEY = findPDA([Buffer.from("dao"), HNT_MINT.toBuffer()], SUB_DAOS);
export const IOT_SUB_DAO_KEY = findPDA([Buffer.from("sub_dao"), IOT_MINT.toBuffer()], SUB_DAOS);
export const DATA_ONLY_CONFIG_KEY = findPDA([Buffer.from("data_only_config"), DAO_KEY.toBuffer()], ENTITY_MANAGER);
export const DATA_ONLY_ESCROW_KEY = findPDA([Buffer.from("data_only_escrow"), DATA_ONLY_CONFIG_KEY.toBuffer()], ENTITY_MANAGER);
export const ENTITY_CREATOR_KEY = findPDA([Buffer.from("entity_creator"), DAO_KEY.toBuffer()], ENTITY_MANAGER);
export const REWARDABLE_ENTITY_CONFIG_KEY = findPDA([Buffer.from("rewardable_entity_config"), IOT_SUB_DAO_KEY.toBuffer(), Buffer.from("IOT")], ENTITY_MANAGER);
export const DC_KEY = findPDA([Buffer.from("dc"), DC_MINT.toBuffer()], DATA_CREDITS);
export const BUBBLEGUM_SIGNER_KEY = findPDA([Buffer.from("collection_cpi")], BUBBLEGUM);

// ---------------------------------------------------------------------------
// Dynamic PDAs
// ---------------------------------------------------------------------------
export function entityKeyHash(gatewayPubkeyB58) {
  const bytes = bs58.decode(gatewayPubkeyB58);
  return Buffer.from(sha256.arrayBuffer(bytes));
}

export function keyToAssetKey(gatewayPubkeyB58) {
  return findPDA([Buffer.from("key_to_asset"), DAO_KEY.toBuffer(), entityKeyHash(gatewayPubkeyB58)], ENTITY_MANAGER);
}

export function iotInfoKey(gatewayPubkeyB58) {
  return findPDA([Buffer.from("iot_info"), REWARDABLE_ENTITY_CONFIG_KEY.toBuffer(), entityKeyHash(gatewayPubkeyB58)], ENTITY_MANAGER);
}

export function collectionMetadataKey(collection) {
  return findPDA([Buffer.from("metadata"), TOKEN_METADATA.toBuffer(), collection.toBuffer()], TOKEN_METADATA);
}

export function collectionMasterEditionKey(collection) {
  return findPDA([Buffer.from("metadata"), TOKEN_METADATA.toBuffer(), collection.toBuffer(), Buffer.from("edition")], TOKEN_METADATA);
}

export function treeAuthorityKey(merkleTree) {
  return findPDA([merkleTree.toBuffer()], BUBBLEGUM);
}

export function ataAddress(owner, mint) {
  return findPDA([owner.toBuffer(), SPL_TOKEN.toBuffer(), mint.toBuffer()], SPL_ATA);
}

// ---------------------------------------------------------------------------
// Anchor discriminator
// ---------------------------------------------------------------------------
export function anchorDiscriminator(name) {
  const hash = sha256(`global:${name}`);
  return Buffer.from(hash.slice(0, 16), "hex");
}

// ---------------------------------------------------------------------------
// Borsh Option encoding helpers
// ---------------------------------------------------------------------------
export function encodeOptionU64(hexStr) {
  if (!hexStr) return Buffer.from([0]);
  const buf = Buffer.alloc(9);
  buf[0] = 1;
  buf.writeBigUInt64LE(BigInt("0x" + hexStr), 1);
  return buf;
}

export function encodeOptionI32(value) {
  if (value === null || value === undefined) return Buffer.from([0]);
  const buf = Buffer.alloc(5);
  buf[0] = 1;
  buf.writeInt32LE(value, 1);
  return buf;
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

/**
 * Build the issueDataOnlyEntityV0 instruction.
 */
export function buildIssueInstruction(owner, gatewayPubkeyB58, merkleTree, collection) {
  const entityKey = bs58.decode(gatewayPubkeyB58);

  const disc = anchorDiscriminator("issue_data_only_entity_v0");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(entityKey.length);
  const data = Buffer.concat([disc, lenBuf, Buffer.from(entityKey)]);

  const accounts = [
    { pubkey: owner, isSigner: true, isWritable: true },                    // payer
    { pubkey: ECC_VERIFIER, isSigner: true, isWritable: false },            // ecc_verifier
    { pubkey: collection, isSigner: false, isWritable: false },             // collection
    { pubkey: collectionMetadataKey(collection), isSigner: false, isWritable: true }, // collection_metadata
    { pubkey: collectionMasterEditionKey(collection), isSigner: false, isWritable: false }, // collection_master_edition
    { pubkey: DATA_ONLY_CONFIG_KEY, isSigner: false, isWritable: true },    // data_only_config
    { pubkey: ENTITY_CREATOR_KEY, isSigner: false, isWritable: false },     // entity_creator
    { pubkey: DAO_KEY, isSigner: false, isWritable: false },                // dao
    { pubkey: keyToAssetKey(gatewayPubkeyB58), isSigner: false, isWritable: true }, // key_to_asset
    { pubkey: treeAuthorityKey(merkleTree), isSigner: false, isWritable: true }, // tree_authority
    { pubkey: owner, isSigner: false, isWritable: false },                  // recipient
    { pubkey: merkleTree, isSigner: false, isWritable: true },              // merkle_tree
    { pubkey: DATA_ONLY_ESCROW_KEY, isSigner: false, isWritable: true },    // data_only_escrow
    { pubkey: BUBBLEGUM_SIGNER_KEY, isSigner: false, isWritable: false },   // bubblegum_signer
    { pubkey: TOKEN_METADATA, isSigner: false, isWritable: false },         // token_metadata_program
    { pubkey: SPL_NOOP, isSigner: false, isWritable: false },               // log_wrapper
    { pubkey: BUBBLEGUM, isSigner: false, isWritable: false },              // bubblegum_program
    { pubkey: COMPRESSION, isSigner: false, isWritable: false },            // compression_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
  ];

  return new TransactionInstruction({ keys: accounts, programId: ENTITY_MANAGER, data });
}

/**
 * Build an onboard IoT Hotspot instruction.
 * mode "data_only" → onboardDataOnlyIotHotspotV0 (1M DC)
 * mode "full"      → onboardIotHotspotV0 (4M DC, PoC eligible)
 */
export function buildOnboardInstruction(owner, gatewayPubkeyB58, merkleTree, asset, proof, canopyDepth, opts = {}) {
  const instructionName = opts.mode === "full"
    ? "onboard_iot_hotspot_v0"
    : "onboard_data_only_iot_hotspot_v0";
  const disc = anchorDiscriminator(instructionName);

  const dataHash = Buffer.from(bs58.decode(asset.compression.data_hash));
  const creatorHash = Buffer.from(bs58.decode(asset.compression.creator_hash));
  const root = Buffer.from(bs58.decode(proof.root));
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(asset.compression.leaf_id);

  const data = Buffer.concat([
    disc, dataHash, creatorHash, root, indexBuf,
    encodeOptionU64(opts.location),       // H3 cell hex string → u64
    encodeOptionI32(opts.elevation ?? null), // meters
    encodeOptionI32(opts.gain ?? null),      // dBi × 10
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

  const proofPath = proof.proof.slice(0, proof.proof.length - canopyDepth);
  for (const proofKey of proofPath) {
    accounts.push({ pubkey: new PublicKey(proofKey), isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({ keys: accounts, programId: ENTITY_MANAGER, data });
}

// ---------------------------------------------------------------------------
// DAS API helpers
// ---------------------------------------------------------------------------

export async function fetchAsset(rpcUrl, assetId) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: assetId } }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`getAsset: ${data.error.message}`);
  return data.result;
}

export async function fetchAssetProof(rpcUrl, assetId) {
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
export function getCanopyDepth(treeAccountData) {
  const maxBufferSize = treeAccountData.readUInt32LE(2);
  const maxDepth = treeAccountData.readUInt32LE(6);
  const headerSize = 56;
  const changeLogEntrySize = 32 + maxDepth * 32 + 4 + 4;
  const treeDataSize = 24 + maxBufferSize * changeLogEntrySize + maxDepth * 32;
  const canopyBytes = treeAccountData.length - headerSize - treeDataSize;
  if (canopyBytes <= 0) return 0;
  return Math.floor(Math.log2(canopyBytes / 32 + 2)) - 1;
}

// ---------------------------------------------------------------------------
// DataOnlyConfig account parsing
// ---------------------------------------------------------------------------

/** DataOnlyConfigV0 layout: discriminator(8) + authority(32) + bumpSeed(1) + collection(32) + merkleTree(32) */
export const CONFIG_COLLECTION_OFFSET = 8 + 32 + 1;
export const CONFIG_MERKLE_OFFSET = CONFIG_COLLECTION_OFFSET + 32;

/** KeyToAssetV0 layout: discriminator(8) + dao(32) + asset(32) + ... */
export const KTA_ASSET_OFFSET = 40;
