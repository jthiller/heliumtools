import { PublicKey } from "@solana/web3.js";
import {
  LAZY_DISTRIBUTOR_PROGRAM_ID,
  REWARDS_ORACLE_PROGRAM_ID,
} from "../config.js";

// Well-known program IDs
export const SPL_TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
export const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
export const SPL_ACCOUNT_COMPRESSION = new PublicKey(
  "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK"
);
export const CIRCUIT_BREAKER_PROGRAM = new PublicKey(
  "circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g"
);
export const LAZY_DIST_PID = new PublicKey(LAZY_DISTRIBUTOR_PROGRAM_ID);
export const REWARDS_ORACLE_PID = new PublicKey(REWARDS_ORACLE_PROGRAM_ID);

// --- PDA Derivations ---

export function deriveLazyDistributor(mint) {
  const mintPk = mint instanceof PublicKey ? mint : new PublicKey(mint);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lazy_distributor"), mintPk.toBuffer()],
    LAZY_DIST_PID
  );
  return pda;
}

export function deriveRecipient(lazyDistributor, asset) {
  const assetPk = asset instanceof PublicKey ? asset : new PublicKey(asset);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("recipient"),
      lazyDistributor.toBuffer(),
      assetPk.toBuffer(),
    ],
    LAZY_DIST_PID
  );
  return pda;
}

export function deriveATA(owner, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM
  );
  return ata;
}

export function deriveCircuitBreaker(tokenAccount) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("account_windowed_breaker"), tokenAccount.toBuffer()],
    CIRCUIT_BREAKER_PROGRAM
  );
  return pda;
}

export function deriveOracleSigner() {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_signer")],
    REWARDS_ORACLE_PID
  );
  return pda;
}

// --- RPC Helpers ---

/**
 * Fetch raw account data from Solana RPC.
 * Returns a Buffer, or null if the account doesn't exist.
 */
export async function fetchAccount(env, pubkey) {
  if (!env.SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL is not configured");
  const address = pubkey instanceof PublicKey ? pubkey.toBase58() : pubkey;
  const response = await fetch(env.SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [address, { encoding: "base64" }],
    }),
  });
  const result = await response.json();
  if (!result.result?.value) return null;
  return Buffer.from(result.result.value.data[0], "base64");
}

/**
 * Fetch asset metadata via DAS API (Helius getAsset).
 */
export async function fetchAsset(env, assetId) {
  if (!env.SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL is not configured");
  const id = assetId instanceof PublicKey ? assetId.toBase58() : assetId;
  const resp = await fetch(env.SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAsset",
      params: { id },
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`getAsset: ${data.error.message}`);
  return data.result;
}

// --- Account Parsers ---

/**
 * Parse the LazyDistributorV0 account data.
 * Returns { version, rewardsMint, rewardsEscrow, oracles }.
 *
 * Layout (after 8-byte Anchor discriminator):
 *   version:         u16    (2 bytes, LE)
 *   rewards_mint:    Pubkey (32 bytes)
 *   rewards_escrow:  Pubkey (32 bytes)
 *   authority:       Pubkey (32 bytes)
 *   oracles:         Vec<OracleConfigV0> (4-byte LE length + items)
 *     each item:
 *       oracle:      Pubkey (32 bytes)
 *       url:         String (4-byte LE length + UTF-8 data)
 */
export function parseLazyDistributor(data) {
  let offset = 8; // skip discriminator

  const version = data.readUInt16LE(offset);
  offset += 2;

  const rewardsMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const rewardsEscrow = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // authority
  offset += 32;

  const oracleCount = data.readUInt32LE(offset);
  offset += 4;

  const oracles = [];
  for (let i = 0; i < oracleCount; i++) {
    const oracle = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const urlLen = data.readUInt32LE(offset);
    offset += 4;
    const url = data.slice(offset, offset + urlLen).toString("utf-8");
    offset += urlLen;

    oracles.push({ oracle, url });
  }

  return { version, rewardsMint, rewardsEscrow, oracles };
}

/**
 * Parse the RecipientV0 account data.
 * Returns { totalRewards, destination }.
 *
 * Layout (after 8-byte discriminator):
 *   lazy_distributor:      Pubkey (32 bytes)
 *   asset:                 Pubkey (32 bytes)
 *   total_rewards:         u64    (8 bytes, LE)
 *   current_config_version: u16   (2 bytes, LE)
 *   current_rewards:       Vec<Option<u64>> (4-byte len + items)
 *   bump_seed:             u8
 *   reserved:              u64    (8 bytes)
 *   destination:           Pubkey (32 bytes)
 */
export function parseRecipient(data) {
  let offset = 8; // skip discriminator
  offset += 32; // lazy_distributor
  offset += 32; // asset

  const totalRewards = data.readBigUInt64LE(offset);
  offset += 8;

  offset += 2; // current_config_version: u16

  // current_rewards: Vec<Option<u64>>
  const vecLen = data.readUInt32LE(offset);
  offset += 4;
  for (let i = 0; i < vecLen; i++) {
    const tag = data.readUInt8(offset);
    offset += 1;
    if (tag === 1) {
      offset += 8; // skip u64 value for Some variant
    }
  }

  offset += 1; // bump_seed: u8
  offset += 8; // reserved: u64

  // destination: Pubkey (32 bytes)
  let destination = null;
  if (offset + 32 <= data.length) {
    const destBytes = data.slice(offset, offset + 32);
    const isZero = destBytes.every((b) => b === 0);
    if (!isZero) {
      destination = new PublicKey(destBytes).toBase58();
    }
  }

  return { totalRewards, destination };
}
