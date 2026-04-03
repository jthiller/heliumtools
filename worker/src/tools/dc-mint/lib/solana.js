/**
 * Shared Solana helpers for DC mint handlers.
 */
import {
  PublicKey,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
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
export const MOBILE_MINT_KEY = new PublicKey("mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6");

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
export const IOT_SUB_DAO_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("sub_dao"), IOT_MINT_KEY.toBuffer()],
  SUB_DAOS_PROGRAM,
)[0];
export const MOBILE_SUB_DAO_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("sub_dao"), MOBILE_MINT_KEY.toBuffer()],
  SUB_DAOS_PROGRAM,
)[0];

/** Get the SubDAO PDA for a given subnet. */
export function subDaoPda(subnet) {
  return subnet === "mobile" ? MOBILE_SUB_DAO_PDA : IOT_SUB_DAO_PDA;
}

/** Derive delegatedDataCredits PDA for a router key on a given subnet. */
export async function delegatedDcPda(routerKey, subnet) {
  const nameHash = await hashName(routerKey);
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("delegated_data_credits"), subDaoPda(subnet).toBuffer(), nameHash],
    DATA_CREDITS_PROGRAM,
  )[0];
}

/** Derive escrow account PDA from a delegatedDataCredits PDA. */
export function escrowPda(delegatedDataCredits) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("escrow_dc_account"), delegatedDataCredits.toBuffer()],
    DATA_CREDITS_PROGRAM,
  )[0];
}

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

// ---- Instruction builders ----

const MINT_DISCRIMINATOR = new Uint8Array([0x4e, 0x6d, 0xa9, 0x84, 0x90, 0x5e, 0xdd, 0x39]);
const DELEGATE_DISCRIMINATOR = new Uint8Array([0x9a, 0x38, 0xe2, 0x80, 0xa2, 0x73, 0xe2, 0x05]);

/**
 * Build a mint_data_credits_v0 instruction.
 * @param {PublicKey} owner — signer who burns HNT
 * @param {{ hnt_amount?: number, dc_amount?: number }} amounts — exactly one required
 * @param {PublicKey} [recipient] — DC recipient (defaults to owner)
 * @param {number} hntDecimals — HNT_DECIMALS (8)
 */
export function buildMintInstruction(owner, amounts, recipient, hntDecimals) {
  const rcpt = recipient || owner;

  const parts = [];
  if (amounts.hnt_amount) {
    const [whole, frac = ""] = amounts.hnt_amount.toFixed(hntDecimals).split(".");
    const lamports = BigInt(whole) * BigInt(10 ** hntDecimals) + BigInt(frac);
    const some = new Uint8Array(9);
    some[0] = 1;
    writeUint64LE(some, lamports, 1);
    parts.push(some, new Uint8Array([0]));
  } else {
    const some = new Uint8Array(9);
    some[0] = 1;
    writeUint64LE(some, BigInt(amounts.dc_amount), 1);
    parts.push(new Uint8Array([0]), some);
  }
  const argsBuffer = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { argsBuffer.set(p, off); off += p.length; }

  const data = new Uint8Array(MINT_DISCRIMINATOR.length + argsBuffer.length);
  data.set(MINT_DISCRIMINATOR, 0);
  data.set(argsBuffer, MINT_DISCRIMINATOR.length);

  return new TransactionInstruction({
    programId: DATA_CREDITS_PROGRAM,
    keys: [
      { pubkey: DATA_CREDITS_PDA, isSigner: false, isWritable: false },
      { pubkey: HNT_PYTH_PRICE_FEED, isSigner: false, isWritable: false },
      { pubkey: ataAddress(owner, HNT_MINT_KEY), isSigner: false, isWritable: true },
      { pubkey: ataAddress(rcpt, DC_MINT_KEY), isSigner: false, isWritable: true },
      { pubkey: rcpt, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: HNT_MINT_KEY, isSigner: false, isWritable: true },
      { pubkey: DC_MINT_KEY, isSigner: false, isWritable: true },
      { pubkey: CIRCUIT_BREAKER_PDA, isSigner: false, isWritable: true },
      { pubkey: CIRCUIT_BREAKER_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build a delegate_data_credits_v0 instruction.
 * @param {PublicKey} owner — signer who delegates DC
 * @param {number} dcAmount — integer DC amount
 * @param {string} routerKey — payer key string
 * @param {string} subnet — "iot" or "mobile"
 */
export async function buildDelegateInstruction(owner, dcAmount, routerKey, subnet) {
  const subDao = subDaoPda(subnet);
  const delDc = await delegatedDcPda(routerKey, subnet);
  const escrow = escrowPda(delDc);

  const routerKeyBytes = new TextEncoder().encode(routerKey);
  const argsBuffer = new Uint8Array(8 + 4 + routerKeyBytes.length);
  writeUint64LE(argsBuffer, BigInt(dcAmount), 0);
  writeUint32LE(argsBuffer, routerKeyBytes.length, 8);
  argsBuffer.set(routerKeyBytes, 12);

  const data = new Uint8Array(DELEGATE_DISCRIMINATOR.length + argsBuffer.length);
  data.set(DELEGATE_DISCRIMINATOR, 0);
  data.set(argsBuffer, DELEGATE_DISCRIMINATOR.length);

  return {
    instruction: new TransactionInstruction({
      programId: DATA_CREDITS_PROGRAM,
      keys: [
        { pubkey: delDc, isSigner: false, isWritable: true },
        { pubkey: DATA_CREDITS_PDA, isSigner: false, isWritable: false },
        { pubkey: DC_MINT_KEY, isSigner: false, isWritable: false },
        { pubkey: DAO_PDA, isSigner: false, isWritable: false },
        { pubkey: subDao, isSigner: false, isWritable: false },
        { pubkey: owner, isSigner: true, isWritable: false },
        { pubkey: ataAddress(owner, DC_MINT_KEY), isSigner: false, isWritable: true },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
    escrow: escrow.toBase58(),
  };
}
