import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import {
  HNT_MINT,
  HNT_REGISTRAR_KEY,
  DAO_KEY,
  SECONDS_PER_EPOCH,
  positionKey as derivePositionKey,
  delegatedPositionKey as deriveDelegatedPositionKey,
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
import { computeVeHntAt } from "../services/compute.js";
import { RegistrarCache, DaoEpochInfoCache } from "../services/cache.js";

const HNT_DECIMALS = 8;
const DNT_DECIMALS = 6;

/**
 * GET /ve-hnt/position-epochs?positionMint=<mint>
 *
 * Returns a per-epoch breakdown for a single position covering the
 * unclaimed window (last_claimed_epoch+1, currentEpoch). Each row shows:
 *   - position's veHNT at that epoch's start
 *   - DAO epoch-info source (post-HIP-138 HNT rewards)
 *   - Sub-DAO epoch-info source (pre-HIP-138 DNT rewards; claimable only if
 *     sub_dao_epoch_info.hnt_rewards_issued == 0)
 *   - Computed share from each source
 */
export async function handlePositionEpochs(url, env, request) {
  const limitErr = await checkIpRateLimit(env, request, {
    prefix: "rl:vehnt:epochs",
    maxRequests: MAX_POSITION_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (limitErr) return limitErr;

  const mint = parseSolanaAddress(url.searchParams.get("positionMint"));
  if (!mint) return jsonResponse({ error: "Invalid positionMint." }, 400);

  try {
    const positionKey = derivePositionKey(mint);
    const delegatedKey = deriveDelegatedPositionKey(positionKey);

    const [registrarBuf, positionBuf, delegatedBuf] = await Promise.all([
      RegistrarCache(env, () => fetchAccount(env, HNT_REGISTRAR_KEY)),
      fetchAccount(env, positionKey),
      fetchAccount(env, delegatedKey),
    ]);
    if (!registrarBuf) return jsonResponse({ error: "Registrar not found." }, 500);
    if (!positionBuf) return jsonResponse({ error: "Position not found." }, 404);

    const registrar = decodeRegistrar(registrarBuf);
    const position = decodePosition(positionBuf);
    const delegation = delegatedBuf ? decodeDelegatedPosition(delegatedBuf) : null;

    const vmcIdx = registrar.votingMints.findIndex(
      (v) => v.mint.toBase58() === HNT_MINT.toBase58(),
    );
    const vmc = registrar.votingMints[vmcIdx];

    const nowTs = Math.floor(Date.now() / 1000);
    const currentEpoch = computeCurrentEpoch(nowTs);

    if (!delegation) {
      return jsonResponse({
        positionKey: positionKey.toBase58(),
        mint: mint.toBase58(),
        delegated: false,
        currentEpoch,
        epochs: [],
      });
    }

    const startEpoch = delegation.lastClaimedEpoch + 1;
    const endEpoch = currentEpoch;
    const epochs = [];
    for (let e = startEpoch; e < endEpoch; e++) epochs.push(e);

    const daoKeys = epochs.map((e) => daoEpochInfoKey(DAO_KEY, e));
    const subDaoKeys = epochs.map((e) => subDaoEpochInfoKey(delegation.subDao, e));
    const [daoBufs, subDaoBufs] = await Promise.all([
      Promise.all(daoKeys.map((k, i) =>
        DaoEpochInfoCache(env, epochs[i], () => fetchAccount(env, k))
      )),
      fetchMultipleAccounts(env, subDaoKeys),
    ]);

    const rows = epochs.map((epoch, i) => {
      const epochStartTs = epoch * SECONDS_PER_EPOCH;
      const dao = daoBufs[i] ? decodeDaoEpochInfo(daoBufs[i]) : null;
      const subDao = subDaoBufs[i] ? decodeSubDaoEpochInfo(subDaoBufs[i]) : null;
      const positionVehnt = computeVeHntAt(position, vmc, epochStartTs);

      let claimableHnt = 0n;
      let claimableDnt = 0n;
      let reason = null;

      if (positionVehnt === 0n) {
        reason = "position_vehnt_zero";
      } else if (dao && dao.doneIssuingRewards
          && dao.delegationRewardsIssued > 0n
          && dao.vehntAtEpochStart > 0n) {
        claimableHnt = (positionVehnt * dao.delegationRewardsIssued) / dao.vehntAtEpochStart;
        reason = "v1_hnt";
      } else if (subDao
          && subDao.delegationRewardsIssued > 0n
          && subDao.vehntAtEpochStart > 0n
          && subDao.hntRewardsIssued === 0n) {
        claimableDnt = (positionVehnt * subDao.delegationRewardsIssued) / subDao.vehntAtEpochStart;
        reason = "v0_dnt";
      } else if (subDao && subDao.hntRewardsIssued > 0n) {
        reason = "v0_blocked_by_hnt_issued";
      } else if (!dao || !dao.doneIssuingRewards) {
        reason = "dao_epoch_not_issued";
      } else {
        reason = "no_rewards";
      }

      return {
        epoch,
        startTs: epochStartTs,
        claimed: isEpochClaimed(delegation, epoch),
        positionVehnt: positionVehnt.toString(),
        dao: dao ? {
          delegationRewardsIssued: dao.delegationRewardsIssued.toString(),
          vehntAtEpochStart: dao.vehntAtEpochStart.toString(),
          doneIssuingRewards: dao.doneIssuingRewards,
        } : null,
        subDao: subDao ? {
          delegationRewardsIssued: subDao.delegationRewardsIssued.toString(),
          vehntAtEpochStart: subDao.vehntAtEpochStart.toString(),
          hntRewardsIssued: subDao.hntRewardsIssued.toString(),
        } : null,
        claimable: {
          hnt: formatNative(claimableHnt, HNT_DECIMALS),
          dnt: claimableDnt > 0n ? formatNative(claimableDnt, DNT_DECIMALS) : "0",
        },
        reason,
      };
    });

    return jsonResponse({
      positionKey: positionKey.toBase58(),
      mint: mint.toBase58(),
      delegated: true,
      subDao: delegation.subDao.toBase58(),
      lastClaimedEpoch: delegation.lastClaimedEpoch,
      expirationTs: delegation.expirationTs,
      lockupEndTs: position.lockup.endTs,
      lockupKind: position.lockup.kind,
      currentEpoch,
      epochs: rows,
    });
  } catch (err) {
    console.error("ve-hnt position-epochs error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load per-epoch breakdown." }, 500);
  }
}
