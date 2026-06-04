// Wallet Dashboard — shared constants.
//
// This tool is a read-only aggregation layer. It reuses primitives from other
// tools (entity lookup, bulk rewards) and adds balances, prices, fleet, and
// transaction services on top.

// ── Token mints ──────────────────────────────────────────────────────────────
export const HNT_MINT = "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux";
export const IOT_MINT = "iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns";
export const MOBILE_MINT = "mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6";
export const DC_MINT = "dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm";

// Data Credits have a fixed dollar value: 100,000 DC = $1 (see dc-mint price handler).
export const DC_PER_USD = 100_000;

// Wrapped SOL mint — used to price native SOL via the Jupiter fallback.
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Balance tokens. SOL is the native balance (fetched via getBalance), the rest
 * are SPL token accounts. `pyth` is a Hermes price-feed id (primary source);
 * `priceMint` is the mint used for the Jupiter price fallback. DC has a fixed
 * USD value so it needs no oracle. (CoinGecko is avoided — it blocks Worker
 * egress IPs; Jupiter is Solana-native and reliable.)
 */
export const BALANCE_TOKENS = {
  hnt: { mint: HNT_MINT, decimals: 8, label: "HNT", pyth: "649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756", priceMint: HNT_MINT },
  mobile: { mint: MOBILE_MINT, decimals: 6, label: "MOBILE", pyth: "ff4c53361e36a9b837433c87d290c229e1f01aec5ef98d9f3f70953a20a629ce", priceMint: MOBILE_MINT },
  iot: { mint: IOT_MINT, decimals: 6, label: "IOT", pyth: null, priceMint: IOT_MINT },
  sol: { mint: null, decimals: 9, label: "SOL", native: true, pyth: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", priceMint: WRAPPED_SOL_MINT },
  dc: { mint: DC_MINT, decimals: 0, label: "DC", fixedUsdPerUnit: 1 / DC_PER_USD },
};

// ── External services ────────────────────────────────────────────────────────
export const ENTITY_API_BASE = "https://entities.nft.helium.io";
export const PYTH_HERMES_BASE = "https://hermes.pyth.network";
export const JUPITER_PRICE_BASE = "https://lite-api.jup.ag";
export const HELIUS_ENHANCED_BASE = "https://api.helius.xyz";

// Classify IoT device type by onboarding fee: data-only Hotspots pay ~50,000 DC,
// full IoT Hotspots pay ~1,000,000 DC. The threshold sits between the two so a
// fee at or above it is "full".
export const IOT_DATA_ONLY_FEE_MAX = 500_000;

// ── KV cache TTLs (seconds) ──────────────────────────────────────────────────
export const CACHE_TTL = {
  summary: 60,
  fleet: 120,
  prices: 60,
  // Helium rewards distribute on a ~daily cycle, so reward results are very
  // cacheable. Kept modest so a claim (which changes `claimed`) reflects soon.
  rewards: 900, // 15 min
};

// Max Hotspots per /rewards request. Larger than the claimer's single-lookup
// batch (25) so a fleet needs far fewer requests (455 ⇒ 10 vs 19).
export const REWARDS_BATCH_SIZE = 50;

// ── Rate limits (per IP) ─────────────────────────────────────────────────────
export const RATE_LIMIT = {
  prefix: "rl:wd",
  maxRequests: 30,
  windowSeconds: 60,
};

// ── Misc ─────────────────────────────────────────────────────────────────────
export const MAX_TRANSACTIONS = 25;
