import { fetchSummary, fetchFleet, fetchRewards, fetchTransactions } from "../lib/walletDashboardApi.js";
import { SOLANA_ADDRESS_SCHEMA, capListField } from "../webmcp/helpers.js";
import { REWARD_DECIMALS } from "./format.js";
import { REWARDS_BATCH_SIZE, eligibleRewardHotspots } from "./useFleetRewards.js";

const ADDRESS_SCHEMA = {
  ...SOLANA_ADDRESS_SCHEMA,
  description:
    "Solana wallet address (base58). Optional when the dashboard already shows a wallet — defaults to that one.",
};

/** Cap fleet lists in tool results; the UI still shows everything. */
const FLEET_RESULT_CAP = 200;
/** Two reward batches keeps the tool bounded on maker-sized fleets. */
const REWARDS_HOTSPOT_CAP = 100;

/** Format a base-unit BigInt as a decimal token string, trimming zeros. */
function formatBaseUnits(amount, decimals) {
  if (!decimals) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * WebMCP tools for /wallet-dashboard. The URL is the page's source of
 * truth, so open-wallet-dashboard just navigates and the page does the
 * rest; the get-* tools return data directly from the same worker
 * endpoints the UI uses (KV-cached server-side).
 *
 * `getWallet` returns the wallet currently shown (or null) — passed as a
 * live getter so tools registered once stay correct across navigation.
 */
export function makeWalletDashboardTools(navigate, getWallet) {
  // The explicit address argument, or the wallet the page is showing.
  const requireWallet = (address) => {
    const wallet = address || getWallet();
    if (!wallet) throw new Error("no wallet given and none loaded in the dashboard — pass `address`");
    return wallet;
  };

  return [
    {
      name: "open-wallet-dashboard",
      title: "Open a wallet in the dashboard",
      description:
        "Show a wallet in the dashboard UI: balances, fleet map, rewards, governance, and activity all load for the user to see. Use the get-* tools to read the underlying data.",
      inputSchema: {
        type: "object",
        properties: { address: { ...SOLANA_ADDRESS_SCHEMA, description: "Solana wallet address (base58) to display." } },
        required: ["address"],
        additionalProperties: false,
      },
      execute({ address }) {
        navigate(`/wallet-dashboard/${address}`);
        return `Dashboard now loading wallet ${address}. Data may take a few seconds to appear on screen.`;
      },
    },
    {
      name: "get-wallet-summary",
      title: "Get wallet summary",
      description:
        "Token balances (HNT/MOBILE/IOT/SOL/DC) with USD prices, portfolio total, and fleet stats for a wallet. Cached server-side ~60s.",
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ address }) {
        return fetchSummary(requireWallet(address));
      },
    },
    {
      name: "get-wallet-fleet",
      title: "Get wallet Hotspot fleet",
      description:
        `Full per-Hotspot list for a wallet: name, entity key, network, location, and activity. Large fleets are truncated to ${FLEET_RESULT_CAP} Hotspots in the result (the UI shows all).`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address }) {
        return capListField(await fetchFleet(requireWallet(address)), "hotspots", FLEET_RESULT_CAP);
      },
    },
    {
      name: "get-wallet-rewards",
      title: "Get wallet unclaimed rewards",
      description:
        `Pending (unclaimed) Hotspot rewards across a wallet's fleet as decimal token amounts (e.g. "12.345678" IOT), totaled per token and listed per Hotspot where nonzero. Served from a ~15min cache — rewards distribute roughly daily. Covers up to ${REWARDS_HOTSPOT_CAP} Hotspots; claim via the /hotspot-claimer page's tools.`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address }) {
        const wallet = requireWallet(address);
        const fleet = await fetchFleet(wallet);
        const eligible = eligibleRewardHotspots(fleet?.hotspots);
        const counted = eligible.slice(0, REWARDS_HOTSPOT_CAP);
        const batches = [];
        for (let i = 0; i < counted.length; i += REWARDS_BATCH_SIZE) {
          batches.push(counted.slice(i, i + REWARDS_BATCH_SIZE));
        }
        const totals = {}; // token -> BigInt base units (exact summing)
        const decimalsByToken = {};
        const byHotspot = [];
        let errors = 0;
        let failedBatches = 0;
        // allSettled, matching useFleetRewards: one slow or rate-limited
        // batch shouldn't discard the others' totals.
        const settled = await Promise.allSettled(batches.map((batch) => fetchRewards(wallet, batch)));
        for (const outcome of settled) {
          if (outcome.status === "rejected") { failedBatches++; continue; }
          const results = outcome.value;
          for (const [entityKey, entry] of Object.entries(results || {})) {
            if (entry?.error) { errors++; continue; }
            const pending = {};
            for (const [token, tokenResult] of Object.entries(entry?.rewards || {})) {
              const amount = BigInt(tokenResult?.pending || "0");
              if (amount <= 0n) continue;
              const decimals = tokenResult.decimals ?? REWARD_DECIMALS[token];
              decimalsByToken[token] = decimals;
              pending[token] = formatBaseUnits(amount, decimals);
              totals[token] = (totals[token] ?? 0n) + amount;
            }
            if (Object.keys(pending).length > 0) byHotspot.push({ entityKey, pending });
          }
        }
        if (failedBatches === batches.length && batches.length > 0) {
          throw new Error("every rewards batch failed — try again shortly");
        }
        const totalPending = Object.fromEntries(
          Object.entries(totals).map(([token, amount]) => [token, formatBaseUnits(amount, decimalsByToken[token])]),
        );
        return {
          wallet,
          fleetSize: eligible.length,
          hotspotsCounted: counted.length,
          ...(eligible.length > counted.length
            ? { truncated: `rewards summed for ${counted.length} of ${eligible.length} Hotspots` }
            : {}),
          ...(errors ? { lookupErrors: errors } : {}),
          ...(failedBatches
            ? { failedBatches: `${failedBatches} of ${batches.length} reward batches failed — totals are partial` }
            : {}),
          totalPending,
          hotspotsWithPending: byHotspot,
        };
      },
    },
    {
      name: "get-wallet-transactions",
      title: "Get wallet transactions",
      description:
        "Categorized recent transactions for a wallet (rewards claims, transfers, Hotspot ops). Pass `before` (a transaction signature from a previous page) to paginate.",
      inputSchema: {
        type: "object",
        properties: {
          address: ADDRESS_SCHEMA,
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "Max transactions to return." },
          before: { type: "string", minLength: 32, maxLength: 120, description: "Paginate: only transactions before this signature." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute({ address, limit, before }) {
        return fetchTransactions(requireWallet(address), { limit, before });
      },
    },
  ];
}
