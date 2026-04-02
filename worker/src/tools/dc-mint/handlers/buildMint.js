/**
 * Build an unsigned mint_data_credits_v0 transaction.
 * The user's browser wallet signs and submits it.
 */
import {
  PublicKey,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import {
  DATA_CREDITS_PROGRAM_ID,
  HNT_MINT,
  DC_MINT,
  HNT_DECIMALS,
} from "../../dc-purchase/lib/constants.js";

const DATA_CREDITS_PROGRAM = new PublicKey(DATA_CREDITS_PROGRAM_ID);
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const CIRCUIT_BREAKER_PROGRAM = new PublicKey("circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g");
const HNT_PYTH_PRICE_FEED = new PublicKey("4DdmDswskDxXGpwHrXUfn2CNUm9rt21ac79GHNTN3J33");

const HNT_MINT_KEY = new PublicKey(HNT_MINT);
const DC_MINT_KEY = new PublicKey(DC_MINT);

// Static PDAs
const DATA_CREDITS_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("dc"), DC_MINT_KEY.toBuffer()],
  DATA_CREDITS_PROGRAM,
)[0];
const CIRCUIT_BREAKER_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("mint_windowed_breaker"), DC_MINT_KEY.toBuffer()],
  CIRCUIT_BREAKER_PROGRAM,
)[0];

function ataAddress(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

function writeUint64LE(arr, value, offset) {
  const bigVal = BigInt(value);
  for (let i = 0; i < 8; i++) {
    arr[offset + i] = Number((bigVal >> BigInt(i * 8)) & 0xffn);
  }
}

// Discriminator: SHA256("global:mint_data_credits_v0")[0..8]
const MINT_DISCRIMINATOR = new Uint8Array([0x4e, 0x6d, 0xa9, 0x84, 0x90, 0x5e, 0xdd, 0x39]);

export async function handleBuildMint(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, hnt_amount, dc_amount, recipient: recipientStr } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!hnt_amount && !dc_amount) return jsonResponse({ error: "Specify hnt_amount or dc_amount" }, 400);
  if (hnt_amount && dc_amount) return jsonResponse({ error: "Specify only one of hnt_amount or dc_amount" }, 400);

  let ownerPubkey, recipientPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
    recipientPubkey = recipientStr ? new PublicKey(recipientStr) : ownerPubkey;
  } catch {
    return jsonResponse({ error: "Invalid address" }, 400);
  }

  try {
    const connection = new Connection(env.SOLANA_RPC_URL);

    // MintDataCreditsArgsV0: Option<u64> hnt_amount + Option<u64> dc_amount
    const argsBuffer = new Uint8Array(18);
    if (hnt_amount) {
      const hntLamports = BigInt(Math.round(hnt_amount * 10 ** HNT_DECIMALS));
      argsBuffer[0] = 1; // Some(hnt_amount)
      writeUint64LE(argsBuffer, hntLamports, 1);
      argsBuffer[9] = 0; // None for dc_amount
    } else {
      argsBuffer[0] = 0; // None for hnt_amount
      argsBuffer[1] = 1; // Some(dc_amount)
      writeUint64LE(argsBuffer, BigInt(dc_amount), 2);
    }

    const instructionData = new Uint8Array(MINT_DISCRIMINATOR.length + argsBuffer.length);
    instructionData.set(MINT_DISCRIMINATOR, 0);
    instructionData.set(argsBuffer, MINT_DISCRIMINATOR.length);

    const burnerAta = ataAddress(ownerPubkey, HNT_MINT_KEY);
    const recipientDcAta = ataAddress(recipientPubkey, DC_MINT_KEY);

    const mintIx = new TransactionInstruction({
      programId: DATA_CREDITS_PROGRAM,
      keys: [
        { pubkey: DATA_CREDITS_PDA, isSigner: false, isWritable: false },
        { pubkey: HNT_PYTH_PRICE_FEED, isSigner: false, isWritable: false },
        { pubkey: burnerAta, isSigner: false, isWritable: true },
        { pubkey: recipientDcAta, isSigner: false, isWritable: true },
        { pubkey: recipientPubkey, isSigner: false, isWritable: false },
        { pubkey: ownerPubkey, isSigner: true, isWritable: true },
        { pubkey: HNT_MINT_KEY, isSigner: false, isWritable: true },
        { pubkey: DC_MINT_KEY, isSigner: false, isWritable: true },
        { pubkey: CIRCUIT_BREAKER_PDA, isSigner: false, isWritable: true },
        { pubkey: CIRCUIT_BREAKER_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });
    const { blockhash } = await connection.getLatestBlockhash();

    const message = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: blockhash,
      instructions: [computeBudgetIx, computePriceIx, mintIx],
    }).compileToLegacyMessage();

    const vtx = new VersionedTransaction(message);

    return jsonResponse({
      transaction: Buffer.from(vtx.serialize()).toString("base64"),
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to build mint transaction: ${err.message}` }, 500);
  }
}
