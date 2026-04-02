/**
 * Build an unsigned mint_data_credits_v0 transaction.
 * The user's browser wallet signs and submits it.
 */
import { PublicKey, TransactionInstruction, SystemProgram, Connection } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { HNT_DECIMALS } from "../../dc-purchase/lib/constants.js";
import {
  DATA_CREDITS_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM,
  CIRCUIT_BREAKER_PROGRAM, HNT_PYTH_PRICE_FEED,
  HNT_MINT_KEY, DC_MINT_KEY, DATA_CREDITS_PDA, CIRCUIT_BREAKER_PDA,
  ataAddress, writeUint64LE, buildUnsignedTx,
} from "../lib/solana.js";

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
  if (hnt_amount && (typeof hnt_amount !== "number" || !Number.isFinite(hnt_amount) || hnt_amount <= 0)) {
    return jsonResponse({ error: "hnt_amount must be a positive number" }, 400);
  }
  if (dc_amount && (!Number.isInteger(dc_amount) || dc_amount <= 0)) {
    return jsonResponse({ error: "dc_amount must be a positive integer" }, 400);
  }

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
    // Borsh Option: None = [0x00] (1 byte), Some(val) = [0x01, ...val_le] (9 bytes)
    const parts = [];
    if (hnt_amount) {
      // Decimal-safe conversion: avoid float math by splitting on '.'
      const [whole, frac = ""] = String(hnt_amount).split(".");
      const padded = (frac + "00000000").slice(0, HNT_DECIMALS);
      const hntLamports = BigInt(whole) * BigInt(10 ** HNT_DECIMALS) + BigInt(padded);
      const some = new Uint8Array(9);
      some[0] = 1;
      writeUint64LE(some, hntLamports, 1);
      parts.push(some, new Uint8Array([0])); // Some(hnt) + None(dc)
    } else {
      const some = new Uint8Array(9);
      some[0] = 1;
      writeUint64LE(some, BigInt(dc_amount), 1);
      parts.push(new Uint8Array([0]), some); // None(hnt) + Some(dc)
    }
    const argsBuffer = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) { argsBuffer.set(p, offset); offset += p.length; }

    const instructionData = new Uint8Array(MINT_DISCRIMINATOR.length + argsBuffer.length);
    instructionData.set(MINT_DISCRIMINATOR, 0);
    instructionData.set(argsBuffer, MINT_DISCRIMINATOR.length);

    const mintIx = new TransactionInstruction({
      programId: DATA_CREDITS_PROGRAM,
      keys: [
        { pubkey: DATA_CREDITS_PDA, isSigner: false, isWritable: false },
        { pubkey: HNT_PYTH_PRICE_FEED, isSigner: false, isWritable: false },
        { pubkey: ataAddress(ownerPubkey, HNT_MINT_KEY), isSigner: false, isWritable: true },
        { pubkey: ataAddress(recipientPubkey, DC_MINT_KEY), isSigner: false, isWritable: true },
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

    const vtx = await buildUnsignedTx(connection, ownerPubkey, [mintIx]);

    return jsonResponse({
      transaction: Buffer.from(vtx.serialize()).toString("base64"),
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to build mint transaction: ${err.message}` }, 500);
  }
}
