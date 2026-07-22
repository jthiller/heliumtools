/**
 * Shared Helium × Solana helpers for issuing and onboarding data-only
 * (and full) IoT and Mobile Hotspot entities.
 *
 * Extracted from multi-gateway/handlers/issue.js so that iot-onboard,
 * mobile-onboard (and any future tool) can reuse the same constants,
 * PDA derivations, instruction builders, Borsh encoders, and DAS helpers.
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

// Helium common Address Lookup Table — compresses the static Helium program /
// PDA accounts in v0 transactions. Used by the location-update builder (and
// mirrored as a string in hotspot-claimer/config.js).
export const HELIUM_COMMON_LUT = new PublicKey("43eY9L2spbM2b1MPDFFBStUiFGt29ziZ1nc1xbpzsfVt");

// IoT RewardableEntityConfig antenna-gain bounds (dBi × 10). The on-chain
// `validate_iot_gain` constraint enforces IOT_MIN_GAIN ≤ gain ≤ IOT_MAX_GAIN
// (1.0–15.0 dBi); a value outside this fails update_iot_info_v0 with the Anchor
// ConstraintRaw error (0x7d3). Mirrors the marker values fees.js keys off.
export const IOT_MIN_GAIN = 10;
export const IOT_MAX_GAIN = 150;

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

export const MOBILE_MINT = new PublicKey("mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6");

// Pyth PriceUpdateV2 account for MOBILE/USD. Required as the dnt_price
// account of onboard_data_only_mobile_hotspot_v0 (the instruction burns no
// MOBILE for wifiDataOnly devices, but the account must still be supplied).
// Mirrors MOBILE_PRICE_KEY in helium-wallet-rs helium-lib/src/token.rs.
export const MOBILE_PRICE_KEY = new PublicKey("DQ4C1tzvu28cwo1roN1Wm6TW35sfJEjLh517k3ZeWevx");

// Static PDAs — derived from constants, computed once at module load
export const DAO_KEY = findPDA([Buffer.from("dao"), HNT_MINT.toBuffer()], SUB_DAOS);
export const IOT_SUB_DAO_KEY = findPDA([Buffer.from("sub_dao"), IOT_MINT.toBuffer()], SUB_DAOS);
export const MOBILE_SUB_DAO_KEY = findPDA([Buffer.from("sub_dao"), MOBILE_MINT.toBuffer()], SUB_DAOS);
export const DATA_ONLY_CONFIG_KEY = findPDA([Buffer.from("data_only_config"), DAO_KEY.toBuffer()], ENTITY_MANAGER);
export const DATA_ONLY_ESCROW_KEY = findPDA([Buffer.from("data_only_escrow"), DATA_ONLY_CONFIG_KEY.toBuffer()], ENTITY_MANAGER);
export const ENTITY_CREATOR_KEY = findPDA([Buffer.from("entity_creator"), DAO_KEY.toBuffer()], ENTITY_MANAGER);
export const REWARDABLE_ENTITY_CONFIG_KEY = findPDA([Buffer.from("rewardable_entity_config"), IOT_SUB_DAO_KEY.toBuffer(), Buffer.from("IOT")], ENTITY_MANAGER);
export const MOBILE_REWARDABLE_ENTITY_CONFIG_KEY = findPDA([Buffer.from("rewardable_entity_config"), MOBILE_SUB_DAO_KEY.toBuffer(), Buffer.from("MOBILE")], ENTITY_MANAGER);
export const DC_KEY = findPDA([Buffer.from("dc"), DC_MINT.toBuffer()], DATA_CREDITS);
export const BUBBLEGUM_SIGNER_KEY = findPDA([Buffer.from("collection_cpi")], BUBBLEGUM);

// ---------------------------------------------------------------------------
// Dynamic PDAs
// ---------------------------------------------------------------------------

// A Helium entity-key b58 pubkey is ~51 chars (Solana pubkeys ~44); 64 is
// generous headroom. Bounding the input here — before the O(n²) bs58.decode —
// protects every PDA derivation (and thus every handler that derives a PDA
// from a request param) from an unbounded-input CPU-amplification vector. All
// callers already wrap derivation in try/catch, so an over-length key surfaces
// as their normal "invalid key" error rather than burning Worker CPU.
const MAX_ENTITY_KEY_LEN = 64;

export function entityKeyHash(gatewayPubkeyB58) {
  if (typeof gatewayPubkeyB58 !== "string" || gatewayPubkeyB58.length > MAX_ENTITY_KEY_LEN) {
    throw new Error("Invalid entity key");
  }
  const bytes = bs58.decode(gatewayPubkeyB58);
  return Buffer.from(sha256.arrayBuffer(bytes));
}

export function keyToAssetKey(gatewayPubkeyB58) {
  return findPDA([Buffer.from("key_to_asset"), DAO_KEY.toBuffer(), entityKeyHash(gatewayPubkeyB58)], ENTITY_MANAGER);
}

export function iotInfoKey(gatewayPubkeyB58) {
  return findPDA([Buffer.from("iot_info"), REWARDABLE_ENTITY_CONFIG_KEY.toBuffer(), entityKeyHash(gatewayPubkeyB58)], ENTITY_MANAGER);
}

export function mobileInfoKey(gatewayPubkeyB58) {
  return findPDA([Buffer.from("mobile_info"), MOBILE_REWARDABLE_ENTITY_CONFIG_KEY.toBuffer(), entityKeyHash(gatewayPubkeyB58)], ENTITY_MANAGER);
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

/**
 * Decode a compressed-NFT hash (data_hash / creator_hash) from a DAS asset.
 * Helius normally returns base58, but some DAS providers return a "0x"-prefixed
 * hex string — handle both so the proof check never silently corrupts.
 */
