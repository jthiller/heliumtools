import { ArrowRightIcon, BellAlertIcon, ArrowPathIcon, BanknotesIcon, BoltIcon, MapPinIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";

const sections = [
  {
    title: "Network Operators",
    description: "Tools for IoT network and OUI operators.",
    tools: [
      {
        name: "OUI Notifier",
        description: "Get alerts before your Data Credit escrow runs low. Lookup OUIs, fetch balances, and subscribe to email or webhook alerts.",
        href: "/oui-notifier/",
        icon: BellAlertIcon,
        badge: null,
      },
      {
        name: "Buy Data Credits",
        description:
          "Resolve an OUI, check escrow balance, and purchase Data Credits via Coinbase Onramp with automatic delegation to the payer key.",
        href: "/dc-purchase",
        icon: BanknotesIcon,
        badge: "Coming Soon",
        disabled: true,
      },
    ],
  },
  {
    title: "Hotspot Operators",
    description: "Tools for Hotspot owners and operators.",
    tools: [
      {
        name: "Hotspot Reward Claimer",
        description:
          "Look up any Hotspot or wallet, view pending IOT, MOBILE, and HNT rewards, and issue claim transactions to the designated recipient.",
        href: "/hotspot-claimer",
        icon: BoltIcon,
        badge: "New",
      },
      {
        name: "Hotspot Map",
        description:
          "Plot Helium IoT and Mobile hotspot locations on an interactive map. Search by entity keys or wallet address.",
        href: "/hotspot-map",
        icon: MapPinIcon,
        badge: "New",
      },
      {
        name: "L1 Migration Tool",
        description: "Migrate legacy Helium L1 accounts to Solana. For accounts that may not have been accessed after April 2023.",
        href: "/l1-migration",
        icon: ArrowPathIcon,
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
      className={`group relative flex flex-col rounded-xl border p-6 transition ${
        feature.disabled
          ? "border-slate-200 bg-slate-50 opacity-60 cursor-default"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
      }`}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${
          feature.disabled
            ? "bg-slate-100 text-slate-400"
            : "bg-slate-100 text-slate-700 group-hover:bg-slate-900 group-hover:text-white"
        }`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-base font-semibold ${feature.disabled ? "text-slate-400" : "text-slate-900"}`}>{feature.name}</span>
          {feature.badge && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
              feature.disabled
                ? "bg-slate-100 text-slate-500 ring-slate-200"
                : "bg-emerald-50 text-emerald-700 ring-emerald-100"
            }`}>
              {feature.badge}
            </span>
          )}
        </div>
      </div>
      <p className={`text-sm leading-relaxed flex-1 ${feature.disabled ? "text-slate-400" : "text-slate-600"}`}>{feature.description}</p>
      {!feature.disabled && (
        <div className="mt-4 flex items-center gap-1 text-sm font-medium text-sky-600 group-hover:text-sky-500">
          <span>Open tool</span>
          <ArrowRightIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
      )}
    </Wrapper>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <Header />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Page Header */}
        <div className="mb-12">
          <p className="text-sm font-mono uppercase tracking-widest text-sky-600 mb-2">
            Helium Tools
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
            Operator Utilities
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl">
            Tools to keep Helium running smoothly. More coming soon.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-12">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
                <p className="text-sm text-slate-500">{section.description}</p>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {section.tools.map((feature) => (
                  <ToolCard key={feature.name} feature={feature} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
