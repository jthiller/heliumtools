import { lookupHotspot, fetchRewards, claimRewards, fetchWalletHotspots } from "../lib/hotspotClaimerApi.js";
import { ENTITY_KEY_SCHEMA, SOLANA_ADDRESS_SCHEMA, capListField } from "../webmcp/helpers.js";

/** Cap wallet Hotspot lists in tool results; the UI still shows everything. */
const WALLET_RESULT_CAP = 300;

/**
 * WebMCP tools for /hotspot-claimer. Lookups also drive the page (the URL
 * is its source of truth — ?mode=&key=/wallet= — so the user sees what the
 * agent is doing): `showHotspot`/`showWallet` are the page's own URL
 * navigation handlers. Claiming is the page's core action: permissionless
 * and treasury-subsidized, no wallet signature involved.
 */
export function makeClaimerTools({ showHotspot, showWallet }) {
  return [
    {
      name: "lookup-hotspot",
      title: "Look up a Hotspot",
      description:
        "Look up a Hotspot by entity key: name, owner, networks, and on-chain info. Also shows it in the claimer UI for the user.",
      inputSchema: {
        type: "object",
        properties: { entity_key: ENTITY_KEY_SCHEMA },
        required: ["entity_key"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ entity_key }, { signal } = {}) {
        signal?.throwIfAborted();
        showHotspot(entity_key);
        return lookupHotspot(entity_key, { signal });
      },
    },
    {
      name: "get-hotspot-rewards",
      title: "Get Hotspot rewards",
      description:
        "Pending (claimable) and lifetime IOT/MOBILE/HNT rewards for a Hotspot by entity key. Live oracle read — reflects claims immediately.",
      inputSchema: {
        type: "object",
        properties: { entity_key: ENTITY_KEY_SCHEMA },
        required: ["entity_key"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ entity_key }, { signal } = {}) {
        signal?.throwIfAborted();
        return fetchRewards(entity_key, { signal });
      },
    },
    {
      name: "claim-hotspot-rewards",
      title: "Claim Hotspot rewards",
      description:
        "Broadcast real, permissionless claim transactions for a Hotspot's pending rewards. Rewards always go to the Hotspot owner's wallet (never to the caller), and the claim fee is subsidized by the site's treasury — so only claim when the user asked to. Check get-hotspot-rewards first; claiming zero pending rewards wastes the subsidy.",
      inputSchema: {
        type: "object",
        properties: { entity_key: ENTITY_KEY_SCHEMA },
        required: ["entity_key"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: true },
      async execute({ entity_key }, { signal } = {}) {
        signal?.throwIfAborted();
        const result = await claimRewards(entity_key, { signal });
        signal?.throwIfAborted();
        if (result?.success === false) {
          const error = new Error(result.error || result.message || "No rewards were claimed; inspect the per-token claim results before retrying.");
          error.data = result;
          throw error;
        }
        return result;
      },
    },
    {
      name: "list-wallet-hotspots",
      title: "List a wallet's Hotspots",
      description:
        "List every Hotspot owned by a wallet (name, entity key, networks). Also loads the wallet in the claimer UI so the user can claim from there.",
      inputSchema: {
        type: "object",
        properties: {
          // Solana-only: the /wallet endpoint (and the page) reject Helium B58.
          address: { ...SOLANA_ADDRESS_SCHEMA, description: "The owner's Solana wallet address (base58)." },
        },
        required: ["address"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address }, { signal } = {}) {
        signal?.throwIfAborted();
        showWallet(address);
        return capListField(await fetchWalletHotspots(address, { signal }), "hotspots", WALLET_RESULT_CAP);
      },
    },
  ];
}
