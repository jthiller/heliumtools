import { SOLANA_ADDRESS_SCHEMA, ENTITY_KEY_SCHEMA, capListField } from "../webmcp/helpers.js";
import { fetchOnboardDates } from "../lib/hotspotMapApi.js";

/** Cap the returned list; everything is still plotted on the map. */
const MAP_RESULT_CAP = 300;

/**
 * WebMCP tools for /hotspot-map. Both callbacks are provided by the page
 * component (they reuse its resolveKeys pipeline, so plotting behaves
 * exactly like the user's own input: merge, fit-bounds, dedupe):
 *   addWalletToMap(address) -> resolves a wallet's Hotspots onto the map
 *   addKeysToMap(keys[])    -> resolves explicit entity keys onto the map
 * get-hotspot-onboard-dates is a plain read through the same client (and
 * session cache) the detail card uses.
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
    {
      name: "get-hotspot-onboard-dates",
      title: "Get a Hotspot's onboard dates",
      description:
        "When one Hotspot was onboarded to each network, read from chain (block time of the first successful transaction on its IoT/Mobile info account) — the date the map's detail card shows. Hotspots from before Helium's April 2023 move to Solana show their migration date, not their original deployment. null means not on that network or not determinable. For a whole wallet at once, use /wallet-dashboard's get-wallet-onboarding.",
      inputSchema: {
        type: "object",
        properties: {
          entity_key: { ...ENTITY_KEY_SCHEMA, description: "The Hotspot's entity key (base58)." },
          networks: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: { type: "string", enum: ["iot", "mobile"] },
            description: "Networks to read (default both).",
          },
        },
        required: ["entity_key"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ entity_key, networks = ["iot", "mobile"] }) {
        const onboarded = await fetchOnboardDates(entity_key, [...new Set(networks)].join(","));
        if (!onboarded) throw new Error("onboard-date lookup failed or was rate-limited — try again shortly");
        return { entityKey: entity_key, onboarded };
      },
    },
  ];
}
