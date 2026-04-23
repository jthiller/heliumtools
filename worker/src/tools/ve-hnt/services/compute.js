import { SCALED_FACTOR_BASE, SECONDS_PER_EPOCH } from "../../../lib/helium-solana.js";
import { isEpochClaimed } from "./decode.js";

/**
 * Compute veHNT voting power for a position at a given timestamp. Mirrors
 * PositionV0::voting_power verbatim — especially the Constant-kind
 * short-circuit in Lockup::seconds_left, which pretends curr_ts is start_ts,
 * so Constant positions NEVER expire in voting-power terms. Their end_ts is
 * just the minimum unwind period if the kind is later changed to Cliff.
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
  if (kind === "Constant") {
    secondsLeft = BigInt(endTs - startTs);
  } else if (kind === "Cliff" && endTs > nowTs) {
    secondsLeft = BigInt(endTs - nowTs);
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

export function computeVeHntAt(position, votingMintConfig, ts) {
  return computeVeHnt(position, votingMintConfig, ts).veHnt;
}

/**
 * Reward reasons emitted per epoch. Shared between the per-position
 * aggregator (computePendingRewards) and the per-epoch handler so the
 * UI's reason-labels map is authoritative.
 */
export const REWARD_REASONS = Object.freeze({
  V1_HNT: "v1_hnt",
  V0_DNT: "v0_dnt",
  V0_BLOCKED: "v0_blocked_by_hnt_issued",
  POSITION_VEHNT_ZERO: "position_vehnt_zero",
  DAO_EPOCH_NOT_ISSUED: "dao_epoch_not_issued",
  NO_REWARDS: "no_rewards",
});

/**
 * Classify one epoch: given the position's veHNT at epoch start plus the
 * DAO and sub-DAO epoch-info records, return what (if anything) is
 * claimable and why.
 *
 *   - v1_hnt: post-HIP-138, DAO has delegation_rewards_issued
 *   - v0_dnt: pre-HIP-138, sub-DAO has it AND hnt_rewards_issued == 0
 *   - v0_blocked: sub-DAO has DNT but HIP-138 already issued HNT, so v0 rejects
 *   - position_vehnt_zero: Cliff lockup ended → no share
 *   - dao_epoch_not_issued: DAO hasn't marked the epoch closed yet
 *   - no_rewards: neither source has data
 */
export function resolveEpochReward(positionVehnt, dao, subDao) {
  if (positionVehnt === 0n) {
    return { claimableHnt: 0n, claimableDnt: 0n, reason: REWARD_REASONS.POSITION_VEHNT_ZERO };
  }
  if (dao && dao.doneIssuingRewards
      && dao.delegationRewardsIssued > 0n
      && dao.vehntAtEpochStart > 0n) {
    return {
      claimableHnt: (positionVehnt * dao.delegationRewardsIssued) / dao.vehntAtEpochStart,
      claimableDnt: 0n,
      reason: REWARD_REASONS.V1_HNT,
    };
  }
  if (subDao
      && subDao.delegationRewardsIssued > 0n
      && subDao.vehntAtEpochStart > 0n
      && subDao.hntRewardsIssued === 0n) {
    return {
      claimableHnt: 0n,
      claimableDnt: (positionVehnt * subDao.delegationRewardsIssued) / subDao.vehntAtEpochStart,
      reason: REWARD_REASONS.V0_DNT,
    };
  }
  if (subDao && subDao.hntRewardsIssued > 0n) {
    return { claimableHnt: 0n, claimableDnt: 0n, reason: REWARD_REASONS.V0_BLOCKED };
  }
  if (!dao || !dao.doneIssuingRewards) {
    return { claimableHnt: 0n, claimableDnt: 0n, reason: REWARD_REASONS.DAO_EPOCH_NOT_ISSUED };
  }
  return { claimableHnt: 0n, claimableDnt: 0n, reason: REWARD_REASONS.NO_REWARDS };
}

/**
 * Sum pending delegation rewards across unclaimed epochs by delegating
 * per-epoch classification to resolveEpochReward.
 */
export function computePendingRewards({
  position,
  delegatedPosition,
  votingMintConfig,
  daoEpochInfoByEpoch,
  subDaoEpochInfoByKey,
  subDao58,
  currentEpoch,
  secondsPerEpoch,
}) {
  let pendingRewardsHnt = 0n;
  let pendingRewardsDnt = 0n;
  let unclaimedEpochsCount = 0;

  for (let e = delegatedPosition.lastClaimedEpoch + 1; e < currentEpoch; e++) {
    if (isEpochClaimed(delegatedPosition, e)) continue;
    unclaimedEpochsCount++;

    const positionVehnt = computeVeHntAt(position, votingMintConfig, e * secondsPerEpoch);
    const dao = daoEpochInfoByEpoch.get(e);
    const subDao = subDaoEpochInfoByKey?.get(`${subDao58}:${e}`);
    const { claimableHnt, claimableDnt } = resolveEpochReward(positionVehnt, dao, subDao);
    pendingRewardsHnt += claimableHnt;
    pendingRewardsDnt += claimableDnt;
  }

  return { pendingRewardsHnt, pendingRewardsDnt, unclaimedEpochsCount };
}

export function approximateDailyReward({ position, votingMintConfig, daoEpochInfo }) {
  if (!daoEpochInfo || !daoEpochInfo.doneIssuingRewards) return null;
  if (daoEpochInfo.vehntAtEpochStart === 0n) return null;
  const { veHnt } = computeVeHnt(
    position,
    votingMintConfig,
    daoEpochInfo.epoch * SECONDS_PER_EPOCH,
  );
  if (veHnt === 0n) return 0n;
  return (veHnt * daoEpochInfo.delegationRewardsIssued) / daoEpochInfo.vehntAtEpochStart;
}
