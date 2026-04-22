import { PublicKey } from "@solana/web3.js";
import Address from "@helium/address";

/**
 * Parse a user-supplied wallet string as a Solana PublicKey, accepting
 * either Solana base58 or Helium B58 (legacy L1) format. Returns null on
 * invalid input.
 */
export function resolveSolanaWallet(input) {
  if (!input) return null;
  const trimmed = typeof input === "string" ? input.trim() : input;
  if (!trimmed) return null;
  try {
    return new PublicKey(trimmed);
  } catch {
    try {
      return new PublicKey(Address.fromB58(trimmed).publicKey);
    } catch {
      return null;
    }
  }
}
