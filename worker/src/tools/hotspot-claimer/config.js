// Helium Program IDs (as strings — convert to PublicKey at point of use)
export const LAZY_DISTRIBUTOR_PROGRAM_ID =
  "1azyuavdMyvsivtNxPoz6SucD18eDHeXzFCUPq5XU7w";
export const REWARDS_ORACLE_PROGRAM_ID =
  "rorcfdX4h9m9swCKgcypaHJ8NGYVANBpmV9EHn3cYrF";
export const HELIUM_ENTITY_MANAGER_PROGRAM_ID =
  "hemjuPXBpNvggtaUnN1MwT3wrdhttKEfosTcc2P9Pg8";

// Token Mints
export const HNT_MINT = "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux";
export const IOT_MINT = "iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns";
export const MOBILE_MINT = "mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6";

// Helium Sub-DAOs program (used to derive DAO PDA)
export const HELIUM_SUB_DAOS_PROGRAM_ID =
  "hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR";

// Helium Address Lookup Table
export const HELIUM_COMMON_LUT = "43eY9L2spbM2b1MPDFFBStUiFGt29ziZ1nc1xbpzsfVt";

// Token metadata
export const TOKENS = {
  iot: { mint: IOT_MINT, decimals: 6, label: "IOT" },
  mobile: { mint: MOBILE_MINT, decimals: 6, label: "MOBILE" },
  hnt: { mint: HNT_MINT, decimals: 8, label: "HNT" },
};

// Helium Entity API
export const ENTITY_API_BASE = "https://entities.nft.helium.io";

// Rate limits
export const MAX_CLAIMS_PER_HOTSPOT_HOURS = 24;
export const MAX_CLAIMS_PER_DAY_GLOBAL = 100;
export const MAX_LOOKUPS_PER_MINUTE = 30;
export const MAX_CLAIMS_PER_IP_HOUR = 10;
export const MAX_RECIPIENT_INITS_PER_DAY = 1;
