import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Header from "../components/Header.jsx";
import { fetchOrder } from "../lib/dcPurchaseApi.js";

const disclosureText =
  "Final Data Credits may differ from estimates because funds are swapped and minted after payment. Prices, slippage, and fees can change the delivered amount.";

const STATUS_FLOW = [
  "onramp_started",
  "payment_confirmed",
  "usdc_verified",
  "swapping",
  "minting_dc",
  "delegating",
  "complete",
];

function StatusStep({ status, active }) {
  const isComplete = active === "complete" || STATUS_FLOW.indexOf(active) > STATUS_FLOW.indexOf(status);
  const isCurrent = active === status;
  const color = isComplete ? "bg-emerald-500" : isCurrent ? "bg-sky-500" : "bg-slate-200";
  return (
    <div className="flex items-center gap-2 text-xs text-slate-600">
      <div className={`h-2.5 w-2.5 rounded-full ${color}`}></div>
      <span className="uppercase tracking-wide">{status.replace(/_/g, " ")}</span>
    </div>
  );
}

export default function OrderStatus() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    let interval;
    async function load(initial = false) {
      try {
        const data = await fetchOrder(orderId);
        if (!active) return;
        setOrder(data);
        if (data.status === "complete") {
          clearInterval(interval);
        }
      } catch (err) {
        if (!active) return;
        setError(err.message || "Unable to load order");
      }
    }

    load(true);
    interval = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [orderId]);

  const activeStatus = order?.status || "onramp_started";

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="mb-6">
          <p className="text-sm font-mono uppercase tracking-widest text-sky-600 mb-2">Order</p>
          <h1 className="text-2xl font-bold text-slate-900">Data Credit Purchase</h1>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">{disclosureText}</p>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="grid grid-cols-2 gap-3 text-sm text-slate-700">
            <div>
              <div className="text-xs uppercase text-slate-500">Payer</div>
              <div className="font-mono break-all">{order?.payer || "-"}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Escrow</div>
              <div className="font-mono break-all">{order?.escrow || "-"}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">USD</div>
              <div>${order?.usdRequested || "-"}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Order ID</div>
              <div className="font-mono break-all">{orderId}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STATUS_FLOW.map((status) => (
              <StatusStep key={status} status={status} active={activeStatus} />
            ))}
          </div>

          {order?.dcDelegated && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Delivered {order.dcDelegated} Data Credits.
            </div>
          )}

          {order?.txs && (
            <div className="space-y-2 text-xs text-slate-600">
              {order.txs.usdcSig && <div>USDC Receipt: {order.txs.usdcSig}</div>}
              {order.txs.swapSig && <div>Swap: {order.txs.swapSig}</div>}
              {order.txs.mintSigs?.length ? (
                <div>Mint: {order.txs.mintSigs.join(", ")}</div>
              ) : null}
              {order.txs.delegateSig && <div>Delegate: {order.txs.delegateSig}</div>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
