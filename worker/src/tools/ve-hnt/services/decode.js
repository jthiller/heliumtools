import { PublicKey } from "@solana/web3.js";

// All Anchor accounts have an 8-byte discriminator before the declared fields.
const DISC = 8;

/**
 * PositionV0 — voter-stake-registry/src/state/position.rs
 *
 *   registrar: Pubkey (32)
 *   mint: Pubkey (32)
 *   lockup: { start_ts: i64, end_ts: i64, kind: u8 }  (17 bytes)
 *   amount_deposited_native: u64 (8)
 *   voting_mint_config_idx: u8 (1)
 *   num_active_votes: u16 (2)
 *   genesis_end: i64 (8)
 *   bump_seed: u8 (1)
 *   vote_controller: Pubkey (32)
 *   registrar_paid_rent: u64 (8)
 *   recent_proposals: Vec<{ proposal: Pubkey, ts: i64 }>  (4-byte LE len + items)
 */
export const LOCKUP_KIND = ["None", "Cliff", "Constant"];

export function decodePosition(buf) {
  let o = DISC;
  const registrar = new PublicKey(buf.slice(o, o + 32)); o += 32;
  const mint = new PublicKey(buf.slice(o, o + 32)); o += 32;
  const startTs = Number(buf.readBigInt64LE(o)); o += 8;
  const endTs = Number(buf.readBigInt64LE(o)); o += 8;
  const kindIdx = buf.readUInt8(o); o += 1;
  const amountDepositedNative = buf.readBigUInt64LE(o); o += 8;
  const votingMintConfigIdx = buf.readUInt8(o); o += 1;
  const numActiveVotes = buf.readUInt16LE(o); o += 2;
  const genesisEnd = Number(buf.readBigInt64LE(o)); o += 8;
  /* bumpSeed */ o += 1;
  const voteController = new PublicKey(buf.slice(o, o + 32)); o += 32;
  /* registrarPaidRent */ o += 8;
  const recentProposalsLen = buf.readUInt32LE(o); o += 4;
  const recentProposals = [];
  for (let i = 0; i < recentProposalsLen; i++) {
    const proposal = new PublicKey(buf.slice(o, o + 32)); o += 32;
    const ts = Number(buf.readBigInt64LE(o)); o += 8;
    recentProposals.push({ proposal, ts });
  }

  return {
    registrar,
    mint,
    lockup: {
      startTs,
      endTs,
      kind: LOCKUP_KIND[kindIdx] || "Unknown",
    },
    amountDepositedNative,
    votingMintConfigIdx,
    numActiveVotes,
    genesisEnd,
    voteController,
    recentProposals,
  };
}

/**
 * DelegatedPositionV0 — helium-sub-daos/src/state.rs
 *
 *   mint: Pubkey (32)
 *   position: Pubkey (32)
 *   hnt_amount: u64 (8)
 *   sub_dao: Pubkey (32)
 *   last_claimed_epoch: u64 (8)
 *   start_ts: i64 (8)
 *   purged: bool (1)
 *   bump_seed: u8 (1)
 *   claimed_epochs_bitmap: u128 (16 LE)
 *   expiration_ts: i64 (8)
 *   _deprecated_recent_proposals: Vec<{ proposal: Pubkey, ts: i64 }>  (ignored)
 */
export function decodeDelegatedPosition(buf) {
  let o = DISC;
  const mint = new PublicKey(buf.slice(o, o + 32)); o += 32;
  const position = new PublicKey(buf.slice(o, o + 32)); o += 32;
  const hntAmount = buf.readBigUInt64LE(o); o += 8;
  const subDao = new PublicKey(buf.slice(o, o + 32)); o += 32;
  const lastClaimedEpoch = Number(buf.readBigUInt64LE(o)); o += 8;
  const startTs = Number(buf.readBigInt64LE(o)); o += 8;
  const purged = buf.readUInt8(o) === 1; o += 1;
  /* bumpSeed */ o += 1;

  // u128 LE
  const lo = buf.readBigUInt64LE(o);
  const hi = buf.readBigUInt64LE(o + 8);
  const claimedEpochsBitmap = (hi << 64n) | lo;
  o += 16;

  const expirationTs = Number(buf.readBigInt64LE(o)); o += 8;

  return {
    mint,
    position,
    hntAmount,
    subDao,
    lastClaimedEpoch,
    startTs,
    purged,
    claimedEpochsBitmap,
    expirationTs,
  };
}

