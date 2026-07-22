import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import CopyButton from "../components/CopyButton.jsx";
import {
  VENDORS,
  EXTRA_GUIDES,
  RADSEC_SERVERS,
  RADSEC_SHARED_SECRET,
  NAI_REALMS,
  AP_CONSTANTS,
  SELF_SERVE_CARRIERS,
  PARTNER_CARRIERS,
} from "./vendors.js";

function CarrierBanner() {
  return (
    <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-xs text-sky-800 dark:border-sky-800/50 dark:bg-sky-950/40 dark:text-sky-200">
      Configured with the realms below, networks onboarded here serve{" "}
      {SELF_SERVE_CARRIERS.join(", ")} subscribers. To also serve{" "}
      {PARTNER_CARRIERS.names.join(", ")}, your deployment can apply to Helium Plus at{" "}
      <a href={PARTNER_CARRIERS.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
        helium.plus
      </a>.
    </div>
  );
}

function CopyRow({ label, value, copyable = true, sub = false, tag = null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className={`text-xs ${sub ? "pl-3 text-content-tertiary" : "text-content-secondary"}`}>{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-xs text-content">{value}</span>
        {tag && (
          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-content-tertiary">
            {tag}
          </span>
        )}
        {copyable && <CopyButton text={value} size="h-3.5 w-3.5" />}
      </span>
    </div>
  );
}

// Group the flat realm list by carrier so each carrier shows as one block with
// its realm(s) then domain(s), instead of repeating the carrier name per row.
const CARRIER_GROUPS = (() => {
  const order = [];
  const byCarrier = new Map();
  for (const { realm, carrier, domain } of NAI_REALMS) {
    if (!byCarrier.has(carrier)) {
      byCarrier.set(carrier, { carrier, realms: [], domains: [] });
      order.push(carrier);
    }
    const g = byCarrier.get(carrier);
    g.realms.push(realm);
    if (domain && !g.domains.includes(domain)) g.domains.push(domain);
  }
  return order.map((c) => byCarrier.get(c));
})();

/**
 * Vendor-specific guide links + the AP configuration constants every vendor
 * guide shares (RadSec servers, NAI realms, Passpoint settings). Rendered as
 * the standalone "AP Setup Guide" tab and inline in the wizard's final step.
 */
export default function VendorGuide({ compact = false }) {
  return (
    <div className="space-y-5">
      {!compact && <CarrierBanner />}

      <div>
        <h3 className="mb-2 font-display text-sm font-semibold text-content">Vendor guides</h3>
        <p className="mb-3 text-xs text-content-tertiary">
          Each guide walks through Passpoint, RadSec, and certificate installation for that platform.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {VENDORS.map((vendor) => (
            <a
              key={vendor.slug}
              href={vendor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-content transition hover:border-accent hover:text-accent-text"
            >
              <span className="truncate">{vendor.name}</span>
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0 text-content-tertiary group-hover:text-accent-text" />
            </a>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {EXTRA_GUIDES.map((guide) => (
            <a
              key={guide.url}
              href={guide.url}
              target="_blank"
              rel="noopener noreferrer"
              title={guide.description}
              className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
            >
              {guide.name} <ArrowTopRightOnSquareIcon className="h-3 w-3" />
            </a>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-display text-sm font-semibold text-content">RadSec servers</h3>
        <p className="mb-2 text-xs text-content-tertiary">
          Enter all three as both authentication and accounting servers. RADIUS over TLS, TCP.
        </p>
        <div className="rounded-lg bg-surface-inset px-3 py-1.5">
          {RADSEC_SERVERS.map((server, i) => (
            <CopyRow key={server} label={`Server ${i + 1}`} value={server} />
          ))}
        </div>
        <div className="mt-2 rounded-lg bg-surface-inset px-3 py-1.5">
          <CopyRow label="Shared secret" value={RADSEC_SHARED_SECRET} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-display text-sm font-semibold text-content">Passpoint settings</h3>

        <p className="text-xs font-medium text-content-secondary">Realms and domains</p>
        <p className="mb-2 text-xs text-content-tertiary">
          Add these for each carrier you want to serve.
        </p>
        <div className="rounded-lg bg-surface-inset px-3 py-1.5">
          {CARRIER_GROUPS.map((g, gi) => (
            <div key={g.carrier} className={gi > 0 ? "mt-1 border-t border-border pt-1" : ""}>
              <p className="py-1 text-xs font-medium text-content">{g.carrier}</p>
              {g.realms.map((r) => <CopyRow key={r} label="Realm" value={r} tag="EAP-TLS · Certificate" sub />)}
              {g.domains.map((d) => <CopyRow key={`dom-${d}`} label="Domain" value={d} sub />)}
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs font-medium text-content-secondary">Network settings</p>
        <p className="mb-2 text-xs text-content-tertiary">The same for every SSID.</p>
        <div className="rounded-lg bg-surface-inset px-3 py-1.5">
          {AP_CONSTANTS.map((row) => (
            <CopyRow key={row.label} label={row.label} value={row.value} copyable={false} />
          ))}
        </div>

        <p className="mt-2 text-xs text-content-tertiary">
          The NAS ID your AP sends must match the one on your certificate (usually the AP's MAC address).
        </p>
      </div>
    </div>
  );
}
