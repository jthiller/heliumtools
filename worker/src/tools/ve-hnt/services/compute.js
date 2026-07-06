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

const DEFAULT_PUBKEY_58 = "11111111111111111111111111111111";
const ONE_WEEK = 60 * 60 * 24 * 7;

/**
 * Whether claim_rewards_v1 would BURN this epoch's delegation rewards instead
 * of paying them. Mirrors the forfeit rule in
 * helium-sub-daos/claim_rewards_v1: rewards are burned when the DAO's
 * recent-proposals snapshot for the epoch holds four real (non-default)
 * proposals AND the position was eligible on fewer than two of them —
 * eligible meaning it voted on the proposal (its vote's ts falls within the
 * snapshot window) or the proposal was still in progress at the epoch's start
 * (created less than a week before it). recent_proposals is stored
 * newest-first, so the window is [oldest.ts, newest.ts]. A snapshot without
 * four real proposals can't forfeit (matches the on-chain not_four_proposals
 * guard), so missing/short data fails open to "payable".
 */
export function epochIsForfeit(positionRecentProposals, daoRecentProposals, epochStartTs) {
  if (!daoRecentProposals || daoRecentProposals.length < 4) return false;
  const realCount = daoRecentProposals.filter(
    (p) => p.proposal.toBase58() !== DEFAULT_PUBKEY_58,
  ).length;
  if (realCount < 4) return false;

  const newestTs = daoRecentProposals[0].ts;
  const oldestTs = daoRecentProposals[daoRecentProposals.length - 1].ts;
  const voted = new Set(
    (positionRecentProposals ?? [])
      .filter((p) => p.ts >= oldestTs && p.ts <= newestTs)
      .map((p) => p.proposal.toBase58()),
  );

  const eligibleCount = daoRecentProposals.filter(
    (p) => voted.has(p.proposal.toBase58()) || p.ts + ONE_WEEK > epochStartTs,
  ).length;

  return eligibleCount < 2;
}

/**
 * Reward reasons emitted per epoch. Shared between the per-position
 * aggregator (computePendingRewards) and the per-epoch handler so the
 * UI's reason-labels map is authoritative.
 */
export const REWARD_REASONS = Object.freeze({
  V1_HNT: "v1_hnt",
  V1_EXPIRED: "v1_expired",
  V1_FORFEIT: "v1_forfeit",
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
 *   - v1_expired: v1 epoch after the delegation's expiration → chain pays 0
 *   - v1_forfeit: v1 epoch the chain burns for insufficient vote participation
 *   - v0_dnt: pre-HIP-138, sub-DAO has it AND hnt_rewards_issued == 0
 *   - v0_blocked: sub-DAO has DNT but HIP-138 already issued HNT, so v0 rejects
 *   - position_vehnt_zero: Cliff lockup ended → no share
 *   - dao_epoch_not_issued: DAO hasn't marked the epoch closed yet
 *   - no_rewards: neither source has data
 *
 * `v1Gate` (optional) applies the two payout gates claim_rewards_v1 enforces
 * on the HNT path — they don't exist in claim_rewards_v0, so they only touch
 * the v1_hnt branch. When omitted, classification is unchanged (kept optional
 * so any non-delegation caller stays pure):
 *   - expirationTs: DelegatedPositionV0.expiration_ts. The chain sets the
 *     epoch's delegated veHNT to 0 once `expiration_ts <= epoch_start_ts`
 *     (strict `>` to pay), so those epochs pay nothing.
 *   - positionRecentProposals / epochStartTs: fed to epochIsForfeit.
 */
export function resolveEpochReward(positionVehnt, dao, subDao, v1Gate) {
  if (positionVehnt === 0n) {
    return { claimableHnt: 0n, claimableDnt: 0n, reason: REWARD_REASONS.POSITION_VEHNT_ZERO };
  }
  if (dao && dao.doneIssuingRewards
      && dao.delegationRewardsIssued > 0n
      && dao.vehntAtEpochStart > 0n) {
    if (v1Gate) {
      if (v1Gate.expirationTs != null && v1Gate.expirationTs <= v1Gate.epochStartTs) {
        return { claimableHnt: 0n, claimableDnt: 0n, reason: REWARD_REASONS.V1_EXPIRED };
      }
      if (epochIsForfeit(v1Gate.positionRecentProposals, dao.recentProposals, v1Gate.epochStartTs)) {
        return { claimableHnt: 0n, claimableDnt: 0n, reason: REWARD_REASONS.V1_FORFEIT };
      }
    }
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

    const epochStartTs = e * secondsPerEpoch;
    const positionVehnt = computeVeHntAt(position, votingMintConfig, epochStartTs);
    const dao = daoEpochInfoByEpoch.get(e);
    const subDao = subDaoEpochInfoByKey?.get(`${subDao58}:${e}`);
    const { claimableHnt, claimableDnt } = resolveEpochReward(positionVehnt, dao, subDao, {
      expirationTs: delegatedPosition.expirationTs,
      epochStartTs,
      positionRecentProposals: position.recentProposals,
    });
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
