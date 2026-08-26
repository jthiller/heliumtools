import { fetchPositions } from "../lib/veHntApi.js";
import { BASE58_PATTERN } from "../webmcp/webmcp.js";

/**
 * WebMCP tools for /ve-hnt. `showWallet` pushes the address into the
 * page's input state (which auto-loads and renders), so the user sees the
 * same analysis the agent reads. Claiming stays in the UI — it needs the
 * owner's wallet signature.
 */
export function makeVeHntTools(showWallet) {
  return [
    {
      name: "get-vehnt-positions",
      title: "Analyze veHNT positions",
      description:
        "Fetch and display staked HNT (veHNT) positions for a wallet: lockup type and end date, veHNT weight, landrush bonus, delegation target, pending rewards, and recent votes. Also loads the analysis in the page UI.",
      inputSchema: {
        type: "object",
        properties: {
          wallet: {
            type: "string",
            pattern: BASE58_PATTERN,
            minLength: 32,
            maxLength: 60,
            description: "Wallet address (Solana base58 or Helium B58).",
          },
        },
        required: ["wallet"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ wallet }) {
        showWallet(wallet);
        return fetchPositions(wallet);
      },
    },
  ];
}
