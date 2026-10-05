import { MAX_HOTSPOT_ENTITY_KEY_LEN } from "../../lib/helium-solana.js";

/**
 * Validate that a string looks like a plausible entity key (base58 encoded, reasonable length).
 */
export function isValidEntityKey(key) {
  if (!key || typeof key !== "string") return false;
  if (key.length < 20 || key.length > MAX_HOTSPOT_ENTITY_KEY_LEN) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(key);
}

/**
 * Validate a Solana wallet address (base58, 32-44 chars).
 */
export function isValidWalletAddress(addr) {
  if (!addr || typeof addr !== "string") return false;
  if (addr.length < 32 || addr.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr);
}

/**
 * Get today's date string in UTC (YYYY-MM-DD).
 */
export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
