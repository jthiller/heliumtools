/**
 * Agent-facing catalog of heliumtools.org tool pages, served by the
 * site-wide `list-helium-tools` WebMCP tool and used to validate
 * `open-helium-tool` navigation targets.
 *
 * This is deliberately separate from the landing page's marketing copy
 * (`pages/Landing.jsx`): summaries here are written for agents (inputs,
 * capabilities, wallet requirements), and the catalog includes pages the
 * landing page doesn't link (the /vote pages, which are public but
 * unlisted). `tools` names the WebMCP tools each page registers once open —
 * keep it in sync when adding or renaming a page's tools.
 *
 * `entry` distinguishes the React Router SPA from the separate
 * oui-notifier Vite entry, which needs a full page load to reach.
 */
export const TOOL_CATALOG = [
  {
    path: "/",
    entry: "spa",
    title: "Helium Tools home",
    summary: "Landing page listing every tool on the site.",
    tools: [],
  },
  {
    path: "/wallet-dashboard",
    entry: "spa",
    title: "Wallet Dashboard",
    summary:
      "Read-only overview of any Helium wallet (Solana base58 address): token balances with USD values, Hotspot fleet with locations and activity, unclaimed rewards, governance positions, and recent transactions. No wallet connection needed.",
    tools: [
      "open-wallet-dashboard",
      "get-wallet-summary",
      "get-wallet-fleet",
      "get-wallet-rewards",
      "get-wallet-transactions",
    ],
  },
  {
    path: "/hnt-price",
    entry: "spa",
    title: "HNT Price API",
    summary:
      "Public keyless HNT price API: live market price (Jupiter) plus the on-chain oracle price the Data Credits mint pays, over HTTP, WebSocket, or SSE. The page documents the API and streams a live demo.",
    tools: ["get-hnt-price-instant", "get-hnt-price-api-reference"],
  },
  {
    path: "/hotspot-claimer",
    entry: "spa",
    title: "Hotspot Reward Claimer",
    summary:
      "Look up any Hotspot by entity key or list a wallet's Hotspots, view pending IOT/MOBILE/HNT rewards, and issue permissionless, treasury-subsidized claim transactions — no wallet connection needed.",
    tools: [
      "lookup-hotspot",
      "get-hotspot-rewards",
      "claim-hotspot-rewards",
      "list-wallet-hotspots",
    ],
  },
  {
    path: "/ve-hnt",
    entry: "spa",
    title: "veHNT Positions",
    summary:
      "Analyze staked HNT (veHNT) positions for any wallet: lockup status, landrush bonus, delegation, pending rewards, and voting activity. Claiming rewards requires connecting the owning wallet in the UI.",
    tools: ["get-vehnt-positions"],
  },
  {
    path: "/vote",
    entry: "spa",
    title: "Helium Vote viewer",
    summary:
      "Live governance vote activity and outcomes for HNT/IOT/MOBILE proposals: per-choice tallies, voter roster, trend history, and per-voter timelines.",
    tools: ["list-vote-proposals", "get-vote-details", "get-voter-history", "open-vote"],
  },
  {
    path: "/votes",
    entry: "spa",
    title: "Helium Votes index",
    summary: "Index of tracked current and past governance votes.",
    tools: ["list-vote-proposals", "get-vote-details", "get-voter-history", "open-vote"],
  },
  {
    path: "/dc-mint",
    entry: "spa",
    title: "Mint Data Credits",
    summary:
      "Convert HNT to Data Credits at the on-chain oracle price, minting to a wallet or delegating directly to an OUI. Quoting and OUI resolution are open; the burn itself requires the user to sign with their Solana wallet in the UI.",
    tools: ["get-dc-mint-quote", "resolve-oui"],
  },
  {
    path: "/oui-notifier/",
    entry: "oui",
    title: "OUI Notifier",
    summary:
      "IoT network operator escrow monitoring: list all OUIs, fetch Data Credit escrow balances and burn rates, and subscribe to email alerts before an escrow runs low.",
    tools: ["list-ouis", "get-oui-balance", "prefill-alert-subscription"],
  },
  {
    path: "/iot-onboard",
    entry: "spa",
    title: "IoT Hotspot Setup",
    summary:
      "Onboard a Helium IoT Hotspot: connect over Bluetooth (requires a human at the machine), view diagnostics, configure WiFi, and register on-chain. Fee lookups and Hotspot status checks are open to agents; BLE steps are human-only.",
    tools: ["get-iot-onboard-fees"],
  },
  {
    path: "/mobile-onboard",
    entry: "spa",
    title: "Mobile WiFi Onboarding",
    summary:
      "Convert a WiFi network into a Helium Mobile data-only Hotspot: register it on-chain and retrieve RadSec certificates. Onboarding requires the user's Solana wallet; fee lookups are open to agents.",
    tools: ["get-mobile-onboard-fees", "open-mobile-onboard-tab"],
  },
  {
    path: "/update-location",
    entry: "spa",
    title: "Update Hotspot Location",
    summary:
      "Re-assert the location, elevation, or antenna gain of an onboarded IoT Hotspot. On-chain status lookups are open to agents; the assert transaction requires the owner's Solana wallet in the UI.",
    tools: ["get-hotspot-onchain-info"],
  },
  {
    path: "/multi-gateway",
    entry: "spa",
    title: "Add a Hotspot (Multi-Gateway)",
    summary:
      "Live LoRaWAN gateway dashboard: signal quality, packet activity, and connection status for the multi-gateway fleet, plus wallet-signed onboarding of new gateways.",
    tools: ["list-gateways", "select-gateway", "get-gateway-packets"],
  },
  {
    path: "/hotspot-map",
    entry: "spa",
    title: "Hotspot Map",
    summary:
      "Plot Helium IoT and Mobile Hotspot locations on an interactive map, loaded from a wallet address or a list of entity keys.",
    tools: ["map-wallet-hotspots", "map-hotspots"],
  },
  {
    path: "/brand",
    entry: "spa",
    title: "Brand Guidelines",
    summary:
      "Official Helium logo files at stable direct-link URLs under https://heliumtools.org/brand/ (Helium lockup, roundel, HeliumOS and Plus product lockups; purple/black/white; SVG and PNG; one ZIP of all 24), plus the usage rules: the symbol is always inside its circle, never rotated, and appears only in the supplied colorways. Also carries a brief palette and type (Figtree) reference from the Helium Design System. heliumtools.org is a third-party mirror; the marks belong to Nova Labs and the Helium Foundation, whose terms govern use. Static page, no wallet.",
    tools: ["list-helium-brand-assets", "get-helium-logo-guidelines"],
  },
  {
    path: "/l1-migration",
    entry: "spa",
    title: "L1 Migration",
    summary:
      "Migrate a legacy Helium L1 account to Solana by broadcasting its pre-signed migration transactions. Accepts Helium B58 or Solana base58 addresses; safe to re-run (already-migrated wallets report as such).",
    tools: ["derive-helium-addresses", "migrate-l1-wallet"],
  },
];

/**
 * The names `makeSiteTools` registers on every page. Kept here so the
 * core's DEV drift warning can build the full set of promised tool names
 * from one module.
 */
export const SITE_TOOL_NAMES = ["list-helium-tools", "open-helium-tool", "get-hnt-price"];

/** Catalog entry for a path, or null. */
export function catalogEntry(path) {
  return TOOL_CATALOG.find((t) => t.path === path) || null;
}
