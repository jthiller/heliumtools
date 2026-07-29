import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import AgentBriefPanel from "./AgentBriefPanel.jsx";

/**
 * Final wizard step: hand the configuration off to an AI assistant.
 *
 * Requires certificates to exist — generating re-fetches the Hotspot's
 * certificate record, so an operator who chose "Later" on the certificate step
 * would otherwise hit an opaque rejection from the certificate service.
 */
export default function AgentBriefStep({ gateway, certsCreated, onBack, onFinish }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-sm font-semibold text-content">Configure with AI</h3>
        <p className="mt-1 text-sm text-content-secondary">
          Setting up the access point is the fiddly part: Passpoint realms, RadSec servers, and a
          NAS ID that has to match your certificate exactly. Generate a link and hand it to an AI
          assistant, which will work through it with you.
        </p>
      </div>

      {certsCreated ? (
        <AgentBriefPanel gateway={gateway} compact />
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
          This needs your RadSec certificates, which you skipped earlier. Create them from the
          Manage tab (you'll need your installation address and NAS ID), then come back and generate
          a link there.
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <a
          href={`/hotspot-map?keys=${gateway.b58}`}
          className="inline-flex items-center gap-1.5 text-accent-text hover:underline"
        >
          View on map <ArrowTopRightOnSquareIcon className="h-4 w-4" />
        </a>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-content hover:bg-surface-inset"
        >
          Back to AP setup
        </button>
        <button
          onClick={onFinish}
          className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Done
        </button>
      </div>
    </div>
  );
}
