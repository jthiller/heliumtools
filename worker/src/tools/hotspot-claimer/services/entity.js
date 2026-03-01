import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  HELIUM_ENTITY_MANAGER_PROGRAM_ID,
  HELIUM_SUB_DAOS_PROGRAM_ID,
  HNT_MINT,
  ENTITY_API_BASE,
} from "../config.js";
import { fetchAccount, fetchAsset } from "./common.js";

/**
 * SHA-256 hash using Web Crypto API (available in Cloudflare Workers).
 */
async function sha256(data) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

/**
 * Derive the Helium DAO PDA.
 * Seeds: ["dao", HNT_MINT] with the Sub-DAOs program.
 */
function deriveDAO() {
  const [dao] = PublicKey.findProgramAddressSync(
    [Buffer.from("dao"), new PublicKey(HNT_MINT).toBuffer()],
    new PublicKey(HELIUM_SUB_DAOS_PROGRAM_ID)
  );
  return dao;
}

/**
 * Derive the keyToAsset PDA from an entity key string.
 * Seeds: ["key_to_asset", dao, sha256(bs58decode(entityKey))]
 */
async function deriveKeyToAssetPDA(entityKey) {
  const entityKeyBytes = bs58.decode(entityKey);
  const hash = await sha256(entityKeyBytes);
  const dao = deriveDAO();
  const programId = new PublicKey(HELIUM_ENTITY_MANAGER_PROGRAM_ID);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("key_to_asset"),
      dao.toBuffer(),
      Buffer.from(hash),
    ],
    programId
  );
  return pda;
}

/**
 * Parse the KeyToAssetV0 account data (Anchor-serialized).
 *
 * Layout (after 8-byte Anchor discriminator):
 *   dao:               Pubkey  (32 bytes)
 *   asset:             Pubkey  (32 bytes)
 *   entity_key:        Vec<u8> (4-byte LE length + data)
 *   bump_seed:         u8      (1 byte)
 *   key_serialization: enum    (1 byte)
 */
function parseKeyToAssetAccount(data) {
  const DISCRIMINATOR_SIZE = 8;
  const PUBKEY_SIZE = 32;

  const offset = DISCRIMINATOR_SIZE;
  const dao = new PublicKey(data.slice(offset, offset + PUBKEY_SIZE));
  const asset = new PublicKey(
    data.slice(offset + PUBKEY_SIZE, offset + PUBKEY_SIZE * 2)
  );

  return { dao, asset };
}

/**
 * Fetch hotspot metadata from the Helium Entity API.
 * GET https://entities.nft.helium.io/v2/hotspot/<keyToAssetKey>
 *
 * Returns rich metadata: title-cased name, definitive network type,
 * location details (street, city, state, country, lat, long).
 * Returns null on any failure (non-blocking).
 */
async function fetchEntityApiMetadata(keyToAssetKey) {
  try {
    const response = await fetch(
      `${ENTITY_API_BASE}/v2/hotspot/${keyToAssetKey}`
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Extract network type and location info from Entity API data.
 * Shared between single-hotspot and wallet lookups.
 */
export function extractEntityApiInfo(entityData) {
  const networksAttr = entityData.attributes?.find(
    (a) => a.trait_type === "networks"
  );
  const networks = networksAttr?.value || [];
  const network = networks[0] || null;

  const info =
    entityData.hotspot_infos?.[network] ||
    entityData.hotspot_infos?.iot ||
    entityData.hotspot_infos?.mobile ||
    {};

  return { network, info };
}

/**
 * Extract hotspot info by merging Entity API and DAS metadata.
 * Entity API is authoritative for name, network, location, image.
 * DAS is authoritative for owner and compression info.
 */
function extractHotspotInfo(asset, entityApiData) {
  const owner = asset.ownership?.owner || null;
  const isCompressed = asset.compression?.compressed || false;

  // Entity API provides authoritative metadata
  if (entityApiData) {
    const { network, info } = extractEntityApiInfo(entityApiData);

    return {
      owner,
      name: entityApiData.name || null,
      network,
      isCompressed,
      location: info.location || null,
      street: info.street || null,
      city: info.city || null,
      state: info.state || null,
      country: info.country || null,
      lat: info.lat || null,
      long: info.long || null,
      elevation: info.elevation || null,
      gain: info.gain || null,
      deviceType: info.device_type || null,
      image: entityApiData.image || null,
    };
  }

  // Fallback: extract from DAS metadata only (if Entity API failed)
  const attributes = asset.content?.metadata?.attributes || [];
  const attrMap = {};
  for (const attr of attributes) {
    attrMap[attr.trait_type] = attr.value;
  }

  let network = null;
  const symbol = asset.content?.metadata?.symbol || "";
  const imageUrl =
    asset.content?.links?.image || asset.content?.files?.[0]?.uri || "";

  if (symbol.toUpperCase().includes("MOBILE") || imageUrl.includes("mobile")) {
    network = "mobile";
  } else if (
    symbol.toUpperCase().includes("IOT") ||
    imageUrl.includes("iot") ||
    attrMap.gain !== undefined ||
    attrMap.elevation !== undefined
  ) {
    network = "iot";
  }

  // Title-case the kebab-case name from DAS
  const rawName = asset.content?.metadata?.name || null;
  const name = rawName
    ? rawName
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ")
    : null;

  return {
    owner,
    name,
    network,
    isCompressed,
    location: attrMap.location || attrMap.Location || null,
    street: null,
    city: attrMap.city || attrMap.City || null,
    state: attrMap.state || attrMap.State || null,
    country: attrMap.country || attrMap.Country || null,
    lat: null,
    long: null,
    elevation: attrMap.elevation || null,
    gain: attrMap.gain || null,
    deviceType: null,
    image: imageUrl || null,
  };
}

/**
 * Resolve an entity key to hotspot metadata.
 * Returns null if the entity key doesn't map to a valid hotspot.
 */
export async function resolveEntityKey(env, entityKey) {
  // 1. Derive the keyToAsset PDA
  const keyToAssetPDA = await deriveKeyToAssetPDA(entityKey);

  // 2. Fetch the on-chain keyToAsset account
  const keyToAssetData = await fetchAccount(env, keyToAssetPDA);
  if (!keyToAssetData) {
    return null;
  }
  const keyToAsset = parseKeyToAssetAccount(keyToAssetData);

  const keyToAssetKey = keyToAssetPDA.toBase58();

  // 3. Fetch DAS metadata and Entity API metadata in parallel
  const [asset, entityApiData] = await Promise.all([
    fetchAsset(env, keyToAsset.asset),
    fetchEntityApiMetadata(keyToAssetKey),
  ]);

  if (!asset) {
    return null;
  }

  // 4. Extract hotspot info (Entity API preferred, DAS fallback)
  const info = extractHotspotInfo(asset, entityApiData);

  return {
    entityKey,
    assetId: keyToAsset.asset.toBase58(),
    keyToAssetKey,
    ...info,
  };
}
