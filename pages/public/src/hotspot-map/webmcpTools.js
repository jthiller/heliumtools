import { SOLANA_ADDRESS_SCHEMA, ENTITY_KEY_SCHEMA, capListField } from "../webmcp/helpers.js";

/** Cap the returned list; everything is still plotted on the map. */
const MAP_RESULT_CAP = 300;

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
          address: { ...SOLANA_ADDRESS_SCHEMA, description: "The owner's Solana wallet address (base58)." },
        },
        required: ["address"],
        additionalProperties: false,
      },
      async execute({ address }) {
        return capListField(await addWalletToMap(address), "hotspots", MAP_RESULT_CAP);
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
            items: ENTITY_KEY_SCHEMA,
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
