import {
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  VSR_PROGRAM,
  SUB_DAOS,
  CIRCUIT_BREAKER_PROGRAM,
  SPL_TOKEN,
  SPL_ATA,
  HNT_MINT,
  HNT_REGISTRAR_KEY,
  DAO_KEY,
  positionKey as derivePositionKey,
  delegatedPositionKey as deriveDelegatedPositionKey,
  daoEpochInfoKey,
  circuitBreakerKey,
  ataAddress,
  anchorDiscriminator,
} from "../../../lib/helium-solana.js";
import { MAX_EPOCHS_PER_CLAIM_TX } from "../config.js";

// claim_rewards_v1 arg: { epoch: u64 }
function encodeClaimArgs(epoch) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(epoch));
  return buf;
}

/**
 * Build a single claim_rewards_v1 instruction.
 *
 * Account list from helium-sub-daos/src/instructions/delegation/claim_rewards_v1.rs:
 *   position (mut), mint (mut), position_token_account (read), position_authority (signer),
 *   registrar (mut), dao (mut), sub_dao (mut), delegated_position (mut), hnt_mint (mut),
 *   dao_epoch_info (read), delegator_pool (mut), delegator_ata (mut; init_if_needed),
 *   delegator_pool_circuit_breaker (mut), vsr_program, system_program,
 *   circuit_breaker_program, associated_token_program, token_program, payer (signer, mut)
 */
function buildClaimRewardsV1Ix({
  positionAuthority,
  mint,
  positionTokenAccount,
  positionKey,
  delegatedPositionKey,
  subDao,
  delegatorPool,
  delegatorPoolCircuitBreaker,
  delegatorAta,
  epoch,
}) {
  const disc = anchorDiscriminator("claim_rewards_v1");
  const data = Buffer.concat([disc, encodeClaimArgs(epoch)]);
  const payer = positionAuthority;

  const keys = [
    { pubkey: positionKey, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: positionTokenAccount, isSigner: false, isWritable: false },
    { pubkey: positionAuthority, isSigner: true, isWritable: true },
    { pubkey: HNT_REGISTRAR_KEY, isSigner: false, isWritable: true },
    { pubkey: DAO_KEY, isSigner: false, isWritable: true },
    { pubkey: subDao, isSigner: false, isWritable: true },
    { pubkey: delegatedPositionKey, isSigner: false, isWritable: true },
    { pubkey: HNT_MINT, isSigner: false, isWritable: true },
    { pubkey: daoEpochInfoKey(DAO_KEY, epoch), isSigner: false, isWritable: false },
    { pubkey: delegatorPool, isSigner: false, isWritable: true },
    { pubkey: delegatorAta, isSigner: false, isWritable: true },
    { pubkey: delegatorPoolCircuitBreaker, isSigner: false, isWritable: true },
    { pubkey: VSR_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: CIRCUIT_BREAKER_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: SPL_ATA, isSigner: false, isWritable: false },
    { pubkey: SPL_TOKEN, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
  ];

  return new TransactionInstruction({ keys, programId: SUB_DAOS, data });
}

/**
 * Build one or more unsigned VersionedTransactions that claim rewards for
 * `epochs` on a single delegated position. Epochs are chunked into groups
 * of MAX_EPOCHS_PER_CLAIM_TX; each group becomes one transaction.
 *
 * Returns an array of base64-encoded serialized transactions ready to be
 * signed by the wallet adapter and broadcast via Connection.sendRawTransaction.
 */
export async function buildClaimTransactions({
  positionAuthority,
  mint,
  subDao,
  delegatorPool,
  epochs,
  blockhash,
}) {
  const positionKey = derivePositionKey(mint);
  const delegatedPositionKey = deriveDelegatedPositionKey(positionKey);
  const positionTokenAccount = ataAddress(positionAuthority, mint);
  const delegatorPoolCircuitBreaker = circuitBreakerKey(delegatorPool);
  const delegatorAta = ataAddress(positionAuthority, HNT_MINT);

  const chunks = [];
  for (let i = 0; i < epochs.length; i += MAX_EPOCHS_PER_CLAIM_TX) {
    chunks.push(epochs.slice(i, i + MAX_EPOCHS_PER_CLAIM_TX));
  }

  const txBase64 = chunks.map((chunkEpochs) => {
    const ixs = chunkEpochs.map((epoch) =>
      buildClaimRewardsV1Ix({
        positionAuthority,
        mint,
        positionTokenAccount,
        positionKey,
        delegatedPositionKey,
        subDao,
        delegatorPool,
        delegatorPoolCircuitBreaker,
        delegatorAta,
        epoch,
      }),
    );

    const message = new TransactionMessage({
      payerKey: positionAuthority,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    // Serialize without signatures so the client wallet adapter can sign.
    return Buffer.from(tx.serialize()).toString("base64");
  });

  return txBase64;
}
