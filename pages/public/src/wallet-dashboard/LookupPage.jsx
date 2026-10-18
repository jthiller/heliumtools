import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { readRecentWallets, forgetWallet, clearRecentWallets, isRecentWalletsKey } from "./recentWallets.js";
import { fmtAgo, plural, shortAddress } from "./format.js";

/**
 * The page with no wallet in the route: the address form and Recent wallets,
 * or, for an address that isn't valid, the form prefilled with it and the
 * error. STUB (U0a): the old lookup screen on the dashboard's tokens; U6
 * replaces it with WdLookup (recentWallets.js unchanged).
 *
 * Props: value (the invalid address to prefill, or null), invalid (boolean),
 * onSubmit(address).
 */
export default function LookupPage({ value, invalid, onSubmit }) {
  const [text, setText] = useState(value || "");
  const [list, setList] = useState(readRecentWallets);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef(null);
  useEffect(() => setText(value || ""), [value]);
  useEffect(() => {
    const onStorage = (e) => isRecentWalletsKey(e.key) && setList(readRecentWallets());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <main id="wd-main" className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="m-0 font-display text-3xl font-bold tracking-[-0.03em]">Look up any Helium wallet.</h1>
      {invalid && (
        <p role="alert" className="mt-4 rounded-lg bg-wd-critical-surface px-3 py-2 text-wd-sm text-wd-critical-text">
          That doesn&apos;t look like a valid Solana wallet address.
        </p>
      )}
      <form
        role="search"
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = text.trim();
          if (v) onSubmit(v);
        }}
      >
        <label htmlFor="wd-lookup" className="sr-only">
          Wallet address
        </label>
        <input
          id="wd-lookup"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          spellCheck={false}
          placeholder="Solana wallet address"
          className="h-11 min-w-0 flex-1 rounded-lg border border-wd-control bg-surface-raised px-3 font-mono text-sm"
        />
        <button type="submit" className="h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white">
          View
        </button>
      </form>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {list.length > 0 && (
        <section aria-labelledby="wd-recent-heading" className="mt-10">
          <div className="flex items-baseline justify-between">
            <h2 id="wd-recent-heading" className="font-mono text-wd-eyebrow uppercase text-wd-ink-2">
              Recent wallets
            </h2>
            <button
              type="button"
              className="text-xs font-medium text-accent-text hover:underline"
              onClick={() => {
                clearRecentWallets();
                setList([]);
                setAnnouncement("Cleared recent wallets.");
                inputRef.current?.focus();
              }}
            >
              Clear all
            </button>
          </div>
          <ul className="mt-2 list-none divide-y divide-wd-line-2 rounded-xl bg-surface-raised p-0 shadow-soft">
            {list.map(({ address, viewedAt, hotspots }) => {
              const short = shortAddress(address);
              return (
                <li key={address} className="flex items-center">
                  <Link to={`/wallet-dashboard/${address}`} className="flex min-w-0 flex-1 flex-col px-4 py-3">
                    <span className="truncate font-mono text-sm text-wd-ink">{short}</span>
                    <span className="text-xs text-wd-ink-2">
                      {hotspots != null && `${plural(hotspots, "Hotspot")} · `}Viewed {fmtAgo(viewedAt)}
                    </span>
                  </Link>
                  <button
                    type="button"
                    aria-label={`Remove ${short} from recent wallets`}
                    className="mr-1 flex h-11 w-11 items-center justify-center rounded-lg text-wd-ink-2"
                    onClick={() => {
                      const rest = forgetWallet(address);
                      setList(rest);
                      setAnnouncement(`Removed ${short} from recent wallets.`);
                      if (!rest.length) inputRef.current?.focus();
                    }}
                  >
                    <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-wd-ink-2">Saved in this browser only.</p>
        </section>
      )}
    </main>
  );
}
