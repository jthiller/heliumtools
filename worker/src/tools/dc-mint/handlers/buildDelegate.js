/**
 * Build an unsigned delegate_data_credits_v0 transaction.
 * Resolves OUI → payer key, builds the delegation instruction.
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
  HELIUM_SUB_DAOS_PROGRAM_ID,
  HNT_MINT,
  DC_MINT,
  IOT_MINT,
} from "../../dc-purchase/lib/constants.js";
import { getOuiByNumber } from "../../oui-notifier/services/ouis.js";

const DATA_CREDITS_PROGRAM = new PublicKey(DATA_CREDITS_PROGRAM_ID);
const SUB_DAOS_PROGRAM = new PublicKey(HELIUM_SUB_DAOS_PROGRAM_ID);
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const HNT_MINT_KEY = new PublicKey(HNT_MINT);
const DC_MINT_KEY = new PublicKey(DC_MINT);
const IOT_MINT_KEY = new PublicKey(IOT_MINT);

// Static PDAs
const DATA_CREDITS_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("dc"), DC_MINT_KEY.toBuffer()],
  DATA_CREDITS_PROGRAM,
)[0];
const DAO_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("dao"), HNT_MINT_KEY.toBuffer()],
  SUB_DAOS_PROGRAM,
)[0];
const SUB_DAO_PDA = PublicKey.findProgramAddressSync(
  [new TextEncoder().encode("sub_dao"), IOT_MINT_KEY.toBuffer()],
  SUB_DAOS_PROGRAM,
)[0];

function ataAddress(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

async function hashName(name) {
  const data = new TextEncoder().encode(name);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

function writeUint64LE(arr, value, offset) {
  const bigVal = BigInt(value);
  for (let i = 0; i < 8; i++) {
    arr[offset + i] = Number((bigVal >> BigInt(i * 8)) & 0xffn);
  }
}

function writeUint32LE(arr, value, offset) {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >> 8) & 0xff;
  arr[offset + 2] = (value >> 16) & 0xff;
  arr[offset + 3] = (value >> 24) & 0xff;
}

// Discriminator: SHA256("global:delegate_data_credits_v0")[0..8]
const DELEGATE_DISCRIMINATOR = new Uint8Array([0x9a, 0x38, 0xe2, 0x80, 0xa2, 0x73, 0xe2, 0x05]);

export async function handleBuildDelegate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, amount, oui } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!amount || amount <= 0) return jsonResponse({ error: "Invalid DC amount" }, 400);
  if (!oui) return jsonResponse({ error: "Missing OUI number" }, 400);

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  // Resolve OUI to payer key
  const ouiData = await getOuiByNumber(env, oui);
  if (!ouiData?.payer) {
    return jsonResponse({ error: `OUI ${oui} not found or has no payer key` }, 404);
  }
  const routerKey = ouiData.payer;

  try {
    const connection = new Connection(env.SOLANA_RPC_URL);

    // Derive delegation PDAs
    const nameHash = await hashName(routerKey);
    const delegatedDataCredits = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("delegated_data_credits"), SUB_DAO_PDA.toBuffer(), nameHash],
      DATA_CREDITS_PROGRAM,
    )[0];
    const escrowAccount = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("escrow_dc_account"), delegatedDataCredits.toBuffer()],
      DATA_CREDITS_PROGRAM,
    )[0];

    // DelegateDataCreditsArgsV0: u64 amount + String router_key
    const routerKeyBytes = new TextEncoder().encode(routerKey);
    const argsBuffer = new Uint8Array(8 + 4 + routerKeyBytes.length);
    writeUint64LE(argsBuffer, BigInt(amount), 0);
    writeUint32LE(argsBuffer, routerKeyBytes.length, 8);
    argsBuffer.set(routerKeyBytes, 12);

    const instructionData = new Uint8Array(DELEGATE_DISCRIMINATOR.length + argsBuffer.length);
    instructionData.set(DELEGATE_DISCRIMINATOR, 0);
    instructionData.set(argsBuffer, DELEGATE_DISCRIMINATOR.length);

    const dcAta = ataAddress(ownerPubkey, DC_MINT_KEY);

    const delegateIx = new TransactionInstruction({
      programId: DATA_CREDITS_PROGRAM,
      keys: [
        { pubkey: delegatedDataCredits, isSigner: false, isWritable: true },
        { pubkey: DATA_CREDITS_PDA, isSigner: false, isWritable: false },
        { pubkey: DC_MINT_KEY, isSigner: false, isWritable: false },
        { pubkey: DAO_PDA, isSigner: false, isWritable: false },
        { pubkey: SUB_DAO_PDA, isSigner: false, isWritable: false },
        { pubkey: ownerPubkey, isSigner: true, isWritable: false },
        { pubkey: dcAta, isSigner: false, isWritable: true },
        { pubkey: escrowAccount, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: true, isWritable: true },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });
    const { blockhash } = await connection.getLatestBlockhash();

    const message = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: blockhash,
      instructions: [computeBudgetIx, computePriceIx, delegateIx],
    }).compileToLegacyMessage();

    const vtx = new VersionedTransaction(message);

    return jsonResponse({
      transaction: Buffer.from(vtx.serialize()).toString("base64"),
      oui,
      payer: routerKey,
      escrow: escrowAccount.toBase58(),
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to build delegate transaction: ${err.message}` }, 500);
  }
}
