import { CheckCircleIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import VendorGuide from "./VendorGuide.jsx";
import { SELF_SERVE_CARRIERS, PARTNER_CARRIERS } from "./vendors.js";

/**
 * AP setup step: the vendor configuration guide with the shared
 * RadSec/Passpoint constants inline, plus the Helium Plus "graduation"
 * invitation — earned here, after the on-chain work succeeded, framed for once
 * the deployment is validated. Continues to the final "Configure with AI" step
 * (AgentBriefStep), which is where the draft is finally deleted.
 */
export default function ConfigureStep({ gateway, onContinue }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
        <CheckCircleIcon className="h-6 w-6 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            {gateway.name} is onboarded to the Mobile network.
          </p>
          <p className="text-xs text-content-tertiary">
            Last step: configure your controller with the certificates and the settings below.
          </p>
        </div>
      </div>

      <VendorGuide compact />

      <div className="rounded-lg bg-surface-inset p-4">
        <p className="text-sm font-medium text-content">When you're ready to expand</p>
        <p className="mt-1 text-xs text-content-secondary">
          This Hotspot is set up to serve {SELF_SERVE_CARRIERS.join(", ")} subscribers. Once your
          network is live and you've validated real coverage and traffic, your deployment may be
          eligible to add {PARTNER_CARRIERS.names.join(", ")} through Helium Plus, on the same
          Hotspot, certificates, and access point configuration.
        </p>
        <a
          href={PARTNER_CARRIERS.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-content hover:bg-surface-raised"
        >
          Explore Helium Plus <ArrowTopRightOnSquareIcon className="h-4 w-4" />
        </a>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <a
          href={`/hotspot-map?keys=${gateway.b58}`}
          className="inline-flex items-center gap-1.5 text-accent-text hover:underline"
        >
          View on map <ArrowTopRightOnSquareIcon className="h-4 w-4" />
        </a>
      </div>

      <button
        onClick={onContinue}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
      >
        Continue
      </button>
    </div>
  );
}
