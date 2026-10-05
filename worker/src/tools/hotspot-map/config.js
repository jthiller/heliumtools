// Helium Program IDs
export const HELIUM_ENTITY_MANAGER_PROGRAM_ID =
  "hemjuPXBpNvggtaUnN1MwT3wrdhttKEfosTcc2P9Pg8";
export const HELIUM_SUB_DAOS_PROGRAM_ID =
  "hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR";

// Token Mints
export const HNT_MINT = "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux";
export const IOT_MINT = "iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns";
export const MOBILE_MINT = "mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6";

// Rate limits
export const MAX_RESOLVE_PER_MINUTE = 10;
export const MAX_WALLET_LOOKUPS_PER_MINUTE = 10;
// /onboarded misses only (≤2 RPC calls each — one per network); cache hits are free.
export const MAX_ONBOARDED_PER_MINUTE = 30;
export const MAX_ENTITY_KEYS_PER_REQUEST = 500;
export const RPC_BATCH_SIZE = 100;

// /onboarded KV cache (seconds). A found date never changes, so the TTL only
// ages out entries nobody looks at; "not settled" (incl. not on that network)
// is retried daily.
export const ONBOARDED_CACHE_TTL = 90 * 86_400;
export const ONBOARDED_UNKNOWN_CACHE_TTL = 86_400;