export function decodeCompressionHash(hash) {
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error("Invalid compression hash: expected a non-empty string");
  }
  const buf = hash.startsWith("0x")
    ? Buffer.from(hash.slice(2), "hex")
    : Buffer.from(bs58.decode(hash));
  // Both data_hash and creator_hash are 32 bytes; anything else means a
  // malformed/unexpected DAS response — fail explicitly rather than build a
  // transaction with a silently-wrong hash.
  if (buf.length !== 32) {
    throw new Error(`Invalid compression hash: expected 32 bytes, got ${buf.length}`);
  }
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

/**
 * Build an update_iot_info_v0 instruction to re-assert an already-onboarded
 * IoT Hotspot's location / elevation / antenna gain. The connected wallet
 * (owner) is payer + dc_fee_payer + hotspot_owner.
 *
 * Mirrors buildOnboardInstruction but with three deliberate differences — each
 * a known failure mode if copied blindly:
 *  1. Borsh arg order puts the Options FIRST (location, elevation, gain), then
 *     the cNFT fields (data_hash, creator_hash, root, index). Onboard is the
 *     reverse. (Sanity: 127 bytes all-Some, 111 bytes all-None.)
 *  2. The account list ADDS tree_authority + bubblegum_program and OMITS
 *     onboard's key_to_asset / data_only_config / helium_sub_daos_program.
 *  3. The cNFT hashes are decoded defensively (base58 or "0x"-hex).
 *
 * A None arg (null/undefined location/elevation/gain) leaves that field
 * unchanged on-chain; only a location change incurs the DC staking fee.
 */
