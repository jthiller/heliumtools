import { PublicKey } from "@solana/web3.js";
import { TOKENS } from "../config.js";
import {
  deriveLazyDistributor,
  deriveRecipient,
  deriveATA,
  fetchAccount,
  fetchMultipleAccounts,
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

function rpcError(tokenConfig, { pending = "0", destination = null, error } = {}) {
  return {
    pending,
    claimable: false,
    reason: "rpc_error",
    error,
    decimals: tokenConfig.decimals,
    label: tokenConfig.label,
    destination,
  };
}

const TOKEN_KEYS = Object.keys(TOKENS);

/**
 * Compute the median of an array of BigInt reward values.
 */
function medianBigInt(values) {
  const sorted = values.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)];
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
    return rpcError(tokenConfig, { error: err.message });
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
  const medianLifetime = medianBigInt(validRewards.map((r) => BigInt(r.currentRewards)));

  // Fetch the recipient account to see how much has already been claimed
  const recipientPDA = deriveRecipient(lazyDistPDA, assetId);
  let recipientData;
  try {
    recipientData = await fetchAccount(env, recipientPDA);
  } catch (err) {
    console.error(`Failed to fetch recipient for ${tokenKey}:`, err.message);
    return rpcError(tokenConfig, { error: err.message });
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
    return rpcError(tokenConfig, { pending: pending.toString(), destination, error: err.message });
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
 * Get pending rewards across all token types for a single Hotspot.
 */
export async function getPendingRewards(env, assetId, owner) {
  const tokenResults = await Promise.all(
    TOKEN_KEYS.map((key) =>
      getTokenRewards(env, key, assetId, owner).catch((err) => ({
        pending: "0",
        claimable: false,
        reason: "error",
        error: err.message,
      }))
    )
  );

  const rewards = Object.create(null);
  TOKEN_KEYS.forEach((key, i) => { rewards[key] = tokenResults[i]; });
  return rewards;
}

// ─── Bulk Rewards (batched RPC) ──────────────────────────────────────────────

/**
 * Compute pending rewards from oracle responses, claimed amount, and ATA status.
 */
function computeTokenResult(tokenConfig, oracleResults, { totalClaimed = 0n, destination = null }, ataExists) {
  const validRewards = oracleResults.filter(Boolean);
  if (validRewards.length === 0) {
    return { pending: "0", claimable: false, reason: "no_oracle_response", decimals: tokenConfig.decimals, label: tokenConfig.label, destination };
  }

  const medianLifetime = medianBigInt(validRewards.map((r) => BigInt(r.currentRewards)));

  const pending = medianLifetime - totalClaimed;
  if (pending <= 0n) {
    return { pending: "0", claimable: false, reason: "no_pending", decimals: tokenConfig.decimals, label: tokenConfig.label, destination };
  }

  if (!ataExists) {
    return { pending: pending.toString(), claimable: false, reason: "no_ata", decimals: tokenConfig.decimals, label: tokenConfig.label, destination };
  }

  return { pending: pending.toString(), claimable: true, decimals: tokenConfig.decimals, label: tokenConfig.label, destination };
}

/**
 * Get pending rewards for multiple Hotspots in bulk using batched RPC calls.
 *
 * Instead of N×9 individual getAccountInfo calls, this uses:
 *   1. One getMultipleAccounts for lazy distributors + all recipients
 *   2. Parallel oracle HTTP queries
 *   3. One getMultipleAccounts for deduplicated ATA checks
 *
 * Returns { [entityKey]: { rewards: { iot, mobile, hnt }, error } }
 */
export async function getBulkPendingRewards(env, hotspots, owner) {
  const results = Object.create(null);

  // ── Phase 1: Derive PDAs and batch-fetch lazy distributors + recipients ──

  const lazyDistPDAs = TOKEN_KEYS.map((tk) =>
    deriveLazyDistributor(TOKENS[tk].mint)
  );

  // Recipient PDAs: indexed as [tokenIdx * hotspots.length + hotspotIdx]
  const recipientPDAs = [];
  for (const ldPDA of lazyDistPDAs) {
    for (const h of hotspots) {
      recipientPDAs.push(deriveRecipient(ldPDA, h.assetId));
    }
  }

  // Single batch: 3 lazy distributors + (3 × N) recipients
  const allPhase1PDAs = [...lazyDistPDAs, ...recipientPDAs];
  let phase1Data;
  try {
    phase1Data = await fetchMultipleAccounts(env, allPhase1PDAs);
  } catch (err) {
    // Total RPC failure — return error for all Hotspots
    for (const h of hotspots) {
      results[h.entityKey] = { rewards: null, error: err.message || "RPC batch fetch failed" };
    }
    return results;
  }

  // Split results
  const ldDataByToken = phase1Data.slice(0, 3); // [iot, mobile, hnt]
  const recipientDataFlat = phase1Data.slice(3); // [token0-hs0, token0-hs1, ..., token2-hsN]

  // Parse lazy distributors
  const ldParsed = ldDataByToken.map((data, i) => {
    if (!data) return null;
    try {
      return parseLazyDistributor(data);
    } catch (err) {
      console.error(`Failed to parse lazy distributor for ${TOKEN_KEYS[i]}:`, err.message);
      return null;
    }
  });

  // Parse recipients and extract destinations + claimed amounts
  // recipientsByTokenAndHotspot[tokenIdx][hotspotIdx] = { totalClaimed, destination }
  const recipientsByTokenAndHotspot = TOKEN_KEYS.map((_, tokenIdx) =>
    hotspots.map((_, hsIdx) => {
      const data = recipientDataFlat[tokenIdx * hotspots.length + hsIdx];
      if (!data) return { totalClaimed: 0n, destination: null };
      try {
        const parsed = parseRecipient(data);
        return { totalClaimed: parsed.totalRewards, destination: parsed.destination };
      } catch {
        return { totalClaimed: 0n, destination: null };
      }
    })
  );

  // ── Phase 2: Query oracles in parallel ──

  // oracleResults[tokenIdx][hotspotIdx] = array of { currentRewards } | null
  const oraclePromises = [];
  for (let tokenIdx = 0; tokenIdx < TOKEN_KEYS.length; tokenIdx++) {
    const ld = ldParsed[tokenIdx];
    for (let hsIdx = 0; hsIdx < hotspots.length; hsIdx++) {
      if (!ld) {
        oraclePromises.push(Promise.resolve([]));
        continue;
      }
      const assetId = hotspots[hsIdx].assetId;
      const perOracle = ld.oracles.map(async (o) => {
        try {
          const rewards = await queryOracle(o.url, assetId);
          return { currentRewards: rewards };
        } catch {
          return null;
        }
      });
      oraclePromises.push(Promise.all(perOracle));
    }
  }
  const oracleResultsFlat = await Promise.all(oraclePromises);

  // ── Phase 3: Batch-fetch ATAs ──

  // Collect unique ATA addresses keyed by "owner:mint"
  const ataMap = new Map(); // key → pubkey

  for (let tokenIdx = 0; tokenIdx < TOKEN_KEYS.length; tokenIdx++) {
    const tokenConfig = TOKENS[TOKEN_KEYS[tokenIdx]];
    for (let hsIdx = 0; hsIdx < hotspots.length; hsIdx++) {
      const dest = recipientsByTokenAndHotspot[tokenIdx][hsIdx].destination;
      const ataOwner = dest || owner;
      const ataKey = `${ataOwner}:${tokenConfig.mint}`;
      if (!ataMap.has(ataKey)) {
        ataMap.set(ataKey, deriveATA(new PublicKey(ataOwner), new PublicKey(tokenConfig.mint)));
      }
    }
  }

  const uniqueAtaKeys = [...ataMap.keys()];
  const uniqueAtaPubkeys = uniqueAtaKeys.map((k) => ataMap.get(k));
  const ataExistsMap = new Map(); // ataKey → boolean

  try {
    const ataData = await fetchMultipleAccounts(env, uniqueAtaPubkeys);
    for (let i = 0; i < uniqueAtaKeys.length; i++) {
      ataExistsMap.set(uniqueAtaKeys[i], ataData[i] !== null);
    }
  } catch (err) {
    console.error("Failed to batch-fetch ATAs:", err.message);
    // If ATA check fails, mark all as unknown (not claimable with rpc_error reason)
    for (const key of uniqueAtaKeys) {
      ataExistsMap.set(key, false);
    }
  }

  // ── Phase 4: Assemble results ──

  for (let hsIdx = 0; hsIdx < hotspots.length; hsIdx++) {
    const h = hotspots[hsIdx];
    const rewards = {};

    for (let tokenIdx = 0; tokenIdx < TOKEN_KEYS.length; tokenIdx++) {
      const tokenKey = TOKEN_KEYS[tokenIdx];
      const tokenConfig = TOKENS[tokenKey];
      const ld = ldParsed[tokenIdx];
      const recipInfo = recipientsByTokenAndHotspot[tokenIdx][hsIdx];
      const dest = recipInfo.destination;

      if (!ld) {
        rewards[tokenKey] = { pending: "0", claimable: false, reason: "no_distributor", decimals: tokenConfig.decimals, label: tokenConfig.label, destination: dest };
        continue;
      }

      const oracleIdx = tokenIdx * hotspots.length + hsIdx;
      const oracleResults = oracleResultsFlat[oracleIdx];

      const ataOwner = dest || owner;
      const ataKey = `${ataOwner}:${tokenConfig.mint}`;
      const ataExists = ataExistsMap.get(ataKey) || false;

      rewards[tokenKey] = computeTokenResult(tokenConfig, oracleResults, recipInfo, ataExists);
    }

    results[h.entityKey] = { rewards, error: null };
  }

  return results;
}
