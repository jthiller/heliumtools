import { PublicKey } from "@solana/web3.js";
import { RPC_BATCH_SIZE } from "../config.js";
import { titleCase } from "../utils.js";
import { deriveIotInfoPDA, deriveMobileInfoPDA, hashEntityKey } from "./pda.js";

/**
 * Batch fetch asset metadata from DAS using getAssetBatch.
 * Returns a Map<assetBase58, { name, owner }>.
 */
async function batchGetAssetMetadata(env, assetPubkeys) {
  const metadata = new Map();
  if (assetPubkeys.length === 0) return metadata;

  const DAS_BATCH_SIZE = 100;
  const ids = assetPubkeys.map((pk) =>
    pk instanceof PublicKey ? pk.toBase58() : pk
  );

  for (let i = 0; i < ids.length; i += DAS_BATCH_SIZE) {
    const batch = ids.slice(i, i + DAS_BATCH_SIZE);
    try {
      const response = await fetch(env.SOLANA_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAssetBatch",
          params: { ids: batch },
        }),
      });
      const json = await response.json();
      if (json.result) {
        for (const asset of json.result) {
          if (asset?.id) {
            metadata.set(asset.id, {
              name: asset.content?.metadata?.name ? titleCase(asset.content.metadata.name) : null,
              owner: asset.ownership?.owner || null,
            });
          }
        }
      }
    } catch {
      // Non-critical — metadata is optional, continue without it
    }
  }

  return metadata;
}

/**
 * Batch fetch multiple accounts from Solana RPC using getMultipleAccounts.
 * Returns array of { data: Buffer | null } matching input order.
 */
async function batchGetAccounts(env, pubkeys) {
  const results = new Array(pubkeys.length).fill(null);
  const addresses = pubkeys.map((pk) =>
    pk instanceof PublicKey ? pk.toBase58() : pk
  );

  for (let i = 0; i < addresses.length; i += RPC_BATCH_SIZE) {
    const batch = addresses.slice(i, i + RPC_BATCH_SIZE);
    const response = await fetch(env.SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getMultipleAccounts",
        params: [batch, { encoding: "base64" }],
      }),
    });
    const json = await response.json();
    if (json.error) {
      throw new Error(`getMultipleAccounts: ${json.error.message}`);
    }
    const values = json.result?.value || [];
    for (let j = 0; j < values.length; j++) {
      if (values[j]?.data?.[0]) {
        results[i + j] = Buffer.from(values[j].data[0], "base64");
      }
    }
  }

  return results;
}

/**
 * Parse IotHotspotInfoV0 account data.
 *
 * Layout (after 8-byte Anchor discriminator):
 *   asset:       Pubkey      (32 bytes)
 *   bump_seed:   u8          (1 byte)
 *   location:    Option<u64> (1 tag + 8 if Some)
 *   elevation:   Option<i32> (1 tag + 4 if Some)
 *   gain:        Option<i32> (1 tag + 4 if Some)
 *   is_full:     bool        (1 byte)
 *   num_asserts: u16         (2 bytes)
 *   is_active:   bool        (1 byte)
 *   dc_fee:      u64         (8 bytes)
 */
function parseIotInfo(data) {
  let offset = 8; // discriminator

  // asset (32 bytes)
  const asset = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  // bump_seed (1 byte)
  offset += 1;

  // location: Option<u64>
  let location = null;
  const locTag = data.readUInt8(offset);
  offset += 1;
  if (locTag === 1) {
    location = data.readBigUInt64LE(offset).toString();
    offset += 8;
  }

  // elevation: Option<i32>
  let elevation = null;
  const elevTag = data.readUInt8(offset);
  offset += 1;
  if (elevTag === 1) {
    elevation = data.readInt32LE(offset);
    offset += 4;
  }

  // gain: Option<i32>
  let gain = null;
  const gainTag = data.readUInt8(offset);
  offset += 1;
  if (gainTag === 1) {
    gain = data.readInt32LE(offset);
    offset += 4;
  }

  return {
    network: "iot",
    location,
    elevation,
    gain,
    asset,
    deviceType: null,
  };
}

/**
 * Parse MobileHotspotInfoV0 account data.
 *
 * Layout (after 8-byte Anchor discriminator):
 *   asset:       Pubkey      (32 bytes)
 *   bump_seed:   u8          (1 byte)
 *   location:    Option<u64> (1 tag + 8 if Some)
 *   is_full:     bool        (1 byte)
 *   num_asserts: u16         (2 bytes)
 *   is_active:   bool        (1 byte)
 *   dc_fee:      u64         (8 bytes)
 *   device_type: u8 enum     (1 byte)
 */
