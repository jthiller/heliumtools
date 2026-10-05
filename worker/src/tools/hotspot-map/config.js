// Rate limits
export const MAX_RESOLVE_PER_MINUTE = 10;
export const MAX_WALLET_LOOKUPS_PER_MINUTE = 10;
// /onboarded misses only (≤2 RPC calls each — one per network); cache hits are free.
export const MAX_ONBOARDED_PER_MINUTE = 30;
export const MAX_ENTITY_KEYS_PER_REQUEST = 500;
export const RPC_BATCH_SIZE = 100;
