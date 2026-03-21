import { ArrowRightIcon, BellAlertIcon, ArrowPathIcon, CreditCardIcon, BoltIcon, MapPinIcon, SignalIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import ShaderDithering from "../components/ShaderDithering.jsx";

const sections = [
  {
    title: "Network Operators",
    description: "Tools for IoT network OUI operators",
    tools: [
      {
        name: "OUI Notifier",
        description: "Get alerts before your Data Credit escrow runs low. Lookup OUIs, fetch balances, and subscribe to email or webhook alerts.",
        href: "/oui-notifier/",
        icon: BellAlertIcon,
        iconBg: "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",
        badge: null,
      },
      {
        name: "Buy Data Credits",
        description:
          "Resolve an OUI, check escrow balance, and purchase Data Credits via Coinbase Onramp with automatic delegation.",
        href: "/dc-purchase",
        icon: CreditCardIcon,
        iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
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
        name: "Reward Claimer",
        description:
          "Look up any Hotspot or wallet, view pending IOT, MOBILE, and HNT rewards, and issue permissionless claim transactions.",
        href: "/hotspot-claimer",
        icon: BoltIcon,
        iconBg: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
        badge: "New",
      },
      {
        name: "Hotspot Map",
        description:
          "Plot Helium IoT and Mobile Hotspot locations on an interactive map. Load by entity keys or wallet address.",
        href: "/hotspot-map",
        icon: MapPinIcon,
        iconBg: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
        badge: "New",
      },
      {
        name: "Add a Hotspot",
        description:
          "Add a LoRaWAN gateway to the Helium network and monitor it in real time. View signal quality, packet activity, and connection status.",
        href: "/multi-gateway",
        icon: SignalIcon,
        iconBg: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",
        badge: "New",
      },
      {
        name: "L1 Migration",
        description: "Migrate legacy Helium L1 accounts to Solana. Derive both addresses and seed the wallet on-chain.",
        href: "/l1-migration",
        icon: ArrowPathIcon,
        iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
        badge: null,
      },
    ],
  },
];

function ToolCard({ feature }) {
  const Icon = feature.icon;
  const Wrapper = feature.disabled ? "div" : "a";
  const wrapperProps = feature.disabled ? {} : { href: feature.href };
  return (
    <Wrapper
      {...wrapperProps}
      className={`group relative flex flex-col rounded-[14px] border p-7 gap-4 transition ${
        feature.disabled
          ? "border-border bg-surface-inset opacity-60 cursor-default"
          : "border-border bg-surface-raised hover:border-content-tertiary hover:shadow-md dark:hover:shadow-lg dark:hover:shadow-black/20"
      }`}
    >
      <div className="flex items-center gap-3.5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${
          feature.disabled
            ? "bg-surface-inset text-content-tertiary"
            : feature.iconBg
        }`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <span className={`font-display text-lg font-semibold tracking-[-0.01em] ${feature.disabled ? "text-content-tertiary" : "text-content"}`}>
          {feature.name}
        </span>
        {feature.badge && (
          feature.disabled ? (
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-content-tertiary">
              {feature.badge}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              {feature.badge}
            </span>
          )
        )}
      </div>
      <p className={`text-[15px] leading-relaxed flex-1 ${feature.disabled ? "text-content-tertiary" : "text-content-secondary"}`}>
        {feature.description}
      </p>
      {!feature.disabled && (
        <div className="flex items-center gap-1.5 text-sm font-medium text-accent-text">
          <span>Open tool</span>
          <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
      )}
    </Wrapper>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-surface">
      <Header />

      {/* Hero with dithering shader */}
      <div className="relative h-[280px] sm:h-[300px] lg:h-[328px] overflow-hidden">
        <ShaderDithering className="absolute inset-0 w-full h-full" />
        <div className="relative flex h-full flex-col justify-center gap-4 px-4 sm:px-6 lg:px-12 max-w-3xl">
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
          {sections.map((section) => (
            <div key={section.title}>
              <div className="flex items-baseline gap-3 mb-5">
                <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-content">
                  {section.title}
                </h2>
                <p className="text-sm text-content-tertiary">{section.description}</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {section.tools.map((feature) => (
                  <ToolCard key={feature.name} feature={feature} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border py-8">
        <p className="text-center text-sm text-content-tertiary">&copy; {new Date().getFullYear()} Helium Tools</p>
      </footer>
    </div>
  );
}
