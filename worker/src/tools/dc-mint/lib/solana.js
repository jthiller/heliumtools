/**
 * Shared Solana helpers for DC mint handlers.
 */
import {
  PublicKey,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
} from "@solana/web3.js";
import {
  DATA_CREDITS_PROGRAM_ID,
  HELIUM_SUB_DAOS_PROGRAM_ID,
  HNT_MINT,
  DC_MINT,
  IOT_MINT,
} from "../../dc-purchase/lib/constants.js";

export const DATA_CREDITS_PROGRAM = new PublicKey(DATA_CREDITS_PROGRAM_ID);
export const SUB_DAOS_PROGRAM = new PublicKey(HELIUM_SUB_DAOS_PROGRAM_ID);
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const CIRCUIT_BREAKER_PROGRAM = new PublicKey("circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g");
export const HNT_PYTH_PRICE_FEED = new PublicKey("4DdmDswskDxXGpwHrXUfn2CNUm9rt21ac79GHNTN3J33");

export const HNT_MINT_KEY = new PublicKey(HNT_MINT);
export const DC_MINT_KEY = new PublicKey(DC_MINT);
export const IOT_MINT_KEY = new PublicKey(IOT_MINT);

// Static PDAs
export const DATA_CREDITS_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("dc"), DC_MINT_KEY.toBuffer()],
  DATA_CREDITS_PROGRAM,
)[0];
export const CIRCUIT_BREAKER_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("mint_windowed_breaker"), DC_MINT_KEY.toBuffer()],
  CIRCUIT_BREAKER_PROGRAM,
)[0];
export const DAO_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("dao"), HNT_MINT_KEY.toBuffer()],
  SUB_DAOS_PROGRAM,
)[0];
export const SUB_DAO_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("sub_dao"), IOT_MINT_KEY.toBuffer()],
  SUB_DAOS_PROGRAM,
)[0];

export function ataAddress(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

export function writeUint64LE(arr, value, offset) {
  const bigVal = BigInt(value);
  for (let i = 0; i < 8; i++) {
    arr[offset + i] = Number((bigVal >> BigInt(i * 8)) & 0xffn);
  }
}

export function writeUint32LE(arr, value, offset) {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >> 8) & 0xff;
  arr[offset + 2] = (value >> 16) & 0xff;
  arr[offset + 3] = (value >> 24) & 0xff;
}

export async function hashName(name) {
  const data = new TextEncoder().encode(name);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

/**
 * Build an unsigned VersionedTransaction with compute budget instructions.
 */
export async function buildUnsignedTx(connection, payerKey, instructions) {
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
  const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });
  const { blockhash } = await connection.getLatestBlockhash();

  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: [computeBudgetIx, computePriceIx, ...instructions],
  }).compileToLegacyMessage();

  return new VersionedTransaction(message);
}
