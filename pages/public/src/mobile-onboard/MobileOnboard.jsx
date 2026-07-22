import { useSearchParams } from "react-router-dom";
import { WifiIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import OnboardWizard from "./OnboardWizard.jsx";
import ManageTab from "./ManageTab.jsx";
import VendorGuide from "./VendorGuide.jsx";

const TABS = [
  { key: "onboard", label: "Onboard" },
  { key: "manage", label: "Manage" },
  { key: "guide", label: "AP Setup Guide" },
];

/**
 * Mobile WiFi Onboarding — onboard self-serve converted WiFi networks as
 * Helium Mobile data-only Hotspots, manage previously onboarded networks
 * (certificates, location), and find the right vendor configuration guide.
 * Tab state lives in ?tab= so Manage and the guide are deep-linkable; the
 * guide tab works without a wallet.
 */
export default function MobileOnboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab = TABS.some((t) => t.key === rawTab) ? rawTab : "onboard";

  const setTab = (key) => {
    setSearchParams(key === "onboard" ? {} : { tab: key }, { replace: true });
  };

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Mobile WiFi Onboarding" />

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
              <WifiIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold tracking-[-0.02em] text-content">
                Mobile WiFi Onboarding
              </h1>
              <p className="text-sm text-content-tertiary">
                Convert a WiFi network into a Helium Mobile Hotspot: register it on-chain, retrieve
                RadSec certificates, and configure your access points.
              </p>
            </div>
          </div>
        </div>

        <div className="mb-5 flex gap-1 rounded-lg bg-surface-inset p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                tab === t.key
                  ? "bg-surface-raised text-content shadow-soft"
                  : "text-content-tertiary hover:text-content-secondary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "onboard" && <OnboardWizard onOpenGuide={() => setTab("guide")} />}
        {tab === "manage" && <ManageTab />}
        {tab === "guide" && (
          <div className="rounded-2xl bg-surface-raised p-5 shadow-soft">
            <VendorGuide />
          </div>
        )}
      </main>
    </div>
  );
}
