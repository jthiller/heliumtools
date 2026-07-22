import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TrashIcon } from "@heroicons/react/24/outline";
import { VENDORS, SELF_SERVE_CARRIERS, PARTNER_CARRIERS } from "./vendors.js";

const STEP_LABELS = {
  token: "token created",
  issued: "registered on-chain",
  onboarded: "onboarded",
  cert: "certificates issued",
};

/**
 * Wizard intro. Carrier coverage is presented as a timeline, not a gate:
 * everyone runs the same setup here (which serves the self-serve carriers),
 * and the larger carriers are added later through Helium Plus on the same
 * deployment. Plus a supported-vendor strip and resume cards for saved drafts.
 */
export default function IntroStep({ drafts, walletB58, connected, onStart, onResume, onDeleteDraft, onOpenGuide }) {
  const draftList = Object.values(drafts).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-3 font-display text-sm font-semibold text-content">Carrier coverage</h3>

        {/* A progression, not a choice: the carriers you set up here are the
            headline; Helium Plus is a quieter downstream stage on the same rail. */}
        <div className="flex flex-col">
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
              <span className="my-1 w-px grow bg-border" />
            </div>
            <div className="pb-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                Available now, in this tool
              </p>
              <p className="mt-0.5 text-sm font-medium text-content">{SELF_SERVE_CARRIERS.join(", ")}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-content-tertiary/60 bg-surface-raised" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
                Later, if eligible for Helium Plus
              </p>
              <p className="mt-0.5 text-sm text-content-secondary">{PARTNER_CARRIERS.names.join(", ")}</p>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-content-tertiary">
          Aiming for {PARTNER_CARRIERS.names.join(", ")}? Start here anyway. The Hotspot,
          certificates, and access point setup you build carry straight into Helium Plus, so you can
          validate your deployment for a couple dollars first, then apply to add those carriers.{" "}
          <a
            href={PARTNER_CARRIERS.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent-text hover:underline"
          >
            Learn more
          </a>.
        </p>
      </div>

      <div>
        <h3 className="mb-2 font-display text-sm font-semibold text-content">Supported gear</h3>
        <div className="flex flex-wrap gap-1.5">
          {VENDORS.map((v) => (
            <button
              key={v.slug}
              onClick={onOpenGuide}
              title={`Open the ${v.name} setup guide`}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-content-secondary hover:border-accent hover:text-accent-text"
            >
              {v.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-content-tertiary">
          Other Passpoint-capable gear usually works too. See the general guide in the AP Setup tab.
        </p>
      </div>

      {draftList.length > 0 && (
        <div>
          <h3 className="mb-2 font-display text-sm font-semibold text-content">Resume onboarding</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface-inset">
            {draftList.map((draft) => {
              // With no wallet connected the ownership can't be checked, so
              // resume stays disabled rather than silently allowed.
              const otherWallet = draft.wallet && walletB58 && draft.wallet !== walletB58;
              const resumable = connected && !otherWallet;
              return (
                <li key={draft.gateway} className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    onClick={() => onResume(draft)}
                    disabled={!resumable}
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                  >
                    <p className="truncate text-sm font-medium text-content">{draft.name || draft.gateway}</p>
                    <p className="text-xs text-content-tertiary">
                      {otherWallet
                        ? "Created with a different wallet"
                        : !connected
                          ? "Connect a wallet to resume"
                          : STEP_LABELS[draft.step] || "in progress"}
                    </p>
                  </button>
                  <button
                    onClick={() => onDeleteDraft(draft.gateway)}
                    title="Delete draft"
                    className="shrink-0 text-content-tertiary hover:text-rose-500"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!connected ? (
        <div className="rounded-lg bg-surface-inset p-4 text-center">
          <p className="mb-3 text-xs text-content-secondary">
            Connect the Solana wallet that will own this Hotspot.
          </p>
          <div className="flex justify-center">
            <WalletMultiButton className="!rounded-lg !text-sm" />
          </div>
        </div>
      ) : (
        <button
          onClick={onStart}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Start onboarding
        </button>
      )}
    </div>
  );
}
