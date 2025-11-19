import { ArrowTopRightOnSquareIcon, BellAlertIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";

const features = [
  {
    name: "OUI Notifier",
    description:
      "Get alerts before your Data Credit escrow runs low. Lookup OUIs, fetch balances, and subscribe to email or webhook alerts.",
    href: "/oui-notifier/",
    icon: BellAlertIcon,
    badge: "Live",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-slate-100">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-slate-900">Helium Tools</h1>
              <p className="text-sm text-slate-600">
                Operator utilities to keep your network running smoothly. More tools coming soon.
              </p>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <a
                    key={feature.name}
                    href={feature.href}
                    className="group flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 transition duration-150 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:shadow-soft"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span>{feature.name}</span>
                        {feature.badge ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                            {feature.badge}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-slate-600">{feature.description}</p>
                    <div className="flex items-center gap-2 text-sm font-semibold text-indigo-600">
                      <span>Open</span>
                      <ArrowTopRightOnSquareIcon
                        className="h-4 w-4 transition group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
