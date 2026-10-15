import Header from "../components/Header.jsx";
import ShaderDithering from "../components/ShaderDithering.jsx";
import ToolPreview from "./landing/ToolPreview.jsx";
import { PREVIEWS } from "./landing/previews/index.js";
import { TONES } from "./landing/previews/tones.js";
import "./landing/landing.css";

// Each tool's `slug` keys its card preview (./landing/previews/<slug>.js) and
// baked prints (src/assets/previews/<slug>/). A new tool needs both; see
// ./landing/CLAUDE.md and scripts/tool-previews/README.md.

const sections = [
  {
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

// Tone tokens for both themes ride on the card as custom properties;
// landing.css picks the pair that matches prefers-color-scheme.
function toneStyle(tone) {
  const style = {};
  for (const [theme, prefix] of [["light", "--l-"], ["dark", "--d-"]]) {
    for (const [key, value] of Object.entries(tone[theme])) style[`${prefix}${key}`] = value;
  }
  return style;
}

// A tool without a preview config still gets a card (an empty stone ground)
// rather than taking the whole page down.
const NO_PREVIEW = { tone: TONES.network[2], prints: [] };
function previewFor(slug) {
  const preview = PREVIEWS[slug];
  if (!preview && import.meta.env.DEV) {
    console.warn(`[landing] no preview config for "${slug}"; add landing/previews/${slug}.js and register it in previews/index.js`);
  }
  return preview ?? NO_PREVIEW;
}

// The whole card is the link (no separate CTA); its accessible name is the
// <h3> (name + badge), the description is its description. The disabled
// Coming-soon card is a plain, unfocusable block. `wide`: the only tool in its
// section, so the card takes the whole row (landscape once the row is wide
// enough) when its preview has a wide composition. `eager`: in the first
// viewport, so its prints aren't lazy-loaded.
function ToolCard({ feature, wide, eager }) {
  const preview = previewFor(feature.slug);
  const isWide = wide && Boolean(preview.wide);
  const nameId = `tool-${feature.slug}-name`;
  const descId = `tool-${feature.slug}-desc`;
  // The badge rides on the name's last word, so a wrapped name never strands it.
  const words = feature.name.split(" ");
  const last = words.pop();
  const body = (
    <>
      <div className="tc-text">
        <h3 id={nameId} className="tc-name font-display">
          {words.length > 0 && `${words.join(" ")} `}
          <span className="tc-nowrap">
            {last}
            {feature.badge && (
              <>
                {" "}
                <span className="tc-badge font-mono">{feature.badge}</span>
              </>
            )}
          </span>
        </h3>
        <p id={descId} className="tc-desc font-sans">
          {feature.description}
        </p>
      </div>
      <ToolPreview slug={feature.slug} prints={preview.prints} wide={isWide ? preview.wide : null} eager={eager} />
    </>
  );
  const common = { "data-tool": feature.slug, style: toneStyle(preview.tone) };
  const className = `tool-card${isWide ? " is-wide" : ""}`;
  if (feature.disabled) {
    return (
      <div {...common} className={`${className} is-disabled`}>
        {body}
      </div>
    );
  }
  return (
    <a
      {...common}
      href={feature.href}
      className={className}
      aria-labelledby={nameId}
      aria-describedby={descId}
    >
      {body}
    </a>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface">
      <Header />

      {/* Hero with dithering shader */}
      <div className="relative h-[280px] sm:h-[300px] lg:h-[328px] overflow-hidden">
        <ShaderDithering className="absolute inset-0 w-full h-full" />
        <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-center gap-4 px-4 sm:px-6 lg:px-12">
          <p className="font-mono text-[13px] font-medium uppercase tracking-[0.08em] text-cyan-300">
            Open-source operator tools
          </p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-[52px] font-bold text-white tracking-[-0.03em] leading-[1.08]">
            Keep Helium running&nbsp;smoothly.
          </h1>
          <p className="text-lg text-white/90 max-w-lg leading-7">
            Monitor escrow balances, claim rewards, map your Hotspot fleet, and
            migrate legacy wallets. Free, open-source, no login required.
          </p>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-12 pt-10 pb-16">
        <div className="space-y-12">
          {sections.map((section, sectionIndex) => (
            <div key={section.title}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-5">
                <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-content">
                  {section.title}
                </h2>
                <p className="text-sm text-content-tertiary">{section.description}</p>
              </div>
              <div className="tc-grid">
                {section.tools.map((feature) => (
                  <ToolCard
                    key={feature.slug}
                    feature={feature}
                    wide={section.tools.length === 1}
                    eager={sectionIndex === 0}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border py-8">
        <p className="text-center text-sm text-content-tertiary">&copy; {new Date().getFullYear()} Helium Tools</p>
        <p className="mt-1.5 text-center text-xs text-content-tertiary">
          Agent-ready — every tool exposes <a href="https://webmachinelearning.github.io/webmcp/" target="_blank" rel="noopener noreferrer" className="underline hover:text-content-secondary">WebMCP</a> actions to AI agents in supporting browsers.
        </p>
      </footer>
    </div>
  );
}
