// The landing page's tool list, as plain data (plus one pure helper at the
// end): rendered by ../Landing.jsx and read by scripts/tool-previews/bake.mjs,
// which checks the palette's neighbour rule on the order below (every card
// flows through one grid, so the order decides which cards touch). Each tool's `slug` keys its card preview
// (./previews/<slug>.js) and baked prints (src/assets/previews/<slug>/). A new
// tool needs both; see ./CLAUDE.md and scripts/tool-previews/README.md.
//
// Section: { id, title, description, tools }. `id` names the section's region
// (its h2's id). Tool: { slug, name, description, href, badge, disabled? }.
// `disabled`: shown as a plain, unfocusable "Coming Soon" card.

export const SECTIONS = [
  {
    id: "wallet",
    title: "Wallet",
    description: "A full overview of any wallet",
    tools: [
      {
        slug: "wallet-dashboard",
        name: "Wallet Dashboard",
        description:
          "Read-only overview for any wallet: fleet map, token balances, unclaimed rewards, governance, recent activity, and an exportable Hotspot list.",
        href: "/wallet-dashboard",
        badge: "New",
      },
    ],
  },
  {
    id: "network-operators",
    title: "Network Operators",
    description: "Tools for IoT network OUI operators",
    tools: [
      {
        slug: "oui-notifier",
        name: "OUI Notifier",
        description: "Get alerts before your Data Credit escrow runs low. Lookup OUIs, fetch balances, and subscribe to email or webhook alerts.",
        href: "/oui-notifier/",
        badge: null,
      },
      {
        slug: "dc-mint",
        name: "Mint Data Credits",
        description:
          "Convert HNT to Data Credits using your Solana wallet. Mint to your wallet or delegate directly to an OUI.",
        href: "/dc-mint",
        badge: null,
      },
      {
        slug: "dc-purchase",
        name: "Buy Data Credits",
        description:
          "Resolve an OUI, check escrow balance, and purchase Data Credits via Coinbase Onramp with automatic delegation.",
        href: "/dc-purchase",
        badge: "Coming Soon",
        disabled: true,
      },
    ],
  },
  {
    id: "hotspot-operators",
    title: "Hotspot Operators",
    description: "Tools for Hotspot owners and operators",
    tools: [
      {
        slug: "iot-onboard",
        name: "IoT Hotspot Setup",
        description:
          "Connect to a Helium IoT Hotspot over Bluetooth. View diagnostics, configure WiFi, and onboard your Hotspot to the IoT network.",
        href: "/iot-onboard",
        badge: null,
      },
      {
        slug: "mobile-onboard",
        name: "Mobile WiFi Onboarding",
        description:
          "Convert a WiFi network into a Helium Mobile Hotspot. Register it on-chain, retrieve RadSec certificates, and manage onboarded networks.",
        href: "/mobile-onboard",
        badge: "New",
      },
      {
        slug: "update-location",
        name: "Update Hotspot Location",
        description:
          "Connect your Solana wallet to re-assert the location, elevation, or antenna gain of your onboarded IoT Hotspots.",
        href: "/update-location",
        badge: "New",
      },
      {
        slug: "multi-gateway",
        name: "Add a Hotspot",
        description:
          "Add a LoRaWAN gateway to the Helium network and monitor it in real time. View signal quality, packet activity, and connection status.",
        href: "/multi-gateway",
        badge: null,
      },
      {
        slug: "hotspot-claimer",
        name: "Reward Claimer",
        description:
          "Look up any Hotspot or wallet, view pending IOT, MOBILE, and HNT rewards, and issue permissionless claim transactions.",
        href: "/hotspot-claimer",
        badge: null,
      },
      {
        slug: "hotspot-map",
        name: "Hotspot Map",
        description:
          "Plot Helium IoT and Mobile Hotspot locations on an interactive map. Load by entity keys or wallet address.",
        href: "/hotspot-map",
        badge: null,
      },
    ],
  },
  {
    id: "hnt-holders",
    title: "HNT Holders",
    description: "Tools for HNT stakers, voters, and integrators",
    tools: [
      {
        slug: "hnt-price",
        name: "HNT Price API",
        description:
          "A public, keyless price API. Live market price plus the on-chain oracle price the Data Credits mint pays, over HTTP, WebSocket, or SSE.",
        href: "/hnt-price",
        badge: "New",
      },
      {
        slug: "ve-hnt",
        name: "veHNT Positions",
        description:
          "Analyze staked HNT positions on any wallet: lockup status, landrush bonus, delegation, pending rewards, and voting activity.",
        href: "/ve-hnt",
        badge: "New",
      },
      {
        slug: "l1-migration",
        name: "L1 Migration",
        description: "Migrate legacy Helium L1 accounts to Solana. Derive both addresses and seed the wallet on-chain.",
        href: "/l1-migration",
        badge: null,
      },
    ],
  },
  {
    id: "brand",
    title: "Brand",
    description: "Logos and usage rules for the Helium marks",
    tools: [
      {
        slug: "brand",
        name: "Brand Guidelines",
        description:
          "The official Helium, HeliumOS, and Plus logos in SVG and PNG at stable direct-link URLs, with the rules for using the roundel correctly.",
        href: "/brand",
        badge: "New",
      },
    ],
  },
];

// Grid positions are fixed for each column count, so they can be worked out
// from the order above. A card is "stranded" at `cols` columns when it lands
// in a row where a later section's heading starts while its own section's
// heading sits in an earlier row: its heading slot would be empty beside the
// next section's heading. ../Landing.jsx gives each stranded card a running
// head (its own section's title) at that column count, and the bake lists
// them. Returns the stranded tools' slugs.
export function strandedSlugs(cols, sections = SECTIONS) {
  const cells = [];
  const headRows = new Set();
  for (const section of sections) {
    const startRow = Math.floor(cells.length / cols);
    headRows.add(startRow);
    for (const tool of section.tools) cells.push({ slug: tool.slug, startRow });
  }
  return new Set(
    cells.filter(({ startRow }, i) => {
      const row = Math.floor(i / cols);
      return row > startRow && headRows.has(row);
    }).map((c) => c.slug),
  );
}