/**
 * Check whether a given epoch has been claimed on a DelegatedPositionV0.
 * Mirrors `DelegatedPositionV0::is_claimed` in helium-sub-daos.
 *
 * Bitmap covers epochs (last_claimed_epoch, last_claimed_epoch + 128]
 * with bit-index 0 = MSB of the u128 (bit position 127 from LE).
 */
export function isEpochClaimed(delegatedPosition, epoch) {
  const { lastClaimedEpoch, claimedEpochsBitmap } = delegatedPosition;
  if (epoch <= lastClaimedEpoch) return true;
  if (epoch > lastClaimedEpoch + 128) return false;
  const bitIndex = BigInt(epoch - lastClaimedEpoch - 1);
  return ((claimedEpochsBitmap >> (127n - bitIndex)) & 1n) === 1n;
}

/**
 * Registrar — voter-stake-registry/src/state/registrar.rs
 *
 *   governance_program_id: Pubkey (32)
 *   realm: Pubkey (32)
 *   realm_governing_token_mint: Pubkey (32)
 *   realm_authority: Pubkey (32)
 *   time_offset: i64 (8)
 *   position_update_authority: Option<Pubkey> (1 tag + 32 if some)
 *   collection: Pubkey (32)
 *   bump_seed: u8 (1)
 *   collection_bump_seed: u8 (1)
 *   reserved1: [u8; 4]
 *   reserved2: [u64; 3]  (24 bytes)
 *   proxy_config: Pubkey (32)
 *   voting_mints: Vec<VotingMintConfigV0>  (4-byte LE len + items)
 *
 * VotingMintConfigV0:
 *   mint: Pubkey (32)
 *   baseline_vote_weight_scaled_factor: u64 (8)
 *   max_extra_lockup_vote_weight_scaled_factor: u64 (8)
 *   genesis_vote_power_multiplier: u8 (1)
 *   genesis_vote_power_multiplier_expiration_ts: i64 (8)
 *   lockup_saturation_secs: u64 (8)
 *   reserved: i8 (1)
 */
export function decodeRegistrar(buf) {
  let o = DISC;
  /* governance_program_id */ o += 32;
  /* realm */ o += 32;
  /* realm_governing_token_mint */ o += 32;
  /* realm_authority */ o += 32;
  /* time_offset */ o += 8;
  // Option<Pubkey>
  const puaTag = buf.readUInt8(o); o += 1;
  if (puaTag === 1) o += 32;
  const collection = new PublicKey(buf.slice(o, o + 32)); o += 32;
  /* bump_seed */ o += 1;
  /* collection_bump_seed */ o += 1;
  /* reserved1 [u8;4] */ o += 4;
  /* reserved2 [u64;3] */ o += 24;
  const proxyConfig = new PublicKey(buf.slice(o, o + 32)); o += 32;

  const vmcLen = buf.readUInt32LE(o); o += 4;
  const votingMints = [];
  for (let i = 0; i < vmcLen; i++) {
    const mint = new PublicKey(buf.slice(o, o + 32)); o += 32;
    const baseline = buf.readBigUInt64LE(o); o += 8;
    const maxExtra = buf.readBigUInt64LE(o); o += 8;
    const genesisMultiplier = buf.readUInt8(o); o += 1;
    const genesisExpirationTs = Number(buf.readBigInt64LE(o)); o += 8;
    const lockupSaturationSecs = Number(buf.readBigUInt64LE(o)); o += 8;
    /* reserved: i8 */ o += 1;
    votingMints.push({
      mint,
      baselineVoteWeightScaledFactor: baseline,
      maxExtraLockupVoteWeightScaledFactor: maxExtra,
      genesisVotePowerMultiplier: genesisMultiplier,
      genesisVotePowerMultiplierExpirationTs: genesisExpirationTs,
      lockupSaturationSecs,
    });
  }

  return {
    collection,
    proxyConfig,
    votingMints,
  };
}

