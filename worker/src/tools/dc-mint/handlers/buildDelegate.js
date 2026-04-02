/**
 * Build an unsigned delegate_data_credits_v0 transaction.
 * Resolves OUI → payer key, builds the delegation instruction.
 */
import { PublicKey, TransactionInstruction, SystemProgram, Connection } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { getOuiByNumber } from "../../oui-notifier/services/ouis.js";
import {
  DATA_CREDITS_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM,
  DC_MINT_KEY, DATA_CREDITS_PDA, DAO_PDA, SUB_DAO_PDA,
  ataAddress, writeUint64LE, writeUint32LE, hashName, buildUnsignedTx,
} from "../lib/solana.js";

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
  if (!amount || !Number.isInteger(amount) || amount <= 0) return jsonResponse({ error: "Invalid DC amount (must be a positive integer)" }, 400);
  if (!oui) return jsonResponse({ error: "Missing OUI number" }, 400);

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  try {
    const ouiNum = parseInt(oui, 10);
    if (!ouiNum || ouiNum <= 0) return jsonResponse({ error: "Invalid OUI number" }, 400);
    const ouiData = await getOuiByNumber(env, ouiNum);
    if (!ouiData?.payer) {
      return jsonResponse({ error: `OUI ${oui} not found or has no payer key` }, 404);
    }
    const routerKey = ouiData.payer;
    const connection = new Connection(env.SOLANA_RPC_URL);

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

    const delegateIx = new TransactionInstruction({
      programId: DATA_CREDITS_PROGRAM,
      keys: [
        { pubkey: delegatedDataCredits, isSigner: false, isWritable: true },
        { pubkey: DATA_CREDITS_PDA, isSigner: false, isWritable: false },
        { pubkey: DC_MINT_KEY, isSigner: false, isWritable: false },
        { pubkey: DAO_PDA, isSigner: false, isWritable: false },
        { pubkey: SUB_DAO_PDA, isSigner: false, isWritable: false },
        { pubkey: ownerPubkey, isSigner: true, isWritable: false },
        { pubkey: ataAddress(ownerPubkey, DC_MINT_KEY), isSigner: false, isWritable: true },
        { pubkey: escrowAccount, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: true, isWritable: true },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const vtx = await buildUnsignedTx(connection, ownerPubkey, [delegateIx]);

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
