/**
 * Helium and Solana program constants.
 * These addresses are fixed on mainnet and devnet.
 */

// Helium Program IDs
export const DATA_CREDITS_PROGRAM_ID = 'credMBJhYFzfn7NxBMdU4aUqFggAjgztaCcv2Fo6fPT';
export const HELIUM_SUB_DAOS_PROGRAM_ID = 'hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR';

// Token Mints
export const HNT_MINT = 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux';
export const DC_MINT = 'dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const IOT_MINT = 'iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns';

// Note: DAO and SubDAO are derived as PDAs in dataCredits.js using:
// DAO = ["dao", HNT_MINT] via HELIUM_SUB_DAOS_PROGRAM
// IOT SubDAO = ["sub_dao", IOT_MINT] via HELIUM_SUB_DAOS_PROGRAM

// Jupiter API (Authenticated v1 - requires JUPITER_API_KEY)
export const JUPITER_QUOTE_API_URL = 'https://api.jup.ag/swap/v1/quote';
export const JUPITER_SWAP_API_URL = 'https://api.jup.ag/swap/v1/swap';

// HNT price oracle (Pyth HNT/USD on Solana Mainnet)
export const HNT_PRICE_ORACLE = 'G6LTK242sYw8e6SrxFh25e5wGmj29Xh12g9119yY5MvP';

// Token decimals
export const HNT_DECIMALS = 8;
export const DC_DECIMALS = 0; // DC has no decimals
export const USDC_DECIMALS = 6;

// Solscan base URLs
export const SOLSCAN_TX_URL = 'https://solscan.io/tx';
export const SOLSCAN_ACCOUNT_URL = 'https://solscan.io/account';
