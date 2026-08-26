import { fetchMobileFees } from "../lib/mobileOnboardApi.js";

/**
 * WebMCP tools for /mobile-onboard. Onboarding needs the user's Solana
 * wallet signature (and the tool already has its own link-handoff "agent
 * brief" flow for external agents — see AgentBriefPanel). In-page agents
 * get fee reads and tab navigation.
 */
export function makeMobileOnboardTools(setTab) {
  return [
    {
      name: "get-mobile-onboard-fees",
      title: "Get Mobile onboarding fees",
      description:
        "Current on-chain fees for onboarding a WiFi network as a Helium Mobile data-only Hotspot, in Data Credits: onboard fee plus location assert fee. Cached ~6h server-side.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute() {
        return fetchMobileFees();
      },
    },
    {
      name: "open-mobile-onboard-tab",
      title: "Open a Mobile Onboarding tab",
      description:
        "Switch the Mobile WiFi Onboarding page between its tabs: 'onboard' (the wizard), 'manage' (already-onboarded networks), or 'guide' (per-vendor router setup instructions).",
      inputSchema: {
        type: "object",
        properties: {
          tab: { type: "string", enum: ["onboard", "manage", "guide"], description: "Tab to show." },
        },
        required: ["tab"],
        additionalProperties: false,
      },
      execute({ tab }) {
        setTab(tab);
        return `Showing the ${tab} tab.`;
      },
    },
  ];
}
