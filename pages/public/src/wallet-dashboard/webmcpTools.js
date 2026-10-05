import { fetchSummary, fetchFleet, fetchRewards, fetchTransactions } from "../lib/walletDashboardApi.js";
import {
  scanGatewayStatuses,
  fetchUtilizationIndex,
  fetchGatewayUtilizationDetail,
} from "../lib/iotStatusApi.js";
import { fetchWellKnownOuiNames, labelOuis, WELL_KNOWN_REPO_URL } from "../lib/wellKnownOuis.js";
import { ENTITY_KEY_SCHEMA, SOLANA_ADDRESS_SCHEMA, capListField } from "../webmcp/helpers.js";
import {
  REWARD_DECIMALS,
  IOT_MESSAGES_NOTE,
  IOT_CONNECTIVITY_NOTE,
  hasIotStatus,
  isTrafficKnown,
  iotActionRank,
  byMessagesDesc,
  indexForBuild,
  aggregateIotStatus,
  deriveTrafficDetail,
} from "./format.js";
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
/** IoT status lookups when the tool scans a wallet itself (one GET each).
 * Kept equal to FLEET_RESULT_CAP so a scanned list never also hits the list
 * cap — the two `truncated` notes can't collide. */
const IOT_SCAN_HOTSPOT_CAP = FLEET_RESULT_CAP;

