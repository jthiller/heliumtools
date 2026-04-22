import { PublicKey } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import {
  DAO_KEY,
  SECONDS_PER_EPOCH,
  positionKey as derivePositionKey,
  delegatedPositionKey as deriveDelegatedPositionKey,
  currentEpoch as computeCurrentEpoch,
} from "../../../lib/helium-solana.js";
import { fetchAccount } from "../../hotspot-claimer/services/common.js";
import {
  MAX_CLAIM_BUILDS_PER_MINUTE,
  MAX_EPOCHS_PER_CLAIM_CALL,
} from "../config.js";
import { parseSolanaAddress } from "../utils.js";
import {
  decodeDelegatedPosition,
  decodeDao,
  isEpochClaimed,
} from "../services/decode.js";
import { DaoCache } from "../services/cache.js";
import { buildClaimTransactions } from "../services/txBuilder.js";

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
  if (data.error) throw new Error(`getLatestBlockhash: ${data.error.message}`);
  return data.result.value.blockhash;
}

export async function handleClaim(request, env) {
  const limitErr = await checkIpRateLimit(env, request, {
    prefix: "rl:vehnt:claim",
    maxRequests: MAX_CLAIM_BUILDS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (limitErr) return limitErr;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const positionAuthority = parseSolanaAddress(body.wallet);
  const mint = parseSolanaAddress(body.positionMint);
  if (!positionAuthority || !mint) {
    return jsonResponse(
      { error: "wallet and positionMint must both be valid Solana addresses." },
      400,
    );
  }

  try {
    // Refetch the delegated position — don't trust client state.
    const positionKey = derivePositionKey(mint);
    const delegatedKey = deriveDelegatedPositionKey(positionKey);
    const [delegatedBuf, daoBuf] = await Promise.all([
      fetchAccount(env, delegatedKey),
      DaoCache(env, () => fetchAccount(env, DAO_KEY)),
    ]);
    if (!delegatedBuf) {
      return jsonResponse(
        { error: "Position is not delegated; no rewards to claim." },
        404,
      );
    }
    if (!daoBuf) {
      return jsonResponse({ error: "Failed to load DAO account." }, 500);
    }

    const delegation = decodeDelegatedPosition(delegatedBuf);
    const dao = decodeDao(daoBuf);

    const nowTs = Math.floor(Date.now() / 1000);
    const currentEpoch = computeCurrentEpoch(nowTs);

    // Compute the unclaimed epoch list (bitmap-aware).
    const unclaimed = [];
    for (let e = delegation.lastClaimedEpoch + 1; e < currentEpoch; e++) {
      if (unclaimed.length >= MAX_EPOCHS_PER_CLAIM_CALL) break;
      if (!isEpochClaimed(delegation, e)) unclaimed.push(e);
    }

    if (unclaimed.length === 0) {
      return jsonResponse({
        transactions: [],
        totalEpochs: 0,
        subDao: delegation.subDao.toBase58(),
        unclaimedEpochsRemaining: 0,
      });
    }

    const blockhash = await getRecentBlockhash(env);
    const transactions = await buildClaimTransactions({
      positionAuthority,
      mint,
      subDao: delegation.subDao,
      delegatorPool: dao.delegatorPool,
      epochs: unclaimed,
      blockhash,
    });

    // How many claimable epochs are left beyond this build call?
    let remaining = 0;
    for (let e = delegation.lastClaimedEpoch + 1 + unclaimed.length; e < currentEpoch; e++) {
      if (!isEpochClaimed(delegation, e)) remaining++;
    }

    console.log(
      JSON.stringify({
        event: "vehnt_claim_build",
        wallet: positionAuthority.toBase58(),
        positionMint: mint.toBase58(),
        epochs: unclaimed.length,
        txs: transactions.length,
      }),
    );

    return jsonResponse({
      transactions,
      totalEpochs: unclaimed.length,
      subDao: delegation.subDao.toBase58(),
      unclaimedEpochsRemaining: remaining,
    });
  } catch (err) {
    console.error("ve-hnt claim error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to build claim transaction." }, 500);
  }
}
