import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import AgentBriefPanel from "./AgentBriefPanel.jsx";

/**
 * Final wizard step: hand the configuration off to an AI assistant.
 *
 * Generating re-fetches the Hotspot's certificate record, so this only works
 * once certificates exist. The panel names that as the recoverable cause when
 * the request is rejected — a local "did they create certs?" flag would only
 * hold on this surface, and Manage (which shows the same panel) can't know.
 */
export default function AgentBriefStep({ gateway, onBack, onFinish }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-sm font-semibold text-content">Configure with AI</h3>
        <p className="mt-1 text-sm text-content-secondary">
          Adding the Passpoint SSID is the fiddly part: NAI realms, RadSec servers, certificates,
          and a NAS ID that has to match yours exactly. Generate a link and hand it to an AI
          assistant, which will work through your controller with you.
        </p>
      </div>

      <AgentBriefPanel gateway={gateway} />

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
