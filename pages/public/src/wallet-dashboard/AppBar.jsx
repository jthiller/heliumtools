import { memo, useState } from "react";
import { Link } from "react-router-dom";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";

/**
 * The sticky glass app bar, 64 px at every width: a skip link to #wd-main,
 * the brand ("Helium Tools" / "Wallet Dashboard", a link home) and, with a
 * wallet on screen, the address form (`role="search"`, labelled "Wallet
 * address"; it pushes /wallet-dashboard/<address>, so Back returns to the
 * previous wallet). Below 768 px the form folds to a 44 px "Look up another
 * wallet" link to the lookup page. On the lookup page (no wallet) neither
 * shows: the page itself is the form.
 *
 * Props: wallet (the address on screen, or null on the lookup page),
 * onSubmit(address).
 */
export default memo(function AppBar({ wallet, onSubmit }) {
  // The field follows the wallet in the URL: any switch (a submit, Back, a
  // Recent wallets link) replaces an unsent edit with the new address. The
  // last wallet is kept in state (not a ref), so the reset survives
  // StrictMode's double render.
  const [draft, setDraft] = useState({ wallet, value: wallet || "" });
  if (draft.wallet !== wallet) setDraft({ wallet, value: wallet || "" });
  const value = draft.wallet === wallet ? draft.value : wallet || "";

  return (
    <header className="sticky top-0 z-20 bg-[var(--wd-glass)] shadow-[0_1px_0_rgb(var(--wd-line))] backdrop-blur-[10px] backdrop-saturate-[1.4]">
      <a
        href="#wd-main"
        onClick={(e) => {
          const main = document.getElementById("wd-main");
          if (!main) return;
          e.preventDefault();
          main.focus();
        }}
        className="sr-only z-30 rounded-lg bg-surface-raised text-[13px] font-semibold text-accent-text shadow-soft-lg focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:inline-flex focus:h-10 focus:items-center focus:px-3.5 md:focus:left-4"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-4 md:gap-6 md:px-10">
        <a href="/" className="flex min-h-11 flex-none items-center gap-3 text-wd-ink hover:no-underline">
          <span
            aria-hidden="true"
            className="h-9 w-9 flex-none rounded-[10px] bg-accent text-center font-display text-sm font-bold leading-9 tracking-[-0.02em] text-white"
          >
            HT
          </span>
          <span className="flex flex-col">
            <span className="font-display text-[15px] font-semibold leading-[18px] tracking-[-0.01em]">Helium Tools</span>
            <span className="text-wd-cap text-wd-ink-2">Wallet Dashboard</span>
          </span>
        </a>
        {wallet && (
          <>
            <form
              role="search"
              className="m-0 hidden min-w-0 flex-[0_1_580px] items-center gap-2 md:flex"
              onSubmit={(e) => {
                e.preventDefault();
                const v = value.trim();
                if (v) onSubmit(v);
              }}
            >
              <label htmlFor="wd-address" className="sr-only">
                Wallet address
              </label>
              <div className="flex h-[38px] min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-wd-control bg-wd-well px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-text">
                <MagnifyingGlassIcon aria-hidden="true" className="h-3.5 w-3.5 flex-none text-wd-ink-3" />
                <input
                  id="wd-address"
                  type="text"
                  value={value}
                  onChange={(e) => setDraft({ wallet, value: e.target.value })}
                  placeholder="Solana wallet address"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  className="h-9 min-w-0 flex-1 text-ellipsis border-0 bg-transparent p-0 font-mono text-xs font-medium text-wd-ink placeholder:text-wd-ink-3 !outline-none focus:ring-0"
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-9 flex-none items-center rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-white transition hover:bg-accent/90"
              >
                View
              </button>
            </form>
            <Link
              to="/wallet-dashboard"
              aria-label="Look up another wallet"
              className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-[10px] border border-wd-control bg-surface-raised text-wd-ink-2 md:hidden"
            >
              <MagnifyingGlassIcon aria-hidden="true" className="h-[18px] w-[18px]" />
            </Link>
          </>
        )}
      </div>
    </header>
  );
});
