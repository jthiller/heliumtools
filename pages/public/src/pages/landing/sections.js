// The landing page's tool list, as plain data (plus one pure helper at the
// end): rendered by ../Landing.jsx and read by scripts/tool-previews/bake.mjs,
// which checks the palette's neighbour rule on the order below (every card
// flows through one grid, so the order decides which cards touch). Each tool's `slug` keys its card preview
// (./previews/<slug>.js) and baked prints (src/assets/previews/<slug>/). A new
// tool needs both; see ./CLAUDE.md and scripts/tool-previews/README.md.
//
// Section: { id, title, description, tools }. `id` names the section's region
// (its h2's id). Tool: { slug, name, description, href, badge, featured?,
// disabled? }. `badge: "New"` marks the three most recently added tools only
// (today HNT Price API, Brand Guidelines and Council Emissions): a new
// tool takes it from the oldest of the three. `featured`: the card spans two grid columns wherever the grid
// has two or more (its preview config then needs a `featured` print set).
// `disabled`: shown as a plain, unfocusable "Coming Soon" card. `hidden`: left
// off the page entirely (SECTIONS below is the visible list).
//
// The order is also the layout: a featured card that reaches the end of a row
// with only one column left wraps to the next row and leaves a hole, which the
// bake reports. Add a Hotspot sits third in its section for that reason: no
// featured card wraps (every row fills at two columns; at three only the last
// row, Brand alone, is short), and the palette's neighbour rule holds at 3, 2
// and 1 columns.

const ALL_SECTIONS = [
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
        badge: null,
        featured: true,
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
        // Not fully working yet: off the landing page until it is. Its preview
        // config and prints are kept, so showing it again is deleting this line.
        hidden: true,
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
        badge: null,
      },
      {
        slug: "multi-gateway",
        name: "Add a Hotspot",
        description:
          "Add a LoRaWAN gateway to the Helium network and monitor it in real time. View signal quality, packet activity, and connection status.",
        href: "/multi-gateway",
        badge: null,
        featured: true,
      },
      {
        slug: "update-location",
        name: "Update Hotspot Location",
        description:
          "Connect your Solana wallet to re-assert the location, elevation, or antenna gain of your onboarded IoT Hotspots.",
        href: "/update-location",
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
        badge: null,
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
    // Its own section because the palette has no room for a fourth HNT Holders
    // hue: Holders' arc is full at 30° steps and every placement among them
    // touches a same-hue card or crowds Brand. Governance takes the free gap
    // between jade (166) and teal (195); its card never touches either.
    id: "governance",
    title: "Governance",
    description: "Follow Helium governance on chain",
    tools: [
      {
        slug: "council-emissions",
        name: "Council Emissions",
        description:
          "Every HNT emission to the five HIP-149 Advisory Council seats, and where that HNT went next: held, swapped, staked, or sent to an exchange.",
        href: "/council-emissions",
        badge: "New",
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

// The page's sections: hidden tools dropped, and any section left empty.
export const SECTIONS = ALL_SECTIONS.map((section) => ({
  ...section,
  tools: section.tools.filter((tool) => !tool.hidden),
})).filter((section) => section.tools.length > 0);

// Where every card lands at `cols` columns, worked out from the order above
// the way CSS grid auto-places them (row by row, never backfilling a hole): a
// featured card spans two columns when there are two or more, and wraps to the
// next row when only one is left. Returns, in order,
// { slug, section, first, row, col, span }, `section` being the section's
// index and `first` whether the card opens its section (carries its heading).
export function placeCards(cols, sections = SECTIONS) {
  const cards = [];
  let row = 0;
  let col = 0;
  sections.forEach((section, s) => {
    section.tools.forEach((tool, i) => {
      const span = tool.featured && cols > 1 ? 2 : 1;
      if (col + span > cols) {
        row += 1;
        col = 0;
      }
      cards.push({ slug: tool.slug, section: s, first: i === 0, row, col, span });
      col += span;
      if (col === cols) {
        row += 1;
        col = 0;
      }
    });
  });
  return cards;
}

// The heading row slots at `cols` columns. A row where any section starts is a
// heading row: every card in it gets a slot carrying its section's colored rule
// (landing.css), and the rules of a section's neighbouring cards join across the
// gap, so each section's run of cards in that row reads as one group. The first
// card of a section in the row is labelled: with the section heading if the
// section starts there ("head"), otherwise with a running head ("run": its own
// section's title, since the section started in an earlier row and the card
// would read as part of the next section beside it). Rows without a section
// start have no slots. Returns Map slug -> { label: "head" | "run" | null,
// join: whether its rule runs on into the next card's }.
export function headingSlots(cols, sections = SECTIONS) {
  const cards = placeCards(cols, sections);
  const headRows = new Set(cards.filter((c) => c.first).map((c) => c.row));
  const slots = new Map();
  cards.forEach((card, i) => {
    if (!headRows.has(card.row)) return;
    const prev = cards[i - 1];
    const next = cards[i + 1];
    const opensRun = !prev || prev.row !== card.row || prev.section !== card.section;
    slots.set(card.slug, {
      label: card.first ? "head" : opensRun ? "run" : null,
      join: !!next && next.row === card.row && next.section === card.section,
    });
  });
  return slots;
}

// The cards that get a running head at `cols` columns (headingSlots "run").
export function runningHeads(cols, sections = SECTIONS) {
  return new Set([...headingSlots(cols, sections)].filter(([, slot]) => slot.label === "run").map(([slug]) => slug));
}
