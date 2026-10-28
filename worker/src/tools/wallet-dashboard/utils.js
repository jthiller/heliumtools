// Wallet Dashboard — small shared helpers.

// Reuse the canonical validator (already cross-imported by hotspot-map) rather
// than keeping a third copy of the base58/length check.
export { isValidWalletAddress } from "../hotspot-claimer/utils.js";
// The Solana RPC primitive and KV JSON helpers now live in worker/src/lib so
// they aren't duplicated per tool — re-export to keep this module's API stable.
export { rpc } from "../../lib/solanaRpc.js";
export { kvGetJson, kvPutJson } from "../../lib/kv.js";
// Shared with council-emissions (wallet identity); lives in lib/helius.js.
export { getHeliusApiKey } from "../../lib/helius.js";
