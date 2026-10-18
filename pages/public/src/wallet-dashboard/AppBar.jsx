import { useEffect, useState } from "react";

/**
 * The sticky app bar: brand, skip link to #wd-main and, with a wallet on
 * screen, the address form. STUB (U0a): the old header, restyled on the
 * dashboard's tokens; U6 replaces it with WdHeader.
 *
 * Props: wallet (the address on screen, or null on the lookup page),
 * onSubmit(address).
 */
export default function AppBar({ wallet, onSubmit }) {
  const [value, setValue] = useState(wallet || "");
  useEffect(() => setValue(wallet || ""), [wallet]);
  return (
    <header className="sticky top-0 z-20 bg-surface-raised/90 shadow-[0_1px_0_rgb(var(--wd-line))] backdrop-blur">
      <a href="#wd-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 md:px-10">
        <a href="/" className="flex shrink-0 items-center gap-2.5 text-wd-ink hover:opacity-80">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent font-display text-sm font-bold text-white">
            HT
          </span>
          <span className="font-display text-wd-title font-semibold">Wallet Dashboard</span>
        </a>
        {wallet && (
          <form
            role="search"
            className="hidden min-w-0 flex-1 justify-end md:flex"
            onSubmit={(e) => {
              e.preventDefault();
              const v = value.trim();
              if (v) onSubmit(v);
            }}
          >
            <label htmlFor="wd-address" className="sr-only">
              Wallet address
            </label>
            <input
              id="wd-address"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
              className="h-9 w-full max-w-[480px] rounded-lg border border-wd-control bg-wd-well px-3 font-mono text-xs text-wd-ink"
            />
          </form>
        )}
      </div>
    </header>
  );
}
