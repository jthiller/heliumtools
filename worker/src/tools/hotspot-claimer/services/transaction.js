import {
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  Keypair,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import bs58 from "bs58";
import { HELIUM_COMMON_LUT, TOKENS } from "../config.js";
import {
  LAZY_DIST_PID,
  REWARDS_ORACLE_PID,
  SPL_TOKEN_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  SYSTEM_PROGRAM,
  SPL_ACCOUNT_COMPRESSION,
  CIRCUIT_BREAKER_PROGRAM,
  deriveLazyDistributor,
  deriveRecipient,
  deriveATA,
  deriveCircuitBreaker,
  deriveOracleSigner,
  fetchAccount,
  fetchAsset,
  parseLazyDistributor,
} from "./common.js";

/**
 * Compute Anchor 8-byte discriminator: sha256("global:<name>")[0..8]
 */
async function anchorDiscriminator(name) {
  const data = new TextEncoder().encode(`global:${name}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash).slice(0, 8);
}

/**
 * Encode setCurrentRewardsWrapperV1 args.
 * Args: { oracle_index: u16, current_rewards: u64 }
 */
function encodeSetRewardsArgs(oracleIndex, currentRewards) {
  const buf = Buffer.alloc(10); // 2 + 8
  buf.writeUInt16LE(oracleIndex, 0);
  buf.writeBigUInt64LE(BigInt(currentRewards), 2);
  return buf;
}

/**
 * Encode distributeCompressionRewardsV0 args.
 * Args: { data_hash: [u8;32], creator_hash: [u8;32], root: [u8;32], index: u32 }
 */
function encodeDistributeArgs(dataHash, creatorHash, root, index) {
  const buf = Buffer.alloc(100); // 32 + 32 + 32 + 4
  Buffer.from(dataHash).copy(buf, 0);
  Buffer.from(creatorHash).copy(buf, 32);
  Buffer.from(root).copy(buf, 64);
  buf.writeUInt32LE(index, 96);
  return buf;
}

/**
 * Fetch asset proof from DAS API (Helius).
 */
async function fetchAssetProof(env, assetId) {
  const resp = await fetch(env.SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAssetProof",
      params: { id: assetId },
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`getAssetProof: ${data.error.message}`);
  return data.result;
}

/**
 * Fetch Merkle tree canopy depth by reading the account data.
 *
 * SPL Concurrent Merkle Tree account layout:
 *   Application header:   2 bytes (version + padding)
 *   max_buffer_size:       4 bytes (u32 LE)
 *   max_depth:             4 bytes (u32 LE)
 *   authority:            32 bytes
 *   creation_slot:         8 bytes
 *   padding:               6 bytes
 *   -------- total header: 56 bytes --------
 *   changelog:             maxBufferSize * (32 + 4 + maxDepth * 32) bytes
 *   rightmost_proof:       maxDepth * 32 bytes
 *   canopy:                remaining bytes
 */
async function fetchCanopyDepth(env, merkleTreePubkey) {
  const buf = await fetchAccount(env, merkleTreePubkey);
  if (!buf) return 0;

  // Parse header
  const headerOffset = 2; // application header
  const maxBufferSize = buf.readUInt32LE(headerOffset);
  const maxDepth = buf.readUInt32LE(headerOffset + 4);

  // Compute canopy from remaining space after header + changelog + rightmost proof
  const CMT_HEADER = 56;
  const changelogEntrySize = 32 + 4 + maxDepth * 32;
  const changelog = maxBufferSize * changelogEntrySize;
  const rightmostProof = maxDepth * 32;
  const totalBeforeCanopy = CMT_HEADER + changelog + rightmostProof;

  if (buf.length <= totalBeforeCanopy) return 0;
  const canopyBytes = buf.length - totalBeforeCanopy;
  const canopyNodes = Math.floor(canopyBytes / 32);
  if (canopyNodes <= 0) return 0;
  // A canopy of depth d stores 2^(d+1) - 2 nodes
  const canopyDepth = Math.floor(Math.log2(canopyNodes + 2)) - 1;
  return Math.max(0, canopyDepth);
}

/**
 * Fetch the Helium Address Lookup Table for V0 transaction compression.
 */
async function fetchLookupTable(env) {
  try {
    const accountData = await fetchAccount(env, HELIUM_COMMON_LUT);
    if (!accountData) return null;

    const state = AddressLookupTableAccount.deserialize(accountData);
    return new AddressLookupTableAccount({
      key: new PublicKey(HELIUM_COMMON_LUT),
      state,
    });
  } catch (err) {
    console.error("LUT fetch/deserialize failed:", err.message);
    return null;
  }
}

/**
 * Fetch a recent blockhash.
 */
async function getRecentBlockhash(env) {
  const resp = await fetch(env.SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    }),
  });
  const data = await resp.json();
  return data.result.value.blockhash;
}

/**
 * Parse the payer keypair from environment, with safe error handling.
 */
function parsePayerKeypair(env) {
  try {
    const rawKey = env.HOTSPOT_CLAIM_PAYER_WALLET_PRIVATE_KEY;
    const secretKey = rawKey.startsWith("[")
      ? Uint8Array.from(JSON.parse(rawKey))
      : bs58.decode(rawKey);
    return Keypair.fromSecretKey(secretKey);
  } catch {
    throw new Error("Claim service configuration error");
  }
}

/**
 * Build and broadcast a claim transaction for a single token.
 * Returns { txSignature, token, decimals } on success.
 */
export async function claimRewardsForToken(
  env,
  tokenKey,
  assetId,
  owner,
  keyToAssetKey,
  oracleRewards,
  destination,
  recipientExists = true
) {
  const tokenConfig = TOKENS[tokenKey];
  const mint = new PublicKey(tokenConfig.mint);
  const assetPk = new PublicKey(assetId);
  const ownerPk = new PublicKey(owner);
  const keyToAssetPk = new PublicKey(keyToAssetKey);

  // When destination is set, rewards go to destination address, not owner
  const rewardRecipientPk = destination
    ? new PublicKey(destination)
    : ownerPk;

  const lazyDistributor = deriveLazyDistributor(mint);
  const recipient = deriveRecipient(lazyDistributor, assetPk);
  const oracleSigner = deriveOracleSigner();

  // Fetch the lazy distributor account for escrow and oracle URLs
  const ldBuf = await fetchAccount(env, lazyDistributor);
  if (!ldBuf) throw new Error("Lazy distributor account not found");
  const ld = parseLazyDistributor(ldBuf);
  const circuitBreaker = deriveCircuitBreaker(ld.rewardsEscrow);
  const destinationATA = deriveATA(rewardRecipientPk, mint);

  const payerKeypair = parsePayerKeypair(env);

  // Build setCurrentRewardsWrapperV1 instructions (one per oracle)
  const setRewardsDiscriminator = await anchorDiscriminator(
    "set_current_rewards_wrapper_v1"
  );

  const setRewardsIxs = oracleRewards.map((oracleReward) => {
    const oracleKey = new PublicKey(oracleReward.oracleKey);
    const args = encodeSetRewardsArgs(oracleReward.oracleIndex, oracleReward.currentRewards);

    return new TransactionInstruction({
      programId: REWARDS_ORACLE_PID,
      keys: [
        { pubkey: oracleKey, isSigner: true, isWritable: false },
        { pubkey: lazyDistributor, isSigner: false, isWritable: false },
        { pubkey: recipient, isSigner: false, isWritable: true },
        { pubkey: keyToAssetPk, isSigner: false, isWritable: false },
        { pubkey: oracleSigner, isSigner: false, isWritable: false },
        { pubkey: LAZY_DIST_PID, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([setRewardsDiscriminator, args]),
    });
  });

  // Fetch compression data (needed for both init and distribute in standard path)
  let merkleTree, proofAccounts;
  let dataHash, creatorHash, root, leafIndex;

  const needsCompressionData = !destination;
  if (needsCompressionData) {
    const [asset, assetProof] = await Promise.all([
      fetchAsset(env, assetId),
      fetchAssetProof(env, assetId),
    ]);

    merkleTree = new PublicKey(assetProof.tree_id);
    const canopyDepth = await fetchCanopyDepth(env, merkleTree.toBase58());
    const proof = assetProof.proof || [];
    const trimmedProof = proof.slice(0, Math.max(0, proof.length - canopyDepth));

    dataHash = asset.compression.data_hash.startsWith("0x")
      ? Buffer.from(asset.compression.data_hash.slice(2), "hex")
      : Buffer.from(bs58.decode(asset.compression.data_hash));
    creatorHash = asset.compression.creator_hash.startsWith("0x")
      ? Buffer.from(asset.compression.creator_hash.slice(2), "hex")
      : Buffer.from(bs58.decode(asset.compression.creator_hash));
    root = Buffer.from(bs58.decode(assetProof.root));
    leafIndex = asset.compression.leaf_id;
    proofAccounts = trimmedProof.map((p) => ({
      pubkey: new PublicKey(p),
      isSigner: false,
      isWritable: false,
    }));
  }

  // Build initializeCompressionRecipientV0 if recipient PDA doesn't exist
  let initIx = null;
  if (!recipientExists && needsCompressionData) {
    const initDiscriminator = await anchorDiscriminator(
      "initialize_compression_recipient_v0"
    );
    const initArgs = encodeDistributeArgs(dataHash, creatorHash, root, leafIndex);

    initIx = new TransactionInstruction({
      programId: LAZY_DIST_PID,
      keys: [
        { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: lazyDistributor, isSigner: false, isWritable: false },
        { pubkey: recipient, isSigner: false, isWritable: true },
        { pubkey: merkleTree, isSigner: false, isWritable: false },
        { pubkey: ownerPk, isSigner: false, isWritable: false },
        { pubkey: ownerPk, isSigner: false, isWritable: false }, // delegate = owner
        { pubkey: SPL_ACCOUNT_COMPRESSION, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        ...proofAccounts,
      ],
      data: Buffer.concat([initDiscriminator, initArgs]),
    });
  }

  // Build the distribute instruction based on whether a custom destination is set
  let distributeIx;

  if (destination) {
    // Custom destination path: no Merkle proof needed
    const customDestDiscriminator = await anchorDiscriminator(
      "distribute_custom_destination_v0"
    );

    distributeIx = new TransactionInstruction({
      programId: LAZY_DIST_PID,
      keys: [
        // common accounts (DistributeRewardsCommonV0)
        { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: lazyDistributor, isSigner: false, isWritable: false },
        { pubkey: recipient, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: ld.rewardsEscrow, isSigner: false, isWritable: true },
        { pubkey: circuitBreaker, isSigner: false, isWritable: true },
        { pubkey: rewardRecipientPk, isSigner: false, isWritable: true },
        { pubkey: destinationATA, isSigner: false, isWritable: true },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: CIRCUIT_BREAKER_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SPL_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      // No args after discriminator for custom destination
      data: Buffer.from(customDestDiscriminator),
    });
  } else {
    const distributeDiscriminator = await anchorDiscriminator(
      "distribute_compression_rewards_v0"
    );
    const distributeArgs = encodeDistributeArgs(
      dataHash, creatorHash, root, leafIndex
    );

    distributeIx = new TransactionInstruction({
      programId: LAZY_DIST_PID,
      keys: [
        // common accounts (DistributeRewardsCommonV0)
        { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: lazyDistributor, isSigner: false, isWritable: false },
        { pubkey: recipient, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: ld.rewardsEscrow, isSigner: false, isWritable: true },
        { pubkey: circuitBreaker, isSigner: false, isWritable: true },
        { pubkey: ownerPk, isSigner: false, isWritable: true },
        { pubkey: destinationATA, isSigner: false, isWritable: true },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: CIRCUIT_BREAKER_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SPL_TOKEN_PROGRAM, isSigner: false, isWritable: false },
        // compression-specific accounts
        { pubkey: merkleTree, isSigner: false, isWritable: false },
        { pubkey: SPL_ACCOUNT_COMPRESSION, isSigner: false, isWritable: false },
        // merkle proof remaining accounts
        ...proofAccounts,
      ],
      data: Buffer.concat([distributeDiscriminator, distributeArgs]),
    });
  }

  // Build the transaction with Address Lookup Table for size reduction
  const [blockhash, lookupTable] = await Promise.all([
    getRecentBlockhash(env),
    fetchLookupTable(env),
  ]);
  const allInstructions = [
    ...(initIx ? [initIx] : []),
    ...setRewardsIxs,
    distributeIx,
  ];
  const lookupTables = lookupTable ? [lookupTable] : [];

  const messageV0 = new TransactionMessage({
    payerKey: payerKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(messageV0);

  // Capture the original message for post-oracle verification
  const originalMessage = Buffer.from(tx.message.serialize());

  // Send to each oracle for signing
  let serializedTx = Buffer.from(tx.serialize());

  for (const { url: oracleUrl } of ld.oracles) {
    const resp = await fetch(oracleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction: serializedTx.toJSON(),
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Oracle signing failed (${oracleUrl}): ${errText}`);
    }

    const result = await resp.json();
    serializedTx = Buffer.from(result.transaction);
  }

  // Deserialize the oracle-signed transaction and verify integrity
  const signedTx = VersionedTransaction.deserialize(serializedTx);

  const returnedMessage = Buffer.from(signedTx.message.serialize());
  if (!originalMessage.equals(returnedMessage)) {
    throw new Error("Oracle tampered with transaction message");
  }

  // Add our payer signature
  signedTx.sign([payerKeypair]);

  // Broadcast the transaction.
  // Helius staked endpoints are read-only; derive the standard endpoint for sends.
  const sendRpcUrl = env.SOLANA_RPC_URL.replace(
    "staked.helius-rpc.com",
    "mainnet.helius-rpc.com"
  );
  const sendResp = await fetch(sendRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [
        Buffer.from(signedTx.serialize()).toString("base64"),
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
        },
      ],
    }),
  });

  const sendData = await sendResp.json();
  if (sendData.error) {
    // Simulate to get detailed error logs (best-effort for debugging)
    try {
      const simResp = await fetch(sendRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "simulateTransaction",
          params: [
            Buffer.from(signedTx.serialize()).toString("base64"),
            {
              encoding: "base64",
              commitment: "confirmed",
              replaceRecentBlockhash: true,
              sigVerify: false,
            },
          ],
        }),
      });
      const simData = await simResp.json();
      const logs = simData.result?.value?.logs || [];
      const errorLog = logs.find((l) => l.includes("Error") || l.includes("failed"));
      if (errorLog) console.error("Sim detail:", errorLog);
    } catch {
      // Simulation is best-effort for debugging
    }
    throw new Error(
      `Transaction failed: ${sendData.error.message || JSON.stringify(sendData.error)}`
    );
  }

  return {
    txSignature: sendData.result,
    token: tokenConfig.label,
    decimals: tokenConfig.decimals,
  };
}
