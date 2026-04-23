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
import {
  RegistrarCache,
  batchCachedAccounts,
  DAO_EPOCH_TTL,
} from "../services/cache.js";

const HNT_DECIMALS = 8;
const DNT_DECIMALS = 6;

const SUB_DAO_LABELS = {
  [IOT_SUB_DAO_KEY.toBase58()]: "IOT",
  [MOBILE_SUB_DAO_KEY.toBase58()]: "MOBILE",
};
const subDaoLabel = (pk) => SUB_DAO_LABELS[pk.toBase58()] || "Unknown";

const DEFAULT_PUBKEY = "11111111111111111111111111111111";
function proxyFromPosition(position, wallet) {
  const vc = position.voteController.toBase58();
  if (vc === DEFAULT_PUBKEY || vc === wallet.toBase58()) return null;
  return { voteController: vc };
}

export async function handlePositions(url, env, request) {
  const limitErr = await checkIpRateLimit(env, request, {
    prefix: "rl:vehnt:positions",
    maxRequests: MAX_POSITION_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (limitErr) return limitErr;

  const wallet = parseSolanaAddress(url.searchParams.get("wallet"));
  if (!wallet) return jsonResponse({ error: "Invalid Solana wallet address." }, 400);

  try {
    const nowTs = Math.floor(Date.now() / 1000);
    const currentEpoch = computeCurrentEpoch(nowTs);

    const [registrarBuf, mints] = await Promise.all([
      RegistrarCache(env, () => fetchAccount(env, HNT_REGISTRAR_KEY)),
      findPositionMints(env, wallet),
    ]);

    if (!registrarBuf) return jsonResponse({ error: "Failed to load HNT registrar." }, 500);
    const registrar = decodeRegistrar(registrarBuf);
    const vmcIdx = registrar.votingMints.findIndex(
      (v) => v.mint.toBase58() === HNT_MINT.toBase58(),
    );
    if (vmcIdx === -1) return jsonResponse({ error: "Registrar missing HNT voting mint." }, 500);
    const votingMintConfig = registrar.votingMints[vmcIdx];

    if (mints.length === 0) {
      return jsonResponse({
        wallet: wallet.toBase58(),
        currentEpoch,
        totals: {
          hntLocked: "0", veHnt: "0",
          pendingRewardsHnt: "0", pendingRewardsIot: "0", pendingRewardsMobile: "0",
          positionCount: 0,
        },
        positions: [],
      });
    }

    const positionKeys = mints.map(positionKey);
    const delegatedKeys = positionKeys.map(delegatedPositionKey);
    const fetched = await fetchMultipleAccounts(env, [...positionKeys, ...delegatedKeys]);
    const positionBufs = fetched.slice(0, positionKeys.length);
    const delegatedBufs = fetched.slice(positionKeys.length);

    const decoded = [];
    for (let i = 0; i < mints.length; i++) {
      if (!positionBufs[i]) continue;
      decoded.push({
        mint: mints[i],
        position: decodePosition(positionBufs[i]),
        delegation: delegatedBufs[i] ? decodeDelegatedPosition(delegatedBufs[i]) : null,
      });
    }

    // Union of (subDao, epoch) pairs actually referenced by some position —
    // avoids fetching sub-DAO epoch infos for epochs no position needs.
    const subDaoEpochPairs = new Set();
    const daoEpochsNeeded = new Set();
    for (const { delegation } of decoded) {
      if (!delegation || delegation.purged) continue;
      const sd58 = delegation.subDao.toBase58();
      for (let e = delegation.lastClaimedEpoch + 1; e < currentEpoch; e++) {
        if (isEpochClaimed(delegation, e)) continue;
        daoEpochsNeeded.add(e);
        subDaoEpochPairs.add(`${sd58}:${e}`);
      }
    }
    const lastFullEpoch = currentEpoch - 1;
    if (lastFullEpoch >= 0) daoEpochsNeeded.add(lastFullEpoch);
    const daoEpochsList = Array.from(daoEpochsNeeded).sort((a, b) => a - b);

    const daoEpochInfoByEpoch = new Map();
    const subDaoEpochInfoByKey = new Map();

    const [daoBufs, subDaoBufs] = await Promise.all([
      daoEpochsList.length === 0 ? [] : batchCachedAccounts(
        env,
        daoEpochsList.map((e) => ({
          kvKey: `ve-hnt:daoEpoch:${e}`,
          pubkey: daoEpochInfoKey(DAO_KEY, e),
        })),
        DAO_EPOCH_TTL,
      ),
      subDaoEpochPairs.size === 0 ? [] : fetchMultipleAccounts(
        env,
        Array.from(subDaoEpochPairs).map((key) => {
          const [sd58, e] = key.split(":");
          return subDaoEpochInfoKey(new PublicKey(sd58), Number(e));
        }),
      ),
    ]);

    for (let i = 0; i < daoEpochsList.length; i++) {
      if (!daoBufs[i]) continue;
      try {
        daoEpochInfoByEpoch.set(daoEpochsList[i], decodeDaoEpochInfo(daoBufs[i]));
      } catch (e) {
        console.error("decodeDaoEpochInfo failed", daoEpochsList[i], e?.message);
      }
    }
    const subDaoKeysOrdered = Array.from(subDaoEpochPairs);
    for (let i = 0; i < subDaoKeysOrdered.length; i++) {
      const buf = subDaoBufs[i];
      if (!buf) continue;
      try {
        subDaoEpochInfoByKey.set(subDaoKeysOrdered[i], decodeSubDaoEpochInfo(buf));
      } catch (e) {
        console.error("decodeSubDaoEpochInfo failed", subDaoKeysOrdered[i], e?.message);
      }
    }

    let totalLocked = 0n;
    let totalVeHnt = 0n;
    let totalPendingHnt = 0n;
    let totalPendingDntIot = 0n;
    let totalPendingDntMobile = 0n;
    const decorated = [];

    for (const { mint, position, delegation } of decoded) {
      const { veHnt, isLandrush, multiplier } = computeVeHnt(position, votingMintConfig, nowTs);
      totalLocked += BigInt(position.amountDepositedNative);
      totalVeHnt += veHnt;

      let delegationOut = null;
      let pendingRewardsOut = null;
      let dailyReward = null;

      if (delegation) {
        const label = subDaoLabel(delegation.subDao);
        const sd58 = delegation.subDao.toBase58();
        const rewards = computePendingRewards({
          position,
          delegatedPosition: delegation,
          votingMintConfig,
          daoEpochInfoByEpoch,
          subDaoEpochInfoByKey,
          subDao58: sd58,
          currentEpoch,
          secondsPerEpoch: SECONDS_PER_EPOCH,
        });

        dailyReward = approximateDailyReward({
          position,
          votingMintConfig,
          daoEpochInfo: daoEpochInfoByEpoch.get(lastFullEpoch),
        });

        delegationOut = {
          subDao: label,
          subDaoAddress: sd58,
          startTs: delegation.startTs,
          expirationTs: delegation.expirationTs,
          lastClaimedEpoch: delegation.lastClaimedEpoch,
          unclaimedEpochs: rewards.unclaimedEpochsCount,
          purged: delegation.purged,
        };
        pendingRewardsOut = {
          hnt: formatNative(rewards.pendingRewardsHnt, HNT_DECIMALS),
          dnt: rewards.pendingRewardsDnt > 0n
            ? formatNative(rewards.pendingRewardsDnt, DNT_DECIMALS)
            : "0",
          dntLabel: label,
        };

        totalPendingHnt += rewards.pendingRewardsHnt;
        if (label === "IOT") totalPendingDntIot += rewards.pendingRewardsDnt;
        else if (label === "MOBILE") totalPendingDntMobile += rewards.pendingRewardsDnt;
      }

      decorated.push({
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
            isExpired: position.lockup.kind === "Cliff" && position.lockup.endTs <= nowTs,
          },
          veHnt: formatNative(veHnt, HNT_DECIMALS),
          isLandrush,
          landrushMultiplier: multiplier,
          delegation: delegationOut,
          pendingRewards: pendingRewardsOut,
          pendingRewardsApprox: delegation ? "current-vehnt" : null,
          dailyRewardHnt: dailyReward === null ? null : formatNative(dailyReward, HNT_DECIMALS),
          numActiveVotes: position.numActiveVotes,
          recentProposalsCount: position.recentProposals.length,
          proxy: proxyFromPosition(position, wallet),
        },
      });
    }

    decorated.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
    const positions = decorated.map((d) => d.out);

    console.log(JSON.stringify({
      event: "vehnt_positions",
      wallet: wallet.toBase58(),
      positionCount: positions.length,
      currentEpoch,
    }));

    return jsonResponse({
      wallet: wallet.toBase58(),
      currentEpoch,
      totals: {
        hntLocked: formatNative(totalLocked, HNT_DECIMALS),
        veHnt: formatNative(totalVeHnt, HNT_DECIMALS),
        pendingRewardsHnt: formatNative(totalPendingHnt, HNT_DECIMALS),
        pendingRewardsIot: formatNative(totalPendingDntIot, DNT_DECIMALS),
        pendingRewardsMobile: formatNative(totalPendingDntMobile, DNT_DECIMALS),
        positionCount: positions.length,
      },
      positions,
    });
  } catch (err) {
    console.error("ve-hnt positions error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to fetch positions." }, 500);
  }
}
