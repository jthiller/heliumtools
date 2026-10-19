import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { readRecentWallets, forgetWallet, clearRecentWallets, isRecentWalletsKey } from "./recentWallets.js";
import { plural, shortAddress } from "./format.js";
import { StatusMark, TimeAgo } from "./ui/index.js";

/** Wallets this browser looked up before, newest first (recentWallets.js). */
function RecentWallets({ onEmptied }) {
  const [list, setList] = useState(readRecentWallets);
  const [announcement, setAnnouncement] = useState("");
  const removeButtons = useRef(new Map());
  // Another tab viewing or removing a wallet updates this list too.
  useEffect(() => {
    const onStorage = (e) => isRecentWalletsKey(e.key) && setList(readRecentWallets());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // The removed row's button goes away with it, so focus moves to the row that
  // takes its place (or the one above), or to the address field once nothing
  // is left. The neighbour's button is already in the DOM.
  const remove = (address, short) => {
    const index = list.findIndex((e) => e.address === address);
    const rest = forgetWallet(address);
    setList(rest);
    setAnnouncement(`Removed ${short} from recent wallets.`);
    const next = rest[index] ?? rest[index - 1];
    if (next) removeButtons.current.get(next.address)?.focus();
    else onEmptied?.();
  };
  const clear = () => {
    clearRecentWallets();
    setList([]);
    setAnnouncement("Cleared recent wallets.");
    onEmptied?.();
  };

  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {list.length > 0 && (
        <section aria-labelledby="wd-recent-heading" className="mt-[18px] flex flex-col md:mt-[26px]">
          <div className="flex min-h-11 items-center justify-between gap-3 md:min-h-8">
            <h2
              id="wd-recent-heading"
              tabIndex={-1}
              className="m-0 font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-2 outline-none"
            >
              Recent wallets
            </h2>
            <button
              type="button"
              onClick={clear}
              aria-label="Clear recent wallets"
              className="-mr-3 h-11 min-w-11 flex-none cursor-pointer rounded-md border-0 bg-transparent px-3 text-[13px] font-medium text-accent-text hover:underline md:-mr-2 md:h-8 md:min-w-0 md:px-2"
            >
              Clear
            </button>
          </div>
          <ul className="m-0 mt-2 list-none overflow-hidden rounded-2xl bg-surface-raised p-0 shadow-soft">
            {list.map(({ address, viewedAt, hotspots }) => {
              const short = shortAddress(address);
              return (
                <li key={address} className="flex min-h-[60px] items-center border-t border-wd-line-2 first:border-t-0">
                  <Link
                    to={`/wallet-dashboard/${address}`}
                    className="flex min-h-[60px] min-w-0 flex-1 flex-col justify-center gap-0.5 py-2.5 pl-4 pr-3 text-wd-ink hover:bg-wd-well hover:no-underline focus-visible:!rounded-none focus-visible:!-outline-offset-2 md:pr-4"
                  >
                    <span className="block truncate font-mono text-sm font-medium text-wd-ink">{short}</span>
                    <span className="block text-wd-cap text-wd-ink-2">
                      {hotspots != null && `${plural(hotspots, "Hotspot")} · `}
                      Viewed <TimeAgo at={viewedAt} fallback="at an unknown time" />
                    </span>
                  </Link>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) removeButtons.current.set(address, el);
                      else removeButtons.current.delete(address);
                    }}
                    onClick={() => remove(address, short)}
                    aria-label={`Remove ${short} from recent wallets`}
                    className="mr-1 inline-flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-wd-ink-2 hover:bg-wd-well hover:text-wd-ink md:mr-2 md:h-9 md:w-9"
                  >
                    <XMarkIcon aria-hidden="true" className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="m-0 mt-2 text-wd-cap text-wd-ink-2">Saved in this browser only.</p>
        </section>
      )}
    </>
  );
}

/**
 * The page with no wallet in the route: the address form (its label
 * visible, autofocused) and Recent wallets. An address in the route that
 * isn't a Solana wallet address renders this page with the address in the
 * field and the error (`role="alert"`) saying how to fix it; no data loads.
 * Submitting trims the value and opens /wallet-dashboard/<address>.
 *
 * Props: value (the invalid address to prefill, or null), invalid (boolean),
 * onSubmit(address).
 */
export default memo(function LookupPage({ value, invalid, onSubmit }) {
  // Another route (a different invalid deep link, or none) prefills its own
  // value over an unsent edit.
  const [draft, setDraft] = useState({ value, text: value || "" });
  if (draft.value !== value) setDraft({ value, text: value || "" });
  const text = draft.value === value ? draft.text : value || "";
  const inputRef = useRef(null);

  return (
    <main
      id="wd-main"
      tabIndex={-1}
      className="flex min-h-[calc(100vh-var(--wd-appbar-h))] items-start justify-center px-4 pb-16 pt-10 outline-none md:items-center md:px-10 md:pb-[120px] md:pt-[72px]"
    >
      <div className="flex w-full max-w-[640px] flex-col gap-3.5">
        <span className="font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-3">Read-only overview</span>
        <h1 className="m-0 font-display text-[30px] font-semibold leading-9 tracking-[-0.03em] text-wd-ink md:text-[40px] md:leading-[46px]">
          Look up any Helium wallet.
        </h1>
        <p className="m-0 max-w-[560px] text-[15px] leading-[22px] text-wd-ink-2 md:text-base md:leading-6">
          See unclaimed rewards, daily earnings and token balances, with every IoT and Mobile Hotspot on one map and in one exportable list,
          plus veHNT and recent activity.
        </p>
        <form
          role="search"
          className="m-0 mt-3.5 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = text.trim();
            if (v) onSubmit(v);
          }}
        >
          <label htmlFor="wd-lookup" className="text-[13px] font-semibold leading-[18px] text-wd-ink">
            Wallet address
          </label>
          {invalid && (
            <p id="wd-lookup-error" role="alert" className="m-0 flex items-start gap-2.5 rounded-[10px] bg-wd-critical-surface px-3.5 py-3 text-sm text-wd-ink">
              <StatusMark tier="serious" sr={false} className="mt-1" />
              <span>
                <span className="font-semibold text-wd-critical-text">That isn&apos;t a Solana wallet address.</span> Paste a 32 to 44
                character base58 address.
              </span>
            </p>
          )}
          <div className="flex flex-col items-stretch gap-2 md:flex-row">
            <div
              className={`flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border bg-surface-raised px-3.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-text ${
                invalid ? "border-wd-critical shadow-[inset_0_0_0_1px_rgb(var(--wd-critical))]" : "border-wd-control"
              }`}
            >
              <MagnifyingGlassIcon aria-hidden="true" className="h-4 w-4 flex-none text-wd-ink-3" />
              <input
                id="wd-lookup"
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => setDraft({ value, text: e.target.value })}
                placeholder="Solana wallet address"
                aria-invalid={invalid ? "true" : "false"}
                aria-describedby={invalid ? "wd-lookup-error wd-lookup-hint" : "wd-lookup-hint"}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                className="h-11 min-w-0 flex-1 text-ellipsis border-0 bg-transparent p-0 font-mono text-base font-medium text-wd-ink placeholder:text-wd-ink-3 !outline-none focus:ring-0 md:text-sm"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-12 w-full flex-none items-center justify-center rounded-[10px] bg-accent px-[22px] text-sm font-semibold text-white transition hover:bg-accent/90 md:w-auto"
            >
              View
            </button>
          </div>
          <p id="wd-lookup-hint" className="m-0 text-[13px] leading-[18px] text-wd-ink-2">
            Any Solana wallet address. Nothing to connect or sign.
          </p>
        </form>
        <RecentWallets onEmptied={() => inputRef.current?.focus()} />
      </div>
    </main>
  );
});
