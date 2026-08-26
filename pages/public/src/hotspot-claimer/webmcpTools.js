import { lookupHotspot, fetchRewards, claimRewards, fetchWalletHotspots } from "../lib/hotspotClaimerApi.js";
import { BASE58_PATTERN } from "../webmcp/webmcp.js";

/** Cap wallet Hotspot lists in tool results; the UI still shows everything. */
const WALLET_RESULT_CAP = 300;

const ENTITY_KEY_SCHEMA = {
  type: "string",
  pattern: BASE58_PATTERN,
  minLength: 32,
  maxLength: 60,
  description: "The Hotspot's entity key (its Helium public key, base58).",
};

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
      execute({ entity_key }) {
        showHotspot(entity_key);
        return lookupHotspot(entity_key);
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
      execute({ entity_key }) {
        return fetchRewards(entity_key);
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
      execute({ entity_key }) {
        return claimRewards(entity_key);
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
          address: {
            type: "string",
            pattern: BASE58_PATTERN,
            minLength: 32,
            maxLength: 60,
            description: "The owner wallet address (Solana base58 or Helium B58).",
          },
        },
        required: ["address"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address }) {
        showWallet(address);
        const result = await fetchWalletHotspots(address);
        const hotspots = result?.hotspots;
        if (Array.isArray(hotspots) && hotspots.length > WALLET_RESULT_CAP) {
          return {
            ...result,
            hotspots: hotspots.slice(0, WALLET_RESULT_CAP),
            truncated: `showing ${WALLET_RESULT_CAP} of ${hotspots.length} Hotspots (the page UI lists all)`,
          };
        }
        return result;
      },
    },
  ];
}