/** Format a base-unit BigInt as a decimal token string, trimming zeros. */
function formatBaseUnits(amount, decimals) {
  if (!decimals) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Per-Hotspot IoT rows from the dashboard's aggregate (`aggregateIotStatus`),
 * most actionable first — the same `iotActionRank` order as the table's Status
 * sort — then most messages, then name.
 */
function iotRows(hotspots, agg) {
  return hotspots
    .map((hotspot) => ({ hotspot, row: agg.rows.get(hotspot.entityKey) }))
    .filter((e) => e.row)
    .sort(
      (a, b) =>
        iotActionRank(a.row.status, a.row.health) - iotActionRank(b.row.status, b.row.health) || byMessagesDesc(a, b),
    )
    .map(({ hotspot, row }) => ({
      entityKey: hotspot.entityKey,
      name: hotspot.name || null,
      status: row.status,
      health: row.health,
      messages30d: row.messages,
      ouiIds: isTrafficKnown(row.traffic) ? [...row.traffic.ouis] : null,
    }));
}

/**
 * WebMCP tools for /wallet-dashboard. The URL is the page's source of
 * truth, so open-wallet-dashboard just navigates and the page does the
 * rest; the get-* tools return data directly from the same worker
 * endpoints the UI uses (KV-cached server-side), and the IoT tools from
 * api-iot.heliumtools.org through the page's own cached clients.
 *
 * `getWallet` returns the wallet currently shown (or null), and
 * `getIotState` that wallet's IoT scan (`{ wallet, hotspots, iotStatus, done }`
 * — `iotStatus` being the page's `aggregateIotStatus` — or null). Both are
 * live getters, so tools registered once stay correct across navigation.
 */
export function makeWalletDashboardTools(navigate, getWallet, getIotState) {
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
        "Show a wallet in the dashboard UI: balances, fleet map, rewards, IoT connectivity and traffic (per-Hotspot health, and each Hotspot's daily delivered messages per operator), governance, and activity all load for the user to see. Use the get-* tools to read the underlying data.",
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
        `Full per-Hotspot list for a wallet plus fleet stats (counts by network/device type, regions, onboarding timeline). Each row: name, entityKey, assetId, network(s), deviceType, location (H3 cell) with city/state/country, createdAt, elevation (m), gain (tenths of a dBi), and dcOnboardingFeePaid. On-chain metadata only — for IoT connectivity and traffic use get-wallet-iot-status; for rewards, get-wallet-rewards. Large fleets are truncated to ${FLEET_RESULT_CAP} Hotspots in the result (the UI shows all).`,
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
      name: "get-wallet-iot-status",
      title: "Get wallet IoT connectivity and traffic",
      description:
        `Per-Hotspot IoT connectivity and 30-day delivered LoRaWAN messages for a wallet's IoT Hotspots. Connectivity is a per-UTC-day verdict (active = connected to the Helium Packet Router on the latest reported day), not online-now. Health combines the two: inactiveTraffic (not connected, but had messages in the window — check these first), activeQuiet (connected, no messages in 30 days), inactiveQuiet, activeTraffic; rows are ordered most actionable first. Uses the dashboard's finished scan when that wallet is on screen (whole fleet, same counts as the UI); otherwise looks up at most ${IOT_SCAN_HOTSPOT_CAP} IoT Hotspots. For one Hotspot's daily messages per OUI (operator), use get-iot-hotspot-traffic.`,
      inputSchema: {
        type: "object",
        properties: { address: ADDRESS_SCHEMA },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ address }) {
        const wallet = requireWallet(address);
        // The page's finished scan for this wallet (whole fleet, zero lookups),
        // else a capped scan of our own through the same per-row loop.
        const page = getIotState?.();
        const usePage = page?.done && page.wallet === wallet && Array.isArray(page.hotspots);
        const eligible = (usePage ? page.hotspots : (await fetchFleet(wallet))?.hotspots || []).filter(hasIotStatus);
        const iotHotspots = eligible.length;
        const hotspots = usePage ? eligible : eligible.slice(0, IOT_SCAN_HOTSPOT_CAP);
        // The page-wide index (memoized), fetched alongside the scan.
        const indexPromise = hotspots.length ? fetchUtilizationIndex().catch(() => null) : null;
        let agg = page?.iotStatus;
        if (!usePage) {
          const { statusByKey, dataThrough } = await scanGatewayStatuses(hotspots.map((h) => h.entityKey));
          if (hotspots.length > 0 && hotspots.every((h) => statusByKey[h.entityKey] === null)) {
            throw new Error("every IoT status lookup failed — try again shortly");
          }
          agg = aggregateIotStatus(hotspots, statusByKey, dataThrough);
        }
        const index = await indexPromise;

        const { traffic, trafficRange, livenessRange } = agg;
        // The network index describes one build; apply it only to that build's day.
        const build = indexForBuild(index, trafficRange?.max);
        const indexWindow = build
          ? { days: build.days, daysComplete: build.daysComplete, missingDays: build.missingDays }
          : null;
        const rows = iotRows(hotspots, agg);
        const truncated = iotHotspots > hotspots.length;

        const notes = [IOT_MESSAGES_NOTE, `${IOT_CONNECTIVITY_NOTE} connectivityDay names that day.`];
        if (iotHotspots === 0) notes.push("This wallet has no IoT Hotspots.");
        if (livenessRange?.min !== livenessRange?.max || trafficRange?.min !== trafficRange?.max) {
          notes.push(
            "Records span more than one data day (a range's min differs from its max) — some come from older cached copies.",
          );
        }
        if (indexWindow && indexWindow.daysComplete < indexWindow.days) {
          notes.push(
            `Only ${indexWindow.daysComplete} of ${indexWindow.days} days in the 30-day window are complete, so message counts are lower bounds.`,
          );
        }
        if (traffic.unpublished > 0) {
          notes.push("IoT traffic data isn't published right now, so messages30d is null. Connectivity is unaffected.");
        }
        if (truncated) {
          notes.push(
            `Looked up ${hotspots.length} of ${iotHotspots} IoT Hotspots; counts cover those only. Open the wallet with open-wallet-dashboard and call again once its IoT scan finishes to cover the whole fleet.`,
          );
        }
        if (rows.length > FLEET_RESULT_CAP) {
          notes.push(`hotspots lists the ${FLEET_RESULT_CAP} most actionable rows; counts and health cover all ${rows.length}.`);
        }

        return capListField(
          {
            wallet,
            iotHotspots,
            hotspotsCounted: hotspots.length,
            ...(truncated ? { truncated: `IoT status looked up for ${hotspots.length} of ${iotHotspots} IoT Hotspots` } : {}),
            connectivityDay: livenessRange,
            trafficThrough: trafficRange,
            window: indexWindow,
            counts: { active: agg.active, inactive: agg.inactive, settingUp: agg.settingUp, unknown: agg.unknown },
            traffic: {
              withTraffic: traffic.withTraffic,
              known: traffic.known,
              messages30dSummedAcrossHotspots: traffic.messages30d,
              unavailable: traffic.unavailable,
              unpublished: traffic.unpublished,
            },
            health: { ...traffic.health },
            hotspots: rows,
            notes,
          },
          "hotspots",
          FLEET_RESULT_CAP,
        );
      },
    },
    {
      name: "get-iot-hotspot-traffic",
      title: "Get one IoT Hotspot's traffic by operator",
      description:
        "One IoT Hotspot's delivered LoRaWAN messages per day and per OUI (the routing ID of a LoRaWAN Network Server operator) over the 30-day window, with operator names from Helium's well-known OUI list. One Hotspot per call — triage a wallet with get-wallet-iot-status first. `daily[].byOui` maps OUI id → messages that UTC day; `quietNetworkWide: true` means that OUI delivered nowhere on the network in the last 7 days (an operator-side drop, not this Hotspot's); `recentShare` is the last 7 days' daily average ÷ the 30-day daily average (null when it can't be stated honestly).",
      inputSchema: {
        type: "object",
        properties: {
          entityKey: {
            ...ENTITY_KEY_SCHEMA,
            description:
              "The IoT Hotspot's entity key (its Helium public key, base58) — the entityKey from get-wallet-iot-status or get-wallet-fleet.",
          },
        },
        required: ["entityKey"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ entityKey }) {
        // A known zero in the page's scan needs no detail request.
        const known = getIotState?.()?.iotStatus?.rows.get(entityKey)?.traffic;
        if (isTrafficKnown(known) && known.packets30d === 0) {
          // The page-wide index (memoized; no per-Hotspot request) says whether
          // this zero spans 30 reported days or is a lower bound.
          const build = indexForBuild(await fetchUtilizationIndex().catch(() => null), known.dataThrough);
          const partial = build ? build.daysComplete < build.days : null;
          return {
            entityKey,
            dataThrough: known.dataThrough,
            window: build ? { days: build.days, daysComplete: build.daysComplete } : null,
            isPartial: partial,
            packets30d: 0,
            packets7d: 0,
            packets1d: 0,
            lastDay: null,
            recentShare: null,
            ouis: [],
            daily: [],
            notes: [
              partial
                ? `No delivered messages in the ${build.daysComplete} reported days of the 30-day window through ${known.dataThrough} (UTC), from the dashboard's IoT scan; ${build.days - build.daysComplete} days went unreported, so this zero is a lower bound. There is no daily breakdown.`
                : `No delivered messages in the 30 data days through ${known.dataThrough} (UTC), from the dashboard's IoT scan — there is no daily breakdown.`,
              ...(build ? [] : ["Window completeness couldn't be confirmed (window and isPartial are null)."]),
              IOT_MESSAGES_NOTE,
            ],
          };
        }

        const [result, names, index] = await Promise.all([
          fetchGatewayUtilizationDetail(entityKey),
          fetchWellKnownOuiNames().catch(() => null),
          fetchUtilizationIndex().catch(() => null),
        ]);
        if (result.notFound) {
          throw new Error("not in the IoT service's Hotspot inventory — check the entity key (IoT Hotspots only)");
        }
        if (result.unpublished) {
          return {
            entityKey,
            unpublished: true,
            note: "IoT traffic data isn't published right now — try again later.",
          };
        }

        const { detail } = result;
        const labels = labelOuis(detail.ouis.map((o) => o.oui), names ?? new Map());
        const derived = deriveTrafficDetail(detail, labels, index);
        const ready = derived.kind === "ready";

        // deriveTrafficDetail's zero-filled window, with per-OUI daily counts.
        const daily = ready
          ? derived.days.map((d) => ({
              day: d.day,
              ...(derived.missingKnown ? { missing: d.missing } : {}),
              // An unreported day is "no data", never 0.
              total: d.missing ? null : d.total,
              byOui: d.byOui,
            }))
          : [];

        const notes = [IOT_MESSAGES_NOTE, "Days are UTC data days; dataThrough is the window's last day."];
        if (!ready) notes.push("No delivered messages in the window — there is no daily breakdown.");
        if (derived.isPartial) {
          notes.push(
            `Only ${detail.window.daysComplete} of ${detail.window.days} days in the window are complete, so counts are lower bounds.`,
          );
        }
        if (ready && !derived.missingKnown) {
          notes.push("Which days went unreported isn't known for this build, so a 0 day may be an unreported day rather than no traffic.");
        } else if (daily.some((d) => d.missing)) {
          notes.push("Days with missing: true had no data reported (total null) — not zero traffic.");
        }
        notes.push(
          names === null
            ? "Helium's well-known OUI list couldn't be loaded, so every name is null."
            : `name comes from Helium's well-known OUI list; null means the operator hasn't listed its OUI there (${WELL_KNOWN_REPO_URL}).`,
        );

        return {
          entityKey,
          dataThrough: detail.dataThrough,
          window: detail.window,
          isPartial: derived.isPartial,
          packets30d: detail.packets30d,
          packets7d: detail.packets7d,
          packets1d: detail.packets1d,
          lastDay: ready ? derived.lastDay : null,
          recentShare: ready ? derived.recentShare : null,
          ouis: ready
            ? derived.ouis.map((o) => ({
                oui: o.oui,
                name: o.fullName ?? null,
                packets30d: o.packets30d,
                packets7d: o.packets7d,
                daysActive30d: o.daysActive30d,
                lastDay: o.lastDay,
                quietNetworkWide: o.quietNetworkWide,
              }))
            : [],
          daily,
          notes,
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