export function buildUpdateIotInfoInstruction(owner, gatewayPubkeyB58, merkleTree, asset, proof, canopyDepth, opts = {}) {
  const disc = anchorDiscriminator("update_iot_info_v0");

  const dataHash = decodeCompressionHash(asset.compression.data_hash);
  const creatorHash = decodeCompressionHash(asset.compression.creator_hash);
  const root = Buffer.from(bs58.decode(proof.root));
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(asset.compression.leaf_id);

  // NOTE: arg order differs from onboard — Options FIRST, then hashes/root/index.
  const data = Buffer.concat([
    disc,
    encodeOptionU64(opts.location),          // H3 cell hex string → u64, or None
    encodeOptionI32(opts.elevation ?? null), // meters, or None
    encodeOptionI32(opts.gain ?? null),      // dBi × 10, or None
    dataHash, creatorHash, root, indexBuf,
  ]);

  const accounts = [
    { pubkey: owner, isSigner: true, isWritable: true },                        // payer
    { pubkey: owner, isSigner: true, isWritable: true },                        // dc_fee_payer
    { pubkey: iotInfoKey(gatewayPubkeyB58), isSigner: false, isWritable: true }, // iot_info
    { pubkey: owner, isSigner: true, isWritable: true },                        // hotspot_owner
    { pubkey: merkleTree, isSigner: false, isWritable: false },                 // merkle_tree
    { pubkey: treeAuthorityKey(merkleTree), isSigner: false, isWritable: false }, // tree_authority
    { pubkey: ataAddress(owner, DC_MINT), isSigner: false, isWritable: true },  // dc_burner
    { pubkey: REWARDABLE_ENTITY_CONFIG_KEY, isSigner: false, isWritable: false }, // rewardable_entity_config
    { pubkey: DAO_KEY, isSigner: false, isWritable: false },                    // dao
    { pubkey: IOT_SUB_DAO_KEY, isSigner: false, isWritable: false },            // sub_dao (read-only here, unlike onboard)
    { pubkey: DC_MINT, isSigner: false, isWritable: true },                     // dc_mint
    { pubkey: DC_KEY, isSigner: false, isWritable: false },                     // dc
    { pubkey: BUBBLEGUM, isSigner: false, isWritable: false },                  // bubblegum_program
    { pubkey: COMPRESSION, isSigner: false, isWritable: false },                // compression_program
    { pubkey: DATA_CREDITS, isSigner: false, isWritable: false },               // data_credits_program
    { pubkey: SPL_TOKEN, isSigner: false, isWritable: false },                  // token_program
    { pubkey: SPL_ATA, isSigner: false, isWritable: false },                    // associated_token_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },    // system_program
  ];

  const proofPath = proof.proof.slice(0, proof.proof.length - canopyDepth);
  for (const proofKey of proofPath) {
    accounts.push({ pubkey: new PublicKey(proofKey), isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({ keys: accounts, programId: ENTITY_MANAGER, data });
}

/**
 * Build an onboard_data_only_mobile_hotspot_v0 instruction (converted WiFi
 * networks; device_type is forced to wifiDataOnly on-chain). The connected
 * wallet (owner) is payer + dc_fee_payer + hotspot_owner.
 *
 * Differs from the IoT data-only onboard in three verified ways (source:
 * helium_entity_manager IDL — its account order deviates from the Rust client
 * struct-literal order, so don't "fix" this against helium-wallet-rs source):
 *  1. Args carry only `location` (no elevation/gain): data_hash, creator_hash,
 *     root, index, location Option<u64>.
 *  2. Three MOBILE accounts are added: dnt_burner (owner's MOBILE ATA)
 *     directly after dc_burner, and dnt_mint + dnt_price between dc_mint and
 *     dc. No MOBILE is burned for wifiDataOnly, but all three are required.
 *  3. Only DC is burned: dc_onboarding_fee + location_staking_fee (when a
 *     location is provided).
 */
export function buildOnboardMobileInstruction(owner, gatewayPubkeyB58, merkleTree, asset, proof, canopyDepth, opts = {}) {
  const disc = anchorDiscriminator("onboard_data_only_mobile_hotspot_v0");

  const dataHash = decodeCompressionHash(asset.compression.data_hash);
  const creatorHash = decodeCompressionHash(asset.compression.creator_hash);
  const root = Buffer.from(bs58.decode(proof.root));
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(asset.compression.leaf_id);

  const data = Buffer.concat([
    disc, dataHash, creatorHash, root, indexBuf,
    encodeOptionU64(opts.location),   // H3 res-12 cell hex string → u64
  ]);

  const accounts = [
    { pubkey: owner, isSigner: true, isWritable: true },                     // payer
    { pubkey: owner, isSigner: true, isWritable: true },                     // dc_fee_payer
    { pubkey: mobileInfoKey(gatewayPubkeyB58), isSigner: false, isWritable: true }, // mobile_info
    { pubkey: owner, isSigner: true, isWritable: true },                     // hotspot_owner
    { pubkey: merkleTree, isSigner: false, isWritable: false },              // merkle_tree
    { pubkey: ataAddress(owner, DC_MINT), isSigner: false, isWritable: true }, // dc_burner
    { pubkey: ataAddress(owner, MOBILE_MINT), isSigner: false, isWritable: true }, // dnt_burner
    { pubkey: MOBILE_REWARDABLE_ENTITY_CONFIG_KEY, isSigner: false, isWritable: false }, // rewardable_entity_config
    { pubkey: DATA_ONLY_CONFIG_KEY, isSigner: false, isWritable: false },    // data_only_config
    { pubkey: DAO_KEY, isSigner: false, isWritable: false },                 // dao
    { pubkey: keyToAssetKey(gatewayPubkeyB58), isSigner: false, isWritable: false }, // key_to_asset
    { pubkey: MOBILE_SUB_DAO_KEY, isSigner: false, isWritable: true },       // sub_dao
    { pubkey: DC_MINT, isSigner: false, isWritable: true },                  // dc_mint
    { pubkey: MOBILE_MINT, isSigner: false, isWritable: true },              // dnt_mint
    { pubkey: MOBILE_PRICE_KEY, isSigner: false, isWritable: false },        // dnt_price
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

/**
 * Build an update_mobile_info_v0 instruction to re-assert an already-onboarded
 * Mobile Hotspot's location. The connected wallet (owner) is payer +
 * dc_fee_payer + hotspot_owner.
 *
 * Mirrors buildUpdateIotInfoInstruction with two deltas (verified against the
 * helium_entity_manager IDL):
 *  1. Borsh args: location Option<u64> FIRST, then data_hash, creator_hash,
 *     root, index, and a trailing deployment_info
 *     Option<MobileDeploymentInfoV0> — always encoded None (0x00) here, which
 *     leaves any existing deployment_info unchanged on-chain (same behavior
 *     as the helium-wallet CLI).
 *  2. mobile_info / MOBILE rewardable_entity_config / MOBILE sub_dao replace
 *     their IoT counterparts; account order is otherwise identical.
 *
 * A None location leaves the field unchanged; a Some location burns the
 * MOBILE location_staking_fee in DC.
 */
export function buildUpdateMobileInfoInstruction(owner, gatewayPubkeyB58, merkleTree, asset, proof, canopyDepth, opts = {}) {
  const disc = anchorDiscriminator("update_mobile_info_v0");

  const dataHash = decodeCompressionHash(asset.compression.data_hash);
  const creatorHash = decodeCompressionHash(asset.compression.creator_hash);
  const root = Buffer.from(bs58.decode(proof.root));
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(asset.compression.leaf_id);

  const data = Buffer.concat([
    disc,
    encodeOptionU64(opts.location),  // H3 cell hex string → u64, or None
    dataHash, creatorHash, root, indexBuf,
    Buffer.from([0]),                // deployment_info: Option = None
  ]);

  const accounts = [
    { pubkey: owner, isSigner: true, isWritable: true },                        // payer
    { pubkey: owner, isSigner: true, isWritable: true },                        // dc_fee_payer
    { pubkey: mobileInfoKey(gatewayPubkeyB58), isSigner: false, isWritable: true }, // mobile_info
    { pubkey: owner, isSigner: true, isWritable: true },                        // hotspot_owner
    { pubkey: merkleTree, isSigner: false, isWritable: false },                 // merkle_tree
    { pubkey: treeAuthorityKey(merkleTree), isSigner: false, isWritable: false }, // tree_authority
    { pubkey: ataAddress(owner, DC_MINT), isSigner: false, isWritable: true },  // dc_burner
    { pubkey: MOBILE_REWARDABLE_ENTITY_CONFIG_KEY, isSigner: false, isWritable: false }, // rewardable_entity_config
    { pubkey: DAO_KEY, isSigner: false, isWritable: false },                    // dao
    { pubkey: MOBILE_SUB_DAO_KEY, isSigner: false, isWritable: false },         // sub_dao
    { pubkey: DC_MINT, isSigner: false, isWritable: true },                     // dc_mint
    { pubkey: DC_KEY, isSigner: false, isWritable: false },                     // dc
    { pubkey: BUBBLEGUM, isSigner: false, isWritable: false },                  // bubblegum_program
    { pubkey: COMPRESSION, isSigner: false, isWritable: false },                // compression_program
    { pubkey: DATA_CREDITS, isSigner: false, isWritable: false },               // data_credits_program
    { pubkey: SPL_TOKEN, isSigner: false, isWritable: false },                  // token_program
    { pubkey: SPL_ATA, isSigner: false, isWritable: false },                    // associated_token_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },    // system_program
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
    signal: AbortSignal.timeout(10_000),
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
    signal: AbortSignal.timeout(10_000),
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

/**
 * IotHotspotInfoV0 layout: disc(8) + asset(32) + bump_seed(1)
 * + location: Option<u64> + elevation: Option<i32> + gain: Option<i32>
 * + is_full_hotspot: bool + num_location_asserts: u16 + ...
 * The location Option tag sits at byte 41.
 */
export const IOT_INFO_LOCATION_OFFSET = 8 + 32 + 1;

/**
 * Parse the asserted location / elevation / gain (+ device type) out of an
 * IotHotspotInfoV0 account buffer, walking the three Options from byte 41.
 * `location_dec` is the H3 cell as a decimal string (null if unasserted);
 * `gain` is dBi × 10.
 */
export function parseIotInfo(buf) {
  let off = IOT_INFO_LOCATION_OFFSET;

  const hasLoc = buf[off] === 1;
  off += 1;
  let location_dec = null;
  if (hasLoc) {
    location_dec = buf.readBigUInt64LE(off).toString();
    off += 8;
  }

  const hasElev = buf[off] === 1;
  off += 1;
  let elevation = null;
  if (hasElev) {
    elevation = buf.readInt32LE(off);
    off += 4;
  }

  const hasGain = buf[off] === 1;
  off += 1;
  let gain = null;
  if (hasGain) {
    gain = buf.readInt32LE(off);
    off += 4;
  }

  const is_full_hotspot = buf[off] === 1;
  off += 1;
  const num_location_asserts = buf.readUInt16LE(off);

  return { location_dec, elevation, gain, is_full_hotspot, num_location_asserts };
}

// ---------------------------------------------------------------------------
// MobileHotspotInfoV0 / MOBILE RewardableEntityConfigV0 parsing
// ---------------------------------------------------------------------------

/** MobileDeviceTypeV0 enum order (on-chain u8). wifiDataOnly = 3. */
export const MOBILE_DEVICE_TYPES = ["cbrs", "wifiIndoor", "wifiOutdoor", "wifiDataOnly"];

/**
 * Parse a MobileHotspotInfoV0 account buffer.
 *
 * Layout (after 8-byte Anchor discriminator):
 *   asset: Pubkey(32) + bump_seed: u8 + location: Option<u64>
 *   + is_full_hotspot: bool + num_location_asserts: u16 + is_active: bool
 *   + dc_onboarding_fee_paid: u64 + device_type: u8 enum
 *   + deployment_info: Option<MobileDeploymentInfoV0>
 * The account is resize_to_fit'd, so the trailing deployment_info bytes may
 * be absent entirely — every read past device_type is length-guarded.
 */
export function parseMobileInfo(buf) {
  let off = 8;

  const asset = new PublicKey(buf.subarray(off, off + 32)).toBase58();
  off += 32;
  off += 1; // bump_seed

  let location_dec = null;
  const hasLoc = buf[off] === 1;
  off += 1;
  if (hasLoc) {
    location_dec = buf.readBigUInt64LE(off).toString();
    off += 8;
  }

  const is_full_hotspot = buf[off] === 1;
  off += 1;
  const num_location_asserts = buf.readUInt16LE(off);
  off += 2;
  const is_active = buf[off] === 1;
  off += 1;
  const dc_onboarding_fee_paid = Number(buf.readBigUInt64LE(off));
  off += 8;

  const deviceTypeIndex = buf.readUInt8(off);
  off += 1;
  const device_type = MOBILE_DEVICE_TYPES[deviceTypeIndex] || `unknown(${deviceTypeIndex})`;

  // deployment_info: Option<MobileDeploymentInfoV0>; only the WifiInfoV0
  // variant (0) is decoded — CbrsInfoV0 is legacy radio hardware.
  let deployment_info = null;
  if (off < buf.length && buf.readUInt8(off) === 1) {
    off += 1;
    if (off < buf.length) {
      const variant = buf.readUInt8(off);
      off += 1;
      if (variant === 0 && off + 14 <= buf.length) {
        deployment_info = {
          antenna: buf.readUInt32LE(off),
          elevation: buf.readInt32LE(off + 4),
          azimuth: buf.readUInt16LE(off + 8),
          mechanical_down_tilt: buf.readUInt16LE(off + 10),
          electrical_down_tilt: buf.readUInt16LE(off + 12),
        };
      }
    }
  }

  return {
    asset,
    location_dec,
    is_full_hotspot,
    num_location_asserts,
    is_active,
    dc_onboarding_fee_paid,
    device_type,
    deployment_info,
  };
}

/**
 * Parse the per-device-type fee schedule out of the MOBILE
 * RewardableEntityConfigV0 account, keyed by MOBILE_DEVICE_TYPES name.
 *
 * Layout: disc(8) + authority(32) + symbol(4-byte len + bytes) + sub_dao(32)
 * + settings enum: variant u8 (MobileConfigV2 = 3) + vec len u32
 * + DeviceFeesV1 entries of 89 bytes each:
 *   device_type u8 + dc_onboarding_fee u64 + location_staking_fee u64
 *   + mobile_onboarding_fee_usd u64 + reserved u64[8].
 * Fees are in DC (mobile_onboarding_fee_usd is USD with 6 decimals; 0 for
 * wifiDataOnly today).
 */
export function parseMobileConfigFees(buf) {
  let off = 8 + 32;
  const symbolLen = buf.readUInt32LE(off);
  off += 4 + symbolLen;
  off += 32; // sub_dao

  const variant = buf.readUInt8(off);
  off += 1;
  if (variant !== 3) {
    throw new Error(`Unexpected MOBILE config settings variant ${variant} (expected MobileConfigV2 = 3)`);
  }

  const count = buf.readUInt32LE(off);
  off += 4;
  const ENTRY_SIZE = 1 + 8 + 8 + 8 + 64;
  const fees = {};
  for (let i = 0; i < count; i++) {
    const base = off + i * ENTRY_SIZE;
    const deviceTypeIndex = buf.readUInt8(base);
    const name = MOBILE_DEVICE_TYPES[deviceTypeIndex] || `unknown(${deviceTypeIndex})`;
    fees[name] = {
      dc_onboarding_fee: Number(buf.readBigUInt64LE(base + 1)),
      location_staking_fee: Number(buf.readBigUInt64LE(base + 9)),
      mobile_onboarding_fee_usd: Number(buf.readBigUInt64LE(base + 17)),
    };
  }
  if (!fees.wifiDataOnly) {
    throw new Error("wifiDataOnly fees not found in MOBILE RewardableEntityConfigV0");
  }
  return fees;
}
