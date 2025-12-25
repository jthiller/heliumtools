import { useEffect, useMemo, useState, useRef } from "react";
import Header from "../components/Header.jsx";
import { resolveOui, createDcOrder } from "../lib/dcPurchaseApi.js";

const disclosureText =
  "You are purchasing USDC, which will be swapped to HNT and then converted to Data Credits. Final DC delivered may be more or less than expected due to price changes, slippage, and fees.";

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between text-sm text-slate-600">
      <span className="font-medium text-slate-700">{label}</span>
      <span className="text-slate-900 font-mono break-all text-right">{value || "-"}</span>
    </div>
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
    // Clear any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const ouiNumber = Number(ouiInput);

    // Reset if empty or invalid
    if (!ouiInput || !Number.isInteger(ouiNumber) || ouiNumber <= 0) {
      setResolved(null);
      setError(null);
      return;
    }

    // Debounce the API call by 400ms
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
      <main className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="mb-8">
          <p className="text-sm font-mono uppercase tracking-widest text-sky-600 mb-2">Data Credits</p>
          <h1 className="text-3xl font-bold text-slate-900 mb-3">Buy Data Credits</h1>
          <p className="text-slate-600 max-w-2xl">
            Enter an OUI to look up its payer and escrow accounts, then continue to Coinbase Onramp guest checkout to fund and
            delegate Data Credits.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-slate-800">OUI</label>
              <div className="mt-1 relative">
                <input
                  type="number"
                  value={ouiInput}
                  onChange={(e) => setOuiInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  placeholder="Enter OUI number"
                />
                {resolving && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="animate-spin h-4 w-4 border-2 border-sky-500 border-t-transparent rounded-full"></div>
                  </div>
                )}
              </div>
            </div>

            {resolved && (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 space-y-2">
                <InfoRow label="Payer" value={resolved.payer} />
                <InfoRow label="Escrow" value={resolved.escrow} />
                <InfoRow
                  label="Escrow DC Balance"
                  value={resolved.escrowDcBalance ? `${resolved.escrowDcBalance} DC` : "Unknown"}
                />
                <InfoRow label="Last Updated" value={resolved.balanceLastUpdated || "Unknown"} />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-800">USD Amount</label>
              <input
                type="number"
                min="5"
                step="0.01"
                value={usd}
                onChange={(e) => setUsd(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                {disclosureText}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-800">Email (optional)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                placeholder="you@example.com"
              />
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <button
              type="submit"
              disabled={!canCreate || loading}
              className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {submitting ? "Starting checkout..." : "Continue to Coinbase checkout"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
