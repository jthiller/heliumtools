import { ArrowRightIcon, BellAlertIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";

const features = [
  {
    name: "OUI Notifier",
    description: "Get alerts before your Data Credit escrow runs low. Lookup OUIs, fetch balances, and subscribe to email or webhook alerts.",
    href: "/oui-notifier/",
    icon: BellAlertIcon,
    badge: "New",
  },
  {
    name: "L1 Migration Tool",
    description: "Migrate legacy Helium L1 accounts to Solana. For accounts that may not have been accessed after April 2023.",
    href: "/l1-migration",
    icon: ArrowPathIcon,
    badge: null,
  },
];

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

        {/* Feature Grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <a
                key={feature.name}
                href={feature.href}
                className="group relative flex flex-col rounded-xl border border-slate-200 bg-white p-6 transition hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:bg-slate-900 group-hover:text-white transition">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-slate-900">{feature.name}</span>
                    {feature.badge && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
                        {feature.badge}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed flex-1">{feature.description}</p>
                <div className="mt-4 flex items-center gap-1 text-sm font-medium text-sky-600 group-hover:text-sky-500">
                  <span>Open tool</span>
                  <ArrowRightIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </div>
              </a>
            );
          })}
        </div>
      </main>
    </div>
  );
}
