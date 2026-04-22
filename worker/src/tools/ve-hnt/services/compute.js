import { SCALED_FACTOR_BASE } from "../../../lib/helium-solana.js";
import { isEpochClaimed } from "./decode.js";

/**
 * Compute veHNT voting power for a position at a given timestamp.
 *
 * Mirrors PositionV0::voting_power in voter-stake-registry/src/state/position.rs.
 *
 *   baseline = amount * baseline_factor / SCALED_FACTOR_BASE
 *   max_locked = amount * max_extra_factor / SCALED_FACTOR_BASE
 *   locked =
 *     None:    0
 *     expired: 0
 *     Cliff:    max_locked * min(end_ts - curr_ts, saturation) / saturation
 *     Constant: max_locked * min(end_ts - start_ts, saturation) / saturation
 *   genesis_multiplier = (curr_ts < genesis_end && mult > 0) ? mult : 1
 *   veHNT = (baseline + locked) * genesis_multiplier
 */
export function computeVeHnt(position, votingMintConfig, nowTs) {
  const amount = BigInt(position.amountDepositedNative);
  const baseline =
    (amount * BigInt(votingMintConfig.baselineVoteWeightScaledFactor)) /
    SCALED_FACTOR_BASE;
  const maxLocked =
    (amount * BigInt(votingMintConfig.maxExtraLockupVoteWeightScaledFactor)) /
    SCALED_FACTOR_BASE;

  const { kind, startTs, endTs } = position.lockup;
  const saturation = BigInt(votingMintConfig.lockupSaturationSecs);

  let secondsLeft = 0n;
  const expired = endTs <= nowTs;
  if (!expired) {
    if (kind === "Cliff") {
      secondsLeft = BigInt(endTs - nowTs);
    } else if (kind === "Constant") {
      secondsLeft = BigInt(endTs - startTs);
    }
  }

  let locked = 0n;
  if (maxLocked > 0n && saturation > 0n && secondsLeft > 0n) {
    const capped = secondsLeft < saturation ? secondsLeft : saturation;
    locked = (maxLocked * capped) / saturation;
  }

  const mult = votingMintConfig.genesisVotePowerMultiplier;
  const isLandrush = nowTs < position.genesisEnd && mult > 1;
  const multiplier = isLandrush ? BigInt(mult) : 1n;

  const veHnt = (baseline + locked) * multiplier;
  return { veHnt, isLandrush, multiplier: Number(multiplier) };
}

/**
 * Compute veHNT at an arbitrary past timestamp. Same formula but using the
 * epoch's start_ts as the "current" time. Used when calculating historical
 * share of delegation rewards.
 */
export function computeVeHntAt(position, votingMintConfig, ts) {
  return computeVeHnt(position, votingMintConfig, ts).veHnt;
}

/**
 * Sum pending delegation rewards across unclaimed epochs.
 *
 * For each unclaimed epoch e in (last_claimed_epoch, currentEpoch) we
 * check TWO reward sources in parallel:
 *
 *   1. DaoEpochInfoV0 — post-HIP-138. Non-zero delegation_rewards_issued
 *      means HNT is claimable via claim_rewards_v1.
 *   2. SubDaoEpochInfoV0 — pre-HIP-138. Non-zero delegation_rewards_issued
 *      means DNT (IOT or MOBILE, depending on sub-dao) is claimable via
 *      claim_rewards_v0.
 *
 * Share formula (both sources):
 *   share = position_vehnt_at_epoch_start(e) * delegation_rewards_issued(e)
 *           / vehnt_at_epoch_start(e)
 *
 * Bitmap is shared between v0 and v1 — set_claimed advances regardless of
 * which program was called. So per epoch exactly one of the two sources
 * is active (the one that matched HIP-138 activation status at that time).
 *
 * Returns:
 *   {
 *     pendingRewardsHnt: BigInt,
 *     pendingRewardsDnt: BigInt,   // iot or mobile, depends on sub_dao
 *     unclaimedEpochsHnt: number[],
 *     unclaimedEpochsDnt: number[],
 *     unclaimedEpochsCount: number,
 *   }
 */
export function computePendingRewards({
  position,
  delegatedPosition,
  votingMintConfig,
  daoEpochInfoByEpoch,
  subDaoEpochInfoByEpoch,
  currentEpoch,
  secondsPerEpoch,
}) {
  let pendingRewardsHnt = 0n;
  let pendingRewardsDnt = 0n;
  const unclaimedEpochsHnt = [];
  const unclaimedEpochsDnt = [];
  let unclaimedEpochsCount = 0;

  const startEpoch = delegatedPosition.lastClaimedEpoch + 1;
  const endEpoch = currentEpoch;

  for (let e = startEpoch; e < endEpoch; e++) {
    if (isEpochClaimed(delegatedPosition, e)) continue;
    unclaimedEpochsCount++;

    const epochStartTs = e * secondsPerEpoch;
    const positionVehnt = computeVeHntAt(position, votingMintConfig, epochStartTs);
    if (positionVehnt === 0n) continue;

    const daoInfo = daoEpochInfoByEpoch.get(e);
    if (daoInfo && daoInfo.doneIssuingRewards
        && daoInfo.delegationRewardsIssued > 0n
        && daoInfo.vehntAtEpochStart > 0n) {
      pendingRewardsHnt +=
        (positionVehnt * daoInfo.delegationRewardsIssued) / daoInfo.vehntAtEpochStart;
      unclaimedEpochsHnt.push(e);
      continue;
    }

    const subDaoInfo = subDaoEpochInfoByEpoch?.get(e);
    if (subDaoInfo
        && subDaoInfo.delegationRewardsIssued > 0n
        && subDaoInfo.vehntAtEpochStart > 0n) {
      pendingRewardsDnt +=
        (positionVehnt * subDaoInfo.delegationRewardsIssued) / subDaoInfo.vehntAtEpochStart;
      unclaimedEpochsDnt.push(e);
    }
  }

  return {
    pendingRewardsHnt,
    pendingRewardsDnt,
    unclaimedEpochsHnt,
    unclaimedEpochsDnt,
    unclaimedEpochsCount,
  };
}

/**
 * Approximate daily reward from the most recently issued epoch.
 * Returns HNT native units (BigInt) or null if not computable.
 */
export function approximateDailyReward({ position, votingMintConfig, daoEpochInfo }) {
  if (!daoEpochInfo || !daoEpochInfo.doneIssuingRewards) return null;
  if (daoEpochInfo.vehntAtEpochStart === 0n) return null;
  const { veHnt } = computeVeHnt(
    position,
    votingMintConfig,
    daoEpochInfo.epoch * 86400,
  );
  if (veHnt === 0n) return 0n;
  return (veHnt * daoEpochInfo.delegationRewardsIssued) / daoEpochInfo.vehntAtEpochStart;
}
