export const DC_TO_USD_RATE = 0.00001;
export const BURN_LOOKBACK_DAYS = 7;
export const ZERO_BALANCE_USD = 35;
export const ZERO_BALANCE_DC = 3500000; // $35 worth of DC (DC are always whole numbers)
export const OUI_API_URL = "https://entities.nft.helium.io/v2/oui/all";
export const BALANCE_HISTORY_DAYS = 30;
// Avoid Cloudflare subrequest limits when seeding balances; we fetch at most this many per update call.
export const MAX_BALANCE_FETCH_PER_UPDATE = 40;
