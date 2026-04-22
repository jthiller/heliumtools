// Rate limits
export const MAX_POSITION_LOOKUPS_PER_MINUTE = 30;
export const MAX_CLAIM_BUILDS_PER_MINUTE = 10;

// KV cache TTLs (seconds)
export const REGISTRAR_CACHE_TTL = 24 * 3600;
export const DAO_CACHE_TTL = 24 * 3600;
export const PAST_EPOCH_CACHE_TTL = 30 * 24 * 3600;
export const DAILY_RATE_CACHE_TTL = 10 * 60;

// How many claim_rewards_v1 ixs fit in a single VersionedTransaction.
// Each ix touches ~18 accounts; with ~8 shared across the tx and a fresh
// dao_epoch_info per epoch, ~6 fits comfortably below the 64-account tx limit.
export const MAX_EPOCHS_PER_CLAIM_TX = 6;

// Cap total epochs returned per build call (3 txs × 6 epochs).
export const MAX_EPOCHS_PER_CLAIM_CALL = 18;
