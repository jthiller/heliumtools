import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, SparklesIcon } from "@heroicons/react/24/outline";
import CopyButton from "../components/CopyButton.jsx";
import { createAgentBrief } from "../lib/mobileOnboardApi.js";
import { formatDuration } from "../lib/utils.js";
import { VENDORS } from "./vendors.js";
import { buildPrompt, buildDeepLinks, buildCliCommand } from "./agentPrompt.js";
import OffchainSignWarning from "./OffchainSignWarning.jsx";
import useSignedHotspotRequest from "./useSignedHotspotRequest.js";

const SELECT_CLASS =
  "mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-content focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/** "in 1h 58m" / "in 12m" / "expired" */
function useCountdown(expiresAtSeconds) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAtSeconds) return undefined;
    // Re-baseline immediately: `now` was seeded at panel mount, which can be
    // long before the links were minted, so the first render would otherwise
    // overstate the remaining time.
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [expiresAtSeconds]);

  if (!expiresAtSeconds) return null;
  const secondsLeft = expiresAtSeconds - Math.floor(now / 1000);
  return secondsLeft <= 0 ? "expired" : `in ${formatDuration(secondsLeft)}`;
}

function LinkRow({ label, url, expiryLabel, note }) {
  const expired = expiryLabel === "expired";
  return (
    <div className="rounded-lg bg-surface-inset p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-content-secondary">{label}</span>
        <span className={`text-[11px] ${expired ? "text-rose-500" : "text-content-tertiary"}`}>
          {expired ? "Expired, regenerate below" : `Expires ${expiryLabel}`}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className={`min-w-0 flex-1 truncate font-mono text-[11px] ${expired ? "text-content-tertiary line-through" : "text-content"}`}>
          {url}
        </span>
        <CopyButton text={url} size="h-3.5 w-3.5" />
      </div>
      {note && <p className="mt-1 text-[11px] text-content-tertiary">{note}</p>}
    </div>
  );
}

/**
 * "Configure with AI": mints a short-lived brief link the operator hands to an
 * LLM or coding agent, which then configures their controller with them.
 *
 * Shared by the wizard's final step and the Manage detail view. Generation is
 * wallet-signed (the same signature the certificate flow uses), which is also
 * what proves ownership to the worker.
 */
export default function AgentBriefPanel({ gateway }) {
  const [vendor, setVendor] = useState("");

  // Same signed payload the certificate flow sends — no address/NAS fields,
  // because this re-fetches the existing certificate record and the worker
  // reads the authoritative NAS ID from that response.
  const createBrief = useCallback(
    (payload) => createAgentBrief({ ...payload, vendor }),
    [vendor],
  );
  const { state, error, result, busy, canSign, submit } = useSignedHotspotRequest(
    gateway.b58,
    createBrief,
  );

  const briefCountdown = useCountdown(result?.briefExpiresAt);
  const certCountdown = useCountdown(result?.certExpiresAt);

  const deepLinks = useMemo(
    () => (result ? buildDeepLinks(result.briefUrl, gateway.name) : []),
    [result, gateway.name],
  );
  const cliCommand = useMemo(
    () => (result ? buildCliCommand(result.briefUrl, gateway.name) : ""),
    [result, gateway.name],
  );

  return (
    <div className="space-y-3">
      {!canSign && (
        <OffchainSignWarning>
          Connect a software wallet that owns this Hotspot to generate a link.
        </OffchainSignWarning>
      )}

      {!result && (
        <div>
          <label className="text-xs font-medium text-content-secondary" htmlFor="agent-vendor">
            Your controller platform
          </label>
          <select
            id="agent-vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            disabled={busy}
            className={SELECT_CLASS}
          >
            <option value="">Select a platform…</option>
            {VENDORS.map((v) => (
              <option key={v.slug} value={v.slug}>{v.name}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-content-tertiary">
            The brief points the assistant at this platform's official Helium guide. Generating a
            link stores your certificate bundle, including the private key, until the assistant
            fetches it once or two hours pass.
          </p>
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-500">
          <p>{error}</p>
          {/* The brief is built from this Hotspot's certificate record, and
              Nova answers "no record" and "wrong wallet" with the same
              rejection, so name the recoverable cause rather than guessing. */}
          <p className="mt-1 text-[11px] text-content-tertiary">
            The brief is built from this Hotspot's certificate record. If you skipped the
            certificate step, create certificates for it first.
          </p>
        </div>
      )}

      {result ? (
        <div className="space-y-3">
          <LinkRow
            label="Setup brief"
            url={result.briefUrl}
            expiryLabel={briefCountdown}
            note="Give this link to your assistant. Treat it as a secret: it carries your NAS ID and address, and it links to the certificate below, so anyone with it can reach your private key until that link is used."
          />
          <LinkRow
            label="Certificate bundle"
            url={result.certUrl}
            expiryLabel={certCountdown}
            note="Single use, fetched by the assistant. Includes your RadSec private key."
          />

          <div className="flex flex-wrap items-center gap-2">
            {deepLinks.map((l) => (
              <a
                key={l.key}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white"
              >
                {l.label} <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-content">
              Terminal agent <CopyButton text={cliCommand} size="h-3.5 w-3.5" />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-content">
              Copy prompt <CopyButton text={buildPrompt(result.briefUrl, gateway.name)} size="h-3.5 w-3.5" />
            </span>
          </div>

          {/* Regenerating must actually revoke: the create endpoint deletes
              this Hotspot's prior artifacts server-side, so re-running it is
              what makes the old links dead. Clearing local state alone would
              leave them live and the copy below would be false. */}
          <button
            onClick={() => submit()}
            disabled={busy || !canSign}
            className="inline-flex items-center gap-1.5 text-xs text-content-tertiary hover:text-content-secondary disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            {state === "signing" ? "Sign in wallet…" : busy ? "Regenerating…" : "Regenerate links"}
          </button>

          <p className="text-[11px] leading-relaxed text-content-tertiary">
            Regenerating invalidates the links above. Your assistant will change settings on a live
            network, so review what it proposes before approving. Anything it reads, including your
            certificate, enters that AI provider's systems under their retention policy. To generate
            these links heliumtools stores your certificate bundle, including the private key, until
            it is fetched once or the window above passes.
          </p>
        </div>
      ) : (
        <button
          onClick={() => submit()}
          disabled={busy || !vendor || !canSign}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <SparklesIcon className="h-4 w-4" />
          {state === "signing" ? "Sign in wallet…" : busy ? "Preparing…" : "Generate agent link"}
        </button>
      )}
    </div>
  );
}
