import { resolveSolanaWallet, toHeliumB58 } from "../lib/solanaAddress.js";
import { migrateWallet } from "../lib/l1MigrationApi.js";
import { WALLET_ADDRESS_SCHEMA } from "../webmcp/helpers.js";

const ADDRESS_SCHEMA = {
  ...WALLET_ADDRESS_SCHEMA,
  description: "Legacy Helium B58 address or its Solana base58 form.",
};

// Shared domain check: base58 shape passes the schema, but the address
// must decode as a real Helium or Solana key.
const validateAddress = ({ address }) =>
  resolveSolanaWallet(address) ? null : `"${address}" is not a valid Helium or Solana address`;

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
      validate: validateAddress,
      execute({ address }) {
        const solana = resolveSolanaWallet(address);
        return { solana: solana.toBase58(), helium: toHeliumB58(solana) };
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
      validate: validateAddress,
      async execute({ address }) {
        showWallet(address);
        const result = await migrateWallet(resolveSolanaWallet(address).toBase58());
        reportStatus({
          tone: result.success ? (result.transactionsProcessed === 0 ? "info" : "success") : "error",
          message: result.message,
        });
        return result;
      },
    },
  ];
}
