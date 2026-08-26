import { BASE58_PATTERN } from "../webmcp/webmcp.js";

/**
 * WebMCP tools for /hotspot-map. Both callbacks are provided by the page
 * component (they reuse its resolveKeys pipeline, so plotting behaves
 * exactly like the user's own input: merge, fit-bounds, dedupe):
 *   addWalletToMap(address) -> resolves a wallet's Hotspots onto the map
 *   addKeysToMap(keys[])    -> resolves explicit entity keys onto the map
 */
export function makeHotspotMapTools({ addWalletToMap, addKeysToMap }) {
  return [
    {
      name: "map-wallet-hotspots",
      title: "Map a wallet's Hotspots",
      description:
        "Plot every Hotspot owned by a wallet on the map (the view auto-fits to them) and return the list that was added: entity key, name, and networks.",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            pattern: BASE58_PATTERN,
            minLength: 32,
            maxLength: 44,
            description: "The owner's Solana wallet address (base58).",
          },
        },
        required: ["address"],
        additionalProperties: false,
      },
      execute({ address }) {
        return addWalletToMap(address);
      },
    },
    {
      name: "map-hotspots",
      title: "Map Hotspots by entity key",
      description:
        "Plot specific Hotspots on the map by entity key (base58) and fit the view to them. Invalid keys are skipped; the result says how many plotted.",
      inputSchema: {
        type: "object",
        properties: {
          entity_keys: {
            type: "array",
            minItems: 1,
            maxItems: 500,
            items: { type: "string", pattern: BASE58_PATTERN, minLength: 20, maxLength: 500 },
            description: "Hotspot entity keys (base58).",
          },
        },
        required: ["entity_keys"],
        additionalProperties: false,
      },
      execute({ entity_keys }) {
        return addKeysToMap(entity_keys);
      },
    },
  ];
}
