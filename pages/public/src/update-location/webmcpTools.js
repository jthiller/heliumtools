import { fetchHotspotStatus } from "../lib/updateLocationApi.js";
import { BASE58_PATTERN } from "../webmcp/webmcp.js";

/**
 * WebMCP tools for /update-location. The assert transaction needs the
 * owner's wallet signature in the UI; agents get the read side: a
 * Hotspot's current on-chain location/elevation/gain.
 */
export const updateLocationTools = [
  {
    name: "get-hotspot-onchain-info",
    title: "Get Hotspot on-chain info",
    description:
      "Current on-chain IoT info for a Hotspot by gateway public key: asserted location (H3), elevation, antenna gain, and onboarding status. Use before deciding whether a re-assert is needed.",
    inputSchema: {
      type: "object",
      properties: {
        gateway: {
          type: "string",
          pattern: BASE58_PATTERN,
          minLength: 32,
          maxLength: 60,
          description: "The Hotspot's gateway public key (Helium base58 entity key).",
        },
      },
      required: ["gateway"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute({ gateway }) {
      return fetchHotspotStatus(gateway);
    },
  },
];