function parseMobileInfo(data) {
  let offset = 8; // discriminator

  // asset (32 bytes)
  const asset = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  // bump_seed (1 byte)
  offset += 1;

  // location: Option<u64>
  let location = null;
  const locTag = data.readUInt8(offset);
  offset += 1;
  if (locTag === 1) {
    location = data.readBigUInt64LE(offset).toString();
    offset += 8;
  }

  // is_full (1 byte)
  offset += 1;
  // num_asserts (2 bytes)
  offset += 2;

  // is_active (1 byte) - no longer used but must skip for offset
  offset += 1;

  // dc_fee (8 bytes)
  offset += 8;

  // device_type enum
  const DEVICE_TYPES = ["cbrs", "wifiIndoor", "wifiOutdoor", "wifiDataOnly"];
  const deviceTypeIndex = data.readUInt8(offset);
  const deviceType = DEVICE_TYPES[deviceTypeIndex] || `unknown(${deviceTypeIndex})`;
  offset += 1;

  // deployment_info: Option<MobileDeploymentInfoV0>
  let elevation = null;
  let gain = null;
  let azimuth = null;
  let mechanicalDownTilt = null;
  let electricalDownTilt = null;

  if (offset < data.length) {
    const deployTag = data.readUInt8(offset);
    offset += 1;
    if (deployTag === 1 && offset < data.length) {
      const variant = data.readUInt8(offset);
      offset += 1;
      if (variant === 0 && offset + 14 <= data.length) {
        // WifiInfoV0: antenna(u32), elevation(i32), azimuth(u16),
        //             mechanical_down_tilt(u16), electrical_down_tilt(u16)
        offset += 4; // antenna — skip
        elevation = data.readInt32LE(offset);
        offset += 4;
        azimuth = data.readUInt16LE(offset);
        offset += 2;
        mechanicalDownTilt = data.readUInt16LE(offset);
        offset += 2;
        electricalDownTilt = data.readUInt16LE(offset);
      }
    }
  }

  return {
    network: "mobile",
    location,
    elevation,
    gain,
    asset,
    deviceType,
    azimuth,
    mechanicalDownTilt,
    electricalDownTilt,
  };
}

/**
 * Lightweight check: for each entity key, return which networks it's on.
 * Returns Map<entityKey, ["iot"] | ["mobile"] | ["iot", "mobile"]>.
 */
export async function resolveNetworks(env, entityKeys) {
  const hashes = await Promise.all(entityKeys.map(hashEntityKey));

  const iotPDAs = hashes.map(deriveIotInfoPDA);
  const mobilePDAs = hashes.map(deriveMobileInfoPDA);

  const allPDAs = [];
  for (let i = 0; i < entityKeys.length; i++) {
    allPDAs.push(iotPDAs[i], mobilePDAs[i]);
  }

  const accountData = await batchGetAccounts(env, allPDAs);

  const result = new Map();
  for (let i = 0; i < entityKeys.length; i++) {
    const networks = [];
    if (accountData[i * 2]) networks.push("iot");
    if (accountData[i * 2 + 1]) networks.push("mobile");
    result.set(entityKeys[i], networks);
  }

  return result;
}

/**
 * Resolve an array of entity keys to their on-chain hotspot locations.
 * Returns { hotspots: [...], errors: [...] }
 */
export async function resolveLocations(env, entityKeys) {
  // 1. Hash all entity keys and derive PDAs
  const hashes = await Promise.all(entityKeys.map(hashEntityKey));

  const iotPDAs = hashes.map(deriveIotInfoPDA);
  const mobilePDAs = hashes.map(deriveMobileInfoPDA);

  // Interleave: [iot0, mobile0, iot1, mobile1, ...]
  const allPDAs = [];
  for (let i = 0; i < entityKeys.length; i++) {
    allPDAs.push(iotPDAs[i], mobilePDAs[i]);
  }

  // 2. Batch fetch all accounts
  const accountData = await batchGetAccounts(env, allPDAs);

  // 3. Parse results
  const hotspots = [];
  const errors = [];

  for (let i = 0; i < entityKeys.length; i++) {
    const entityKey = entityKeys[i];
    const iotData = accountData[i * 2];
    const mobileData = accountData[i * 2 + 1];

    try {
      let found = false;
      if (iotData) {
        hotspots.push({ entityKey, ...parseIotInfo(iotData) });
        found = true;
      }
      if (mobileData) {
        hotspots.push({ entityKey, ...parseMobileInfo(mobileData) });
        found = true;
      }
      if (!found) {
        errors.push({ entityKey, error: "No hotspot info account found" });
      }
    } catch (err) {
      errors.push({ entityKey, error: `Parse error: ${err.message}` });
    }
  }

  // 4. Batch fetch names + owner from DAS using asset pubkeys
  const assetPubkeys = hotspots.map((h) => h.asset).filter(Boolean);
  const metaMap = await batchGetAssetMetadata(env, assetPubkeys);

  for (const h of hotspots) {
    const meta = h.asset ? metaMap.get(h.asset) : null;
    h.name = meta?.name || null;
    h.owner = meta?.owner || null;
    delete h.asset;
  }

  return { hotspots, errors };
}
