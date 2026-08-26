import { resolveSolanaWallet } from "../lib/solanaAddress.js";
import { WALLET_ADDRESS_SCHEMA } from "../webmcp/helpers.js";

/**
 * WebMCP tools for /ve-hnt. `analyzeWallet` is provided by the page: it
 * sets the input, runs the page's own load (one fetch serves the tool
 * result AND the rendered analysis), and resolves Helium B58 to the
 * Solana form the worker endpoint requires. Claiming stays in the UI —
 * it needs the owner's wallet signature.
 */
export function makeVeHntTools(analyzeWallet) {
  return [
    {
      name: "get-vehnt-positions",
      title: "Analyze veHNT positions",
      description:
        "Fetch and display staked HNT (veHNT) positions for a wallet: lockup type and end date, veHNT weight, landrush bonus, delegation target, pending rewards, and recent votes. Also loads the analysis in the page UI.",
      inputSchema: {
        type: "object",
        properties: { wallet: WALLET_ADDRESS_SCHEMA },
        required: ["wallet"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      validate({ wallet }) {
        return resolveSolanaWallet(wallet) ? null : `"${wallet}" is not a valid Solana or Helium wallet address`;
      },
      execute({ wallet }) {
        return analyzeWallet(wallet);
      },
    },
  ];
}