/**
 * DaoV0 — helium-sub-daos/src/state.rs
 * Only the fields we actually use.
 *
 *   hnt_mint: Pubkey (32)
 *   dc_mint: Pubkey (32)
 *   authority: Pubkey (32)
 *   registrar: Pubkey (32)
 *   hst_pool: Pubkey (32)
 *   net_emissions_cap: u64 (8)
 *   num_sub_daos: u32 (4)
 *   emission_schedule: Vec<EmissionScheduleItem>  — skipped via length prefix
 *   hst_emission_schedule: Vec<PercentItem>       — skipped via length prefix
 *   bump_seed: u8 (1)
 *   rewards_escrow: Pubkey (32)
 *   delegator_pool: Pubkey (32)
 *   delegator_rewards_percent: u64 (8)
 *   proposal_namespace: Pubkey (32)
 *   recent_proposals: [RecentProposal; 4]  (fixed 4*(32+8))
 *
 * EmissionScheduleItem: i64 + u64 = 16 bytes
 * PercentItem: i64 + u8 = 9 bytes
 */
export function decodeDao(buf) {
  let o = DISC;
  const hntMint = new PublicKey(buf.slice(o, o + 32)); o += 32;
  /* dc_mint */ o += 32;
  /* authority */ o += 32;
  const registrar = new PublicKey(buf.slice(o, o + 32)); o += 32;
  /* hst_pool */ o += 32;
  /* net_emissions_cap */ o += 8;
  /* num_sub_daos */ o += 4;

  const emissionLen = buf.readUInt32LE(o); o += 4;
  o += emissionLen * 16;

  const hstLen = buf.readUInt32LE(o); o += 4;
  o += hstLen * 9;

  /* bump_seed */ o += 1;
  /* rewards_escrow */ o += 32;
  const delegatorPool = new PublicKey(buf.slice(o, o + 32)); o += 32;

  return {
    hntMint,
    registrar,
    delegatorPool,
  };
}

/**
 * DaoEpochInfoV0 — helium-sub-daos/src/state.rs
 * We only need delegation_rewards_issued, vehnt_at_epoch_start, done_issuing_rewards.
 *
 *   done_calculating_scores: bool (1)
 *   epoch: u64 (8)
 *   dao: Pubkey (32)
 *   total_rewards: u64 (8)
 *   current_hnt_supply: u64 (8)
 *   total_utility_score: u128 (16)
 *   num_utility_scores_calculated: u32 (4)
 *   num_rewards_issued: u32 (4)
 *   done_issuing_rewards: bool (1)
 *   done_issuing_hst_pool: bool (1)
 *   bump_seed: u8 (1)
 *   recent_proposals: [RecentProposal; 4]  (fixed 4*(32+8) = 160)
 *   delegation_rewards_issued: u64 (8)
 *   vehnt_at_epoch_start: u64 (8)
 *   cumulative_not_emitted: u64 (8)
 *   not_emitted: u64 (8)
 *   smoothed_hnt_burned: u64 (8)
 */
export function decodeDaoEpochInfo(buf) {
  let o = DISC;
  /* done_calculating_scores */ o += 1;
  const epoch = Number(buf.readBigUInt64LE(o)); o += 8;
  /* dao */ o += 32;
  /* total_rewards */ o += 8;
  /* current_hnt_supply */ o += 8;
  /* total_utility_score */ o += 16;
  /* num_utility_scores_calculated */ o += 4;
  /* num_rewards_issued */ o += 4;
  const doneIssuingRewards = buf.readUInt8(o) === 1; o += 1;
  /* done_issuing_hst_pool */ o += 1;
  /* bump_seed */ o += 1;
  /* recent_proposals [4] */ o += 160;
  const delegationRewardsIssued = buf.readBigUInt64LE(o); o += 8;
  const vehntAtEpochStart = buf.readBigUInt64LE(o); o += 8;

  return {
    epoch,
    doneIssuingRewards,
    delegationRewardsIssued,
    vehntAtEpochStart,
  };
}
