import { useEffect, useMemo, useState, useRef } from "react";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  CreditCardIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import MiddleEllipsis from "react-middle-ellipsis";
import { resolveOui, createDcOrder } from "../lib/dcPurchaseApi.js";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const dcFormatter = new Intl.NumberFormat("en-US");

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center text-slate-400 hover:text-slate-600 transition-colors"
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <CheckIcon className="h-4 w-4 text-emerald-500" />
      ) : (
        <ClipboardDocumentIcon className="h-4 w-4" />
      )}
    </button>
  );
}

export default function DcPurchaseTool() {
  const [ouiInput, setOuiInput] = useState("");
  const [usd, setUsd] = useState("50");
  const [email, setEmail] = useState("");
  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [resolved, setResolved] = useState(null);
  const debounceRef = useRef(null);

  const canCreate = useMemo(() => resolved && Number(usd) >= 5, [resolved, usd]);

  // Auto-resolve OUI when input changes (debounced)
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const ouiNumber = Number(ouiInput);

    if (!ouiInput || !Number.isInteger(ouiNumber) || ouiNumber <= 0) {
      setResolved(null);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setError(null);
      setResolving(true);
      try {
        const data = await resolveOui(ouiNumber);
        setResolved(data);
      } catch (err) {
        setResolved(null);
        setError(err.message || "Unable to resolve OUI");
      } finally {
        setResolving(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [ouiInput]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!resolved) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload = { oui: resolved.oui, usd, email: email || undefined };
      const res = await createDcOrder(payload);
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setError(err.message || "Unable to start checkout");
    } finally {
      setSubmitting(false);
    }
  }

  const loading = resolving || submitting;

  return (
    <div className="min-h-screen bg-white">
      <Header />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Page Header */}
        <div className="mb-10">
          <p className="text-sm font-mono uppercase tracking-widest text-sky-600 mb-2">
            Data Credits
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
            Buy Data Credits
          </h1>
          <p className="text-lg text-slate-600 max-w-xl">
            Fund your OUI with Data Credits via Coinbase Onramp. Enter your OUI to get started.
          </p>
        </div>

        {/* Main Grid: Form + OUI Details Sidebar */}
        <div className="grid md:grid-cols-[1fr,340px] gap-8 md:gap-12">
          {/* Left Column: Purchase Form */}
          <div className="space-y-8 order-2 md:order-1">
            <form className="space-y-6" onSubmit={handleSubmit}>
              {/* OUI Input */}
              <div>
                <label htmlFor="oui" className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-2 block">
                  OUI Number
                </label>
                <div className="relative">
                  <input
                    id="oui"
                    type="number"
                    inputMode="numeric"
                    value={ouiInput}
                    onChange={(e) => setOuiInput(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xl font-semibold text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    placeholder="Enter OUI"
                  />
                  {resolving && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <ArrowPathIcon className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  )}
                </div>
              </div>

              {/* Amount Input */}
              <div>
                <label htmlFor="usd" className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-2 block">
                  Amount (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-semibold text-slate-500 pointer-events-none">
                    $
                  </span>
                  <input
                    id="usd"
                    type="number"
                    min="5"
                    step="0.01"
                    value={usd}
                    onChange={(e) => setUsd(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-4 py-3 text-xl font-semibold text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    placeholder="50.00"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2">Minimum $5 USD</p>
              </div>

              {/* Email Input */}
              <div>
                <label htmlFor="email" className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-2 block">
                  Email <span className="text-slate-300">(optional)</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  placeholder="you@example.com"
                />
                <p className="text-xs text-slate-500 mt-2">Receive a receipt when your order completes</p>
              </div>

              {error && (
                <StatusBanner tone="error" message={error} />
              )}

              <button
                type="submit"
                disabled={!canCreate || loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <><ArrowPathIcon className="h-4 w-4 animate-spin" /> Starting checkout…</>
                ) : (
                  <><CreditCardIcon className="h-4 w-4" /> Continue to Coinbase</>
                )}
              </button>
            </form>

            {/* Disclaimer */}
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 text-sm text-amber-800">
              <p className="font-medium mb-1">Important</p>
              <p>
                You are purchasing USDC, which will be swapped to HNT and then converted to Data Credits.
                Final DC delivered may vary due to price changes, slippage, and fees.
              </p>
            </div>
          </div>

          <div
            className={`order-1 md:order-2 md:sticky md:top-8 h-fit w-full min-w-0 overflow-hidden transition-all duration-300 ease-out ${resolved
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-4 pointer-events-none absolute md:relative"
              }`}
          >
            {resolved && (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm w-full max-w-full">
                {/* Header + Balance - Always visible */}
                <div className="px-4 py-4 sm:px-5 sm:py-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-mono uppercase tracking-widest text-sky-600">OUI {resolved.oui}</p>
                  </div>
                  <p className="text-sm font-mono uppercase tracking-widest text-slate-400 mb-1">Current Balance</p>
                  <p className="text-2xl sm:text-3xl font-bold text-slate-900">
                    {resolved.escrowDcBalance
                      ? usdFormatter.format(Number(resolved.escrowDcBalance) / 100000)
                      : "—"}
                  </p>
                  <p className="text-sm text-slate-500">
                    {resolved.escrowDcBalance
                      ? `${dcFormatter.format(resolved.escrowDcBalance)} DC`
                      : "Unknown balance"}
                  </p>
                </div>

                {/* Compact address rows */}
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 sm:px-5 sm:py-4 space-y-3 overflow-hidden">
                  {/* Payer Key - compact row */}
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="text-xs font-mono uppercase tracking-wider text-slate-400 shrink-0 w-14">Payer</span>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <MiddleEllipsis>
                        <code className="text-xs text-slate-600" title={resolved.payer}>{resolved.payer}</code>
                      </MiddleEllipsis>
                    </div>
                    <CopyButton text={resolved.payer} />
                  </div>

                  {/* Escrow - compact row */}
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="text-xs font-mono uppercase tracking-wider text-slate-400 shrink-0 w-14">Escrow</span>
                    <a
                      className="flex-1 min-w-0 text-xs text-sky-600 hover:text-sky-500 flex items-center gap-1 overflow-hidden"
                      href={`https://solscan.io/account/${encodeURIComponent(resolved.escrow)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <MiddleEllipsis>
                          <code title={resolved.escrow}>{resolved.escrow}</code>
                        </MiddleEllipsis>
                      </div>
                      <ArrowRightIcon className="h-3 w-3 shrink-0 -rotate-45" />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
