import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  HELIUM_ENTITY_MANAGER_PROGRAM_ID,
  HELIUM_SUB_DAOS_PROGRAM_ID,
  HNT_MINT,
  IOT_MINT,
  MOBILE_MINT,
} from "../config.js";

const ENTITY_MANAGER_PID = new PublicKey(HELIUM_ENTITY_MANAGER_PROGRAM_ID);
const SUB_DAOS_PID = new PublicKey(HELIUM_SUB_DAOS_PROGRAM_ID);

/**
 * SHA-256 hash using Web Crypto API (available in Cloudflare Workers).
 */
export async function sha256(data) {
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
    SUB_DAOS_PID
  );
  return dao;
}

/**
 * Derive a Sub-DAO PDA.
 * Seeds: ["sub_dao", mint] with the Sub-DAOs program.
 */
function deriveSubDAO(mint) {
  const mintPk = new PublicKey(mint);
  const [subDao] = PublicKey.findProgramAddressSync(
    [Buffer.from("sub_dao"), mintPk.toBuffer()],
    SUB_DAOS_PID
  );
  return subDao;
}

/**
 * Derive RewardableEntityConfig PDA.
 * Seeds: ["rewardable_entity_config", sub_dao, symbol_bytes] under Entity Manager.
 */
function deriveRewardableEntityConfig(subDao, symbol) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("rewardable_entity_config"),
      subDao.toBuffer(),
      Buffer.from(symbol, "utf-8"),
    ],
    ENTITY_MANAGER_PID
  );
  return pda;
}

// Pre-compute static PDAs
const DAO = deriveDAO();
const IOT_SUB_DAO = deriveSubDAO(IOT_MINT);
const MOBILE_SUB_DAO = deriveSubDAO(MOBILE_MINT);
const IOT_CONFIG = deriveRewardableEntityConfig(IOT_SUB_DAO, "IOT");
const MOBILE_CONFIG = deriveRewardableEntityConfig(MOBILE_SUB_DAO, "MOBILE");

/**
 * Derive IotHotspotInfoV0 PDA.
 * Seeds: ["iot_info", rewardable_entity_config, sha256(entity_key_bytes)]
 */
export function deriveIotInfoPDA(entityKeyHash) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("iot_info"),
      IOT_CONFIG.toBuffer(),
      Buffer.from(entityKeyHash),
    ],
    ENTITY_MANAGER_PID
  );
  return pda;
}

/**
 * Derive MobileHotspotInfoV0 PDA.
 * Seeds: ["mobile_info", rewardable_entity_config, sha256(entity_key_bytes)]
 */
export function deriveMobileInfoPDA(entityKeyHash) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("mobile_info"),
      MOBILE_CONFIG.toBuffer(),
      Buffer.from(entityKeyHash),
    ],
    ENTITY_MANAGER_PID
  );
  return pda;
}

/**
 * Hash an entity key for PDA derivation.
 * Returns the SHA-256 hash of the base58-decoded entity key bytes.
 */
export async function hashEntityKey(entityKey) {
  const entityKeyBytes = bs58.decode(entityKey);
  return await sha256(entityKeyBytes);
}
