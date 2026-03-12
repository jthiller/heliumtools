import { PublicKey } from "@solana/web3.js";
import { TOKENS } from "../config.js";
import {
  deriveLazyDistributor,
  deriveRecipient,
  deriveATA,
  fetchAccount,
  parseLazyDistributor,
  parseRecipient,
} from "./common.js";

/**
 * Query an oracle for the current lifetime rewards of an asset.
 */
async function queryOracle(oracleUrl, assetId) {
  const url = `${oracleUrl}?assetId=${assetId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Oracle ${oracleUrl} returned ${response.status}`);
  }
  const data = await response.json();
  return data.currentRewards;
}

/**
 * Check if an ATA (Associated Token Account) exists.
 */
async function checkATAExists(env, owner, mint) {
  const ata = deriveATA(new PublicKey(owner), new PublicKey(mint));
  return (await fetchAccount(env, ata)) !== null;
}

/**
 * Get pending rewards for a single token type.
 */
async function getTokenRewards(env, tokenKey, assetId, owner) {
  const tokenConfig = TOKENS[tokenKey];
  const lazyDistPDA = deriveLazyDistributor(tokenConfig.mint);

  // Fetch the lazy distributor account to get oracle URLs
  let ldData;
  try {
    ldData = await fetchAccount(env, lazyDistPDA);
  } catch (err) {
    console.error(`Failed to fetch lazy distributor for ${tokenKey}:`, err.message);
    return { pending: "0", claimable: false, reason: "rpc_error", error: err.message };
  }
  if (!ldData) {
    return { pending: "0", claimable: false, reason: "no_distributor" };
  }

  const ld = parseLazyDistributor(ldData);

  // Query each oracle for lifetime rewards, preserving original index
  const oracleRewards = await Promise.all(
    ld.oracles.map(async (o, index) => {
      try {
        const rewards = await queryOracle(o.url, assetId);
        return { oracleKey: o.oracle, currentRewards: rewards, oracleIndex: index };
      } catch {
        return null;
      }
    })
  );
  const validRewards = oracleRewards.filter(Boolean);

  if (validRewards.length === 0) {
    return { pending: "0", claimable: false, reason: "no_oracle_response" };
  }

  // Take the median of oracle responses
  const sorted = validRewards
    .map((r) => BigInt(r.currentRewards))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const medianLifetime = sorted[Math.floor(sorted.length / 2)];

  // Fetch the recipient account to see how much has already been claimed
  const recipientPDA = deriveRecipient(lazyDistPDA, assetId);
  let recipientData;
  try {
    recipientData = await fetchAccount(env, recipientPDA);
  } catch (err) {
    console.error(`Failed to fetch recipient for ${tokenKey}:`, err.message);
    return { pending: "0", claimable: false, reason: "rpc_error", error: err.message };
  }
  let totalClaimed = 0n;
  let destination = null;
  if (recipientData) {
    const recipient = parseRecipient(recipientData);
    totalClaimed = recipient.totalRewards;
    destination = recipient.destination;
  }

  const pending = medianLifetime - totalClaimed;
  if (pending <= 0n) {
    return {
      pending: "0",
      claimable: false,
      reason: "no_pending",
      decimals: tokenConfig.decimals,
      label: tokenConfig.label,
      destination,
    };
  }

  // Check ATA for the actual reward recipient (destination if set, else owner)
  const ataOwner = destination || owner;
  let ataExists;
  try {
    ataExists = await checkATAExists(env, ataOwner, tokenConfig.mint);
  } catch (err) {
    console.error(`Failed to check ATA for ${tokenKey}:`, err.message);
    return {
      pending: pending.toString(),
      claimable: false,
      reason: "rpc_error",
      error: err.message,
      decimals: tokenConfig.decimals,
      label: tokenConfig.label,
      destination,
    };
  }
  if (!ataExists) {
    return {
      pending: pending.toString(),
      claimable: false,
      reason: "no_ata",
      decimals: tokenConfig.decimals,
      label: tokenConfig.label,
      destination,
    };
  }

  return {
    pending: pending.toString(),
    claimable: true,
    recipientExists: !!recipientData,
    decimals: tokenConfig.decimals,
    label: tokenConfig.label,
    destination,
    oracleRewards: validRewards.map((r) => ({
      oracleKey: r.oracleKey.toBase58(),
      currentRewards: r.currentRewards,
      oracleIndex: r.oracleIndex,
    })),
    lazyDistributor: lazyDistPDA.toBase58(),
    recipientKey: recipientPDA.toBase58(),
  };
}

/**
 * Get pending rewards across all token types for a hotspot.
 */
export async function getPendingRewards(env, assetId, owner) {
  const [iot, mobile, hnt] = await Promise.all(
    ["iot", "mobile", "hnt"].map((key) =>
      getTokenRewards(env, key, assetId, owner).catch((err) => ({
        pending: "0",
        claimable: false,
        reason: "error",
        error: err.message,
      }))
    )
  );

  return { iot, mobile, hnt };
}
