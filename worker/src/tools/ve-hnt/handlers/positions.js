import { PublicKey } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import {
  HNT_MINT,
  HNT_REGISTRAR_KEY,
  IOT_SUB_DAO_KEY,
  MOBILE_SUB_DAO_KEY,
  DAO_KEY,
  SECONDS_PER_EPOCH,
  positionKey,
  delegatedPositionKey,
  daoEpochInfoKey,
  subDaoEpochInfoKey,
  currentEpoch as computeCurrentEpoch,
} from "../../../lib/helium-solana.js";
import { fetchAccount, fetchMultipleAccounts } from "../../hotspot-claimer/services/common.js";
import { MAX_POSITION_LOOKUPS_PER_MINUTE } from "../config.js";
import { parseSolanaAddress, formatNative } from "../utils.js";
import {
  decodePosition,
  decodeDelegatedPosition,
  decodeRegistrar,
  decodeDao,
  decodeDaoEpochInfo,
  decodeSubDaoEpochInfo,
  isEpochClaimed,
} from "../services/decode.js";
import { findPositionMints } from "../services/discovery.js";
import {
  computeVeHnt,
  computePendingRewards,
  approximateDailyReward,
} from "../services/compute.js";
import { RegistrarCache, DaoCache, DaoEpochInfoCache } from "../services/cache.js";

const HNT_DECIMALS = 8;

// Sub-DAO label table: maps known sub_dao keys → human name.
const SUB_DAO_LABELS = {
  [IOT_SUB_DAO_KEY.toBase58()]: "IOT",
  [MOBILE_SUB_DAO_KEY.toBase58()]: "MOBILE",
};

function subDaoLabel(subDaoPubkey) {
  return SUB_DAO_LABELS[subDaoPubkey.toBase58()] || "Unknown";
}

const DEFAULT_PUBKEY = "11111111111111111111111111111111";

function proxyFromPosition(position, wallet) {
  const vc = position.voteController.toBase58();
  if (vc === DEFAULT_PUBKEY) return null;
  if (vc === wallet.toBase58()) return null;
  return { voteController: vc };
}

