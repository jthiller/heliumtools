import CertDownloads from "./CertDownloads.jsx";
import OffchainSignWarning from "./OffchainSignWarning.jsx";
import useCertRetrieval from "./useCertRetrieval.js";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/**
 * Step 4: create the RadSec certificates — the browser equivalent of
 * `helium-wallet hotspots add mobile cert <key> --nas-id … --address …`.
 * The connected wallet signs the request offchain (signMessage); hardware
 * wallets can't, so the step feature-detects and explains. The response's
 * private key goes straight to file downloads and is never stored.
 *
 * The cert service supports a single NAS ID per Hotspot (`nas_ids` is a Vec
 * but documented "only one is supported"), so we take one and send it as a
 * one-element array.
 */
export default function CertStep({ gateway, address, nasId, onFormChange, onDone, onSkip }) {
  const { state, error, cert, busy, canSign, submit } = useCertRetrieval(gateway.b58);

  const canSubmit = address.trim() && nasId.trim() && canSign;

  const handleSubmit = () =>
    submit({ locationAddress: address.trim(), nasIds: [nasId.trim()] });

  if (state === "done" && cert) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-content-secondary">
          Certificates for <span className="font-medium text-content">{gateway.name}</span> are ready.
          Download all three. Your access point needs them for RadSec.
        </p>
        <CertDownloads cert={cert} baseName={gateway.name} />
        <button
          onClick={() => onDone(cert)}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Continue to AP setup
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-content-secondary">
        Create the RadSec certificates your access point uses to authenticate to the network. Your
        wallet signs this request, with no transaction and no fee.
      </p>

      {!canSign && (
        <OffchainSignWarning>
          Connect a software wallet (Phantom, Solflare) that owns this Hotspot to retrieve
          certificates. You can also do this later from the Manage tab.
        </OffchainSignWarning>
      )}

      <div>
        <label className="text-xs font-medium text-content-secondary">Installation address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => onFormChange({ address: e.target.value, nasId })}
          placeholder="Physical street address of the installation"
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <label className="text-xs font-medium text-content-secondary">NAS ID</label>
        <p className="mt-0.5 text-xs text-content-tertiary">
          Your access point's MAC address. It must match exactly what the AP sends in RADIUS
          requests (see your vendor guide).
        </p>
        <input
          type="text"
          value={nasId}
          onChange={(e) => onFormChange({ address, nasId: e.target.value })}
          placeholder="aa:bb:cc:dd:ee:ff"
          className="mt-1.5 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={onSkip}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-content hover:bg-surface-inset"
        >
          Later
        </button>
        <button
          onClick={handleSubmit}
          disabled={busy || !canSubmit}
          className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {state === "signing" ? "Sign in wallet…"
            : state === "requesting" ? "Creating certificates…"
            : "Sign & create certificates"}
        </button>
      </div>
    </div>
  );
}
