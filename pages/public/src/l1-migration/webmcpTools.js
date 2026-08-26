import Address from "@helium/address";
import { resolveSolanaWallet } from "../lib/solanaAddress.js";
import { migrateWallet } from "../lib/l1MigrationApi.js";
import { BASE58_PATTERN } from "../webmcp/webmcp.js";

const ADDRESS_SCHEMA = {
  type: "string",
  pattern: BASE58_PATTERN,
  minLength: 32,
  maxLength: 60,
  description: "Legacy Helium B58 address or its Solana base58 form.",
};

/**
 * WebMCP tools for /l1-migration. Migration is the one on-chain action on
 * the site that needs no wallet signature — the worker broadcasts
 * pre-signed transactions from the official migration service — so it is
 * exposed directly. `showWallet` mirrors the address into the page input
 * (so the user sees the derived addresses) and `reportStatus` drives the
 * page's status banner with the outcome.
 */
export function makeL1MigrationTools({ showWallet, reportStatus }) {
  return [
    {
      name: "derive-helium-addresses",
      title: "Derive Helium ↔ Solana addresses",
      description:
        "Convert between a legacy Helium L1 wallet address and its Solana address (same underlying ed25519 key, two encodings). Accepts either form; returns both.",
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        required: ["address"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ address }) {
        const solana = resolveSolanaWallet(address);
        if (!solana) {
          return { content: [{ type: "text", text: `"${address}" is not a valid Helium or Solana address.` }], isError: true };
        }
        return {
          solana: solana.toBase58(),
          helium: new Address(0, 0, 1, solana.toBytes()).b58,
        };
      },
    },
    {
      name: "migrate-l1-wallet",
      title: "Migrate an L1 wallet to Solana",
      description:
        "Broadcast a legacy Helium L1 account's pre-signed migration transactions to seed its balances on Solana. Permissionless and safe to re-run: an already-migrated wallet reports zero transactions processed. Also shows the result in the page UI.",
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        required: ["address"],
        additionalProperties: false,
      },
      async execute({ address }) {
        const solana = resolveSolanaWallet(address);
        if (!solana) {
          return { content: [{ type: "text", text: `"${address}" is not a valid Helium or Solana address.` }], isError: true };
        }
        showWallet(address);
        const result = await migrateWallet(solana.toBase58());
        reportStatus({
          tone: result.success ? (result.transactionsProcessed === 0 ? "info" : "success") : "error",
          message: result.message,
        });
        return result;
      },
    },
  ];
}
