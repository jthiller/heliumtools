/**
 * Schema fragments and result helpers shared by per-page webmcpTools.js
 * modules. Deliberately tiny and dependency-free: page chunks import this
 * statically, while the heavy registration/validation core (webmcp.js) is
 * dynamically imported by useWebMcpTools only in browsers that actually
 * expose WebMCP.
 */

/**
 * Base58 alphabet pattern for Solana pubkeys, Helium B58 addresses, and
 * Hotspot entity keys. The schema constants below pair it with the
 * agreed length bounds — spread one and override `description` per field
 * rather than re-declaring the bounds.
 */
export const BASE58_PATTERN = "^[1-9A-HJ-NP-Za-km-z]+$";

/** A Solana wallet address. */
export const SOLANA_ADDRESS_SCHEMA = {
  type: "string",
  pattern: BASE58_PATTERN,
  minLength: 32,
  maxLength: 44,
  description: "Solana wallet address (base58).",
};

/** A wallet in either encoding: Solana base58 or legacy Helium B58. */
export const WALLET_ADDRESS_SCHEMA = {
  type: "string",
  pattern: BASE58_PATTERN,
  minLength: 32,
  maxLength: 60,
  description: "Wallet address (Solana base58 or Helium B58).",
};

/**
 * A Hotspot entity key (its Helium public key). The 20-500 range matches
 * the on-chain range hotspot-map's CLAUDE.md documents — keep every page
 * agreeing on it so agents don't get contradictory bounds.
 */
export const ENTITY_KEY_SCHEMA = {
  type: "string",
  pattern: BASE58_PATTERN,
  minLength: 20,
  maxLength: 500,
  description: "The Hotspot's entity key (its Helium public key, base58).",
};

/**
 * Cap an array field on a tool result so a big wallet can't blow out an
 * agent's context, adding a `truncated` note when the cap bites. Only the
 * returned list is capped — the page UI still shows everything.
 */
export function capListField(result, field, cap) {
  const list = result?.[field];
  if (!Array.isArray(list) || list.length <= cap) return result;
  return {
    ...result,
    [field]: list.slice(0, cap),
    truncated: `showing ${cap} of ${list.length} ${field}`,
  };
}
