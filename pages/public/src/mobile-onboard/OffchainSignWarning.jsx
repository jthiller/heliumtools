/**
 * Shown when the connected wallet can't sign offchain messages (hardware
 * wallets like Ledger), which certificate retrieval requires. Pass children
 * to override the trailing call-to-action.
 */
export default function OffchainSignWarning({ children }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
      This wallet can't sign offchain messages (hardware wallets like Ledger don't support it).{" "}
      {children || "Connect a software wallet that owns this Hotspot."}
    </div>
  );
}
