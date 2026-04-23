import { PublicKey } from "@solana/web3.js";

/**
 * Validate that a string parses as a Solana base58 public key.
 * Returns the PublicKey on success, null on failure.
 */
export function parseSolanaAddress(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return null;
  try {
    return new PublicKey(trimmed);
  } catch {
    return null;
  }
}

/**
 * Format a BigInt native-unit amount to a decimal string using the given
 * decimals (e.g. HNT = 8). Returns a string with no trailing zeros.
 */
export function formatNative(amount, decimals) {
  if (amount === null || amount === undefined) return null;
  const n = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
