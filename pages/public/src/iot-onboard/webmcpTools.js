import { fetchOnboardFees } from "../lib/iotOnboardApi.js";

/**
 * WebMCP tools for /iot-onboard. Onboarding itself runs over Web
 * Bluetooth plus a wallet signature — both need a human at the machine —
 * so agents get the read side: current on-chain fee schedule.
 */
export const iotOnboardTools = [
  {
    name: "get-iot-onboard-fees",
    title: "Get IoT onboarding fees",
    description:
      "Current on-chain fees for onboarding a Helium IoT Hotspot, in Data Credits: full (PoC-eligible) vs data-only onboard fees and the location assert fee. Cached ~6h server-side.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute() {
      return fetchOnboardFees();
    },
  },
];
