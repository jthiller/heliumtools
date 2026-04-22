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
 * For each epoch e in (last_claimed_epoch, currentEpoch) where the bitmap
 * bit is 0:
 *   share = position_vehnt_at_epoch_start(e) * dao_epoch_info[e].delegation_rewards_issued
 *           / dao_epoch_info[e].vehnt_at_epoch_start
 *
 * Epochs whose dao_epoch_info has not yet finished issuing (done_issuing_rewards=false)
 * are skipped — they'll be claimable later.
 *
 * Returns: { pendingRewards: BigInt, unclaimedEpochs: number[] }
 */
export function computePendingRewards({
  position,
  delegatedPosition,
  votingMintConfig,
  daoEpochInfoByEpoch,
  currentEpoch,
  secondsPerEpoch,
}) {
  const unclaimedEpochs = [];
  let pendingRewards = 0n;

  const startEpoch = delegatedPosition.lastClaimedEpoch + 1;
  const endEpoch = currentEpoch; // exclusive — current epoch hasn't closed

  for (let e = startEpoch; e < endEpoch; e++) {
    if (isEpochClaimed(delegatedPosition, e)) continue;
    const info = daoEpochInfoByEpoch.get(e);
    if (!info) continue; // not initialized or not fetched
    if (!info.doneIssuingRewards) continue;
    if (info.delegationRewardsIssued === 0n) continue;
    if (info.vehntAtEpochStart === 0n) continue;

    const epochStartTs = e * secondsPerEpoch;
    const positionVehnt = computeVeHntAt(position, votingMintConfig, epochStartTs);
    if (positionVehnt === 0n) {
      // expired position before this epoch — still counts as claimed once we advance past it.
      unclaimedEpochs.push(e);
      continue;
    }

    const share =
      (positionVehnt * info.delegationRewardsIssued) / info.vehntAtEpochStart;
    pendingRewards += share;
    unclaimedEpochs.push(e);
  }

  return { pendingRewards, unclaimedEpochs };
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