export async function handlePositions(url, env, request) {
  const limitErr = await checkIpRateLimit(env, request, {
    prefix: "rl:vehnt:positions",
    maxRequests: MAX_POSITION_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (limitErr) return limitErr;

  const walletParam = url.searchParams.get("wallet");
  const wallet = parseSolanaAddress(walletParam);
  if (!wallet) {
    return jsonResponse({ error: "Invalid Solana wallet address." }, 400);
  }

  try {
    const nowTs = Math.floor(Date.now() / 1000);
    const currentEpoch = computeCurrentEpoch(nowTs);

    // Registrar fetch and NFT discovery are independent — parallelize.
    const [registrarBuf, mints] = await Promise.all([
      RegistrarCache(env, () => fetchAccount(env, HNT_REGISTRAR_KEY)),
      findPositionMints(env, wallet),
    ]);

    if (!registrarBuf) {
      return jsonResponse({ error: "Failed to load HNT registrar." }, 500);
    }
    const registrar = decodeRegistrar(registrarBuf);
    const hntVotingMintIdx = registrar.votingMints.findIndex(
      (vmc) => vmc.mint.toBase58() === HNT_MINT.toBase58(),
    );
    if (hntVotingMintIdx === -1) {
      return jsonResponse({ error: "Registrar missing HNT voting mint." }, 500);
    }
    if (mints.length === 0) {
      return jsonResponse({
        wallet: wallet.toBase58(),
        currentEpoch,
        totals: {
          hntLocked: "0",
          veHnt: "0",
          pendingRewardsHnt: "0",
          positionCount: 0,
        },
        positions: [],
      });
    }

    // 3. Batch-fetch PositionV0 + DelegatedPositionV0 for every mint
    const positionKeys = mints.map((m) => positionKey(m));
    const delegatedKeys = positionKeys.map((p) => delegatedPositionKey(p));
    const fetched = await fetchMultipleAccounts(env, [...positionKeys, ...delegatedKeys]);
    const positionBufs = fetched.slice(0, positionKeys.length);
    const delegatedBufs = fetched.slice(positionKeys.length);

    const positions = [];
    const decoded = [];
    for (let i = 0; i < mints.length; i++) {
      const posBuf = positionBufs[i];
      if (!posBuf) continue; // stale/burned NFT
      const position = decodePosition(posBuf);
      const delegation = delegatedBufs[i]
        ? decodeDelegatedPosition(delegatedBufs[i])
        : null;
      decoded.push({ mint: mints[i], position, delegation });
    }

    // 4. Collect unique (subDao, epoch) pairs to fetch for pending rewards
    //    Post-HIP-138/141 rewards come from DAO epoch info, not SubDAO epoch info.
    //    We still fetch DaoEpochInfoV0 per unclaimed epoch per position.
    const epochsNeeded = new Set();
    for (const { delegation } of decoded) {
      if (!delegation || delegation.purged) continue;
      for (let e = delegation.lastClaimedEpoch + 1; e < currentEpoch; e++) {
        if (!isEpochClaimed(delegation, e)) epochsNeeded.add(e);
      }
    }
    // Also fetch currentEpoch - 1 for daily-rate approximation (the last fully-issued epoch)
    const lastFullEpoch = currentEpoch - 1;
    if (lastFullEpoch >= 0) epochsNeeded.add(lastFullEpoch);

    // 5. Resolve each epoch from both reward sources in parallel:
    //    - DaoEpochInfoV0  — post-HIP-138 HNT rewards (claim_rewards_v1)
    //    - SubDaoEpochInfoV0 — pre-HIP-138 DNT rewards per sub-dao (claim_rewards_v0)
    // Cached for past (immutable) epochs. SubDao epoch info is keyed by sub-dao too.
    const daoEpochInfoByEpoch = new Map();
    const subDaoEpochInfoByKey = new Map(); // key: `${subDao58}:${epoch}`
    const epochsList = Array.from(epochsNeeded).sort((a, b) => a - b);
    if (epochsList.length > 0) {
      const uniqueSubDaos = new Map(); // subDao58 -> PublicKey
      for (const { delegation } of decoded) {
        if (delegation) uniqueSubDaos.set(delegation.subDao.toBase58(), delegation.subDao);
      }

      const daoFetches = epochsList.map((epoch) =>
        DaoEpochInfoCache(env, epoch, () =>
          fetchAccount(env, daoEpochInfoKey(DAO_KEY, epoch)),
        ),
      );
      const subDaoFetches = [];
      for (const [sdStr, sd] of uniqueSubDaos) {
        for (const epoch of epochsList) {
          subDaoFetches.push({
            key: `${sdStr}:${epoch}`,
            epoch,
            promise: fetchAccount(env, subDaoEpochInfoKey(sd, epoch)),
          });
        }
      }

      const [daoBufs, subDaoResults] = await Promise.all([
        Promise.all(daoFetches),
        Promise.all(subDaoFetches.map((x) => x.promise)),
      ]);

      for (let i = 0; i < epochsList.length; i++) {
        if (daoBufs[i]) {
          try {
            daoEpochInfoByEpoch.set(epochsList[i], decodeDaoEpochInfo(daoBufs[i]));
          } catch (e) {
            console.error("decodeDaoEpochInfo failed", epochsList[i], e?.message);
          }
        }
      }
      for (let i = 0; i < subDaoFetches.length; i++) {
        const buf = subDaoResults[i];
        if (!buf) continue;
        try {
          subDaoEpochInfoByKey.set(subDaoFetches[i].key, decodeSubDaoEpochInfo(buf));
        } catch (e) {
          console.error("decodeSubDaoEpochInfo failed", subDaoFetches[i].key, e?.message);
        }
      }
    }

    // 6. Compute per-position fields
    let totalLocked = 0n;
    let totalVeHnt = 0n;
    let totalPendingHnt = 0n;
    let totalPendingDntIot = 0n;
    let totalPendingDntMobile = 0n;
    const votingMintConfig = registrar.votingMints[hntVotingMintIdx];

    for (const { mint, position, delegation } of decoded) {
      const { veHnt, isLandrush, multiplier } = computeVeHnt(
        position,
        votingMintConfig,
        nowTs,
      );

      let pendingHnt = null;
      let pendingDnt = null;
      let unclaimedEpochsCount = 0;
      let dailyReward = null;
      let delegationOut = null;

      if (delegation) {
        const subDao58 = delegation.subDao.toBase58();
        const subDaoEpochMap = new Map();
        for (const e of epochsList || []) {
          const v = subDaoEpochInfoByKey.get(`${subDao58}:${e}`);
          if (v) subDaoEpochMap.set(e, v);
        }

        const rewards = computePendingRewards({
          position,
          delegatedPosition: delegation,
          votingMintConfig,
          daoEpochInfoByEpoch,
          subDaoEpochInfoByEpoch: subDaoEpochMap,
          currentEpoch,
          secondsPerEpoch: SECONDS_PER_EPOCH,
        });
        pendingHnt = rewards.pendingRewardsHnt;
        pendingDnt = rewards.pendingRewardsDnt;
        unclaimedEpochsCount = rewards.unclaimedEpochsCount;

        const lastInfo = daoEpochInfoByEpoch.get(lastFullEpoch);
        dailyReward = approximateDailyReward({
          position,
          votingMintConfig,
          daoEpochInfo: lastInfo,
        });

        delegationOut = {
          subDao: subDaoLabel(delegation.subDao),
          subDaoAddress: subDao58,
          startTs: delegation.startTs,
          expirationTs: delegation.expirationTs,
          lastClaimedEpoch: delegation.lastClaimedEpoch,
          unclaimedEpochs: unclaimedEpochsCount,
          purged: delegation.purged,
        };

        totalPendingHnt += pendingHnt;
        const label = subDaoLabel(delegation.subDao);
        if (label === "IOT") totalPendingDntIot += pendingDnt;
        else if (label === "MOBILE") totalPendingDntMobile += pendingDnt;
      }

      totalLocked += BigInt(position.amountDepositedNative);
      totalVeHnt += veHnt;

      const dntLabel = delegation ? subDaoLabel(delegation.subDao) : null;
      const pendingRewardsOut = delegation
        ? {
            hnt: formatNative(pendingHnt, HNT_DECIMALS),
            dnt: pendingDnt > 0n ? formatNative(pendingDnt, 6) : "0",
            dntLabel,
          }
        : null;

      positions.push({
        sortKey: veHnt,
        out: {
          mint: mint.toBase58(),
          positionKey: positionKey(mint).toBase58(),
          amountLockedHnt: formatNative(position.amountDepositedNative, HNT_DECIMALS),
          lockup: {
            kind: position.lockup.kind,
            startTs: position.lockup.startTs,
            endTs: position.lockup.endTs,
            timeRemainingSecs: Math.max(0, position.lockup.endTs - nowTs),
            // Constant lockups never "expire" in voting-power terms —
            // their end_ts is just the minimum unwind period if converted
            // to Cliff. Only Cliff lockups truly end.
            isExpired:
              position.lockup.kind === "Cliff" && position.lockup.endTs <= nowTs,
          },
          veHnt: formatNative(veHnt, HNT_DECIMALS),
          isLandrush,
          landrushMultiplier: multiplier,
          delegation: delegationOut,
          pendingRewards: pendingRewardsOut,
          pendingRewardsHnt: pendingRewardsOut ? pendingRewardsOut.hnt : null,
          pendingRewardsApprox: delegation ? "current-vehnt" : null,
          dailyRewardHnt: dailyReward === null ? null : formatNative(dailyReward, HNT_DECIMALS),
          numActiveVotes: position.numActiveVotes,
          recentProposalsCount: position.recentProposals.length,
          proxy: proxyFromPosition(position, wallet),
        },
      });
    }

    positions.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
    const sortedPositions = positions.map((p) => p.out);

    console.log(
      JSON.stringify({
        event: "vehnt_positions",
        wallet: wallet.toBase58(),
        positionCount: sortedPositions.length,
        currentEpoch,
      }),
    );

    return jsonResponse({
      wallet: wallet.toBase58(),
      currentEpoch,
      totals: {
        hntLocked: formatNative(totalLocked, HNT_DECIMALS),
        veHnt: formatNative(totalVeHnt, HNT_DECIMALS),
        pendingRewardsHnt: formatNative(totalPendingHnt, HNT_DECIMALS),
        pendingRewardsIot: formatNative(totalPendingDntIot, 6),
        pendingRewardsMobile: formatNative(totalPendingDntMobile, 6),
        positionCount: sortedPositions.length,
      },
      positions: sortedPositions,
    });
  } catch (err) {
    console.error("ve-hnt positions error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to fetch positions." }, 500);
  }
}
