import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import CopyButton from "../components/CopyButton.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import MiddleEllipsis from "react-middle-ellipsis";
import { usdFormatter, numberFormatter } from "../lib/utils.js";
import { fetchOrder } from "../lib/dcPurchaseApi.js";

const STATUS_FLOW = [
  { key: "onramp_started", label: "Checkout Started" },
  { key: "payment_confirmed", label: "Payment Confirmed" },
  { key: "usdc_verified", label: "USDC Received" },
  { key: "swapping", label: "Swapping to HNT" },
  { key: "minting_dc", label: "Minting DC" },
  { key: "delegating", label: "Delegating to OUI" },
  { key: "complete", label: "Complete" },
];

function StatusStep({ statusKey, label, activeStatus, hasError }) {
  const activeIndex = STATUS_FLOW.findIndex((s) => s.key === activeStatus);
  const stepIndex = STATUS_FLOW.findIndex((s) => s.key === statusKey);

  const isComplete = !hasError && (activeStatus === "complete" || activeIndex > stepIndex);
  const isCurrent = !hasError && activeStatus === statusKey;
  const isFailed = hasError && activeStatus === statusKey;

  return (
    <div className="flex items-center gap-3">
      <div className={`h-3 w-3 rounded-full shrink-0 ${isComplete ? "bg-emerald-500" :
        isCurrent ? "bg-accent animate-pulse" :
          isFailed ? "bg-rose-500" :
            "bg-border"
        }`} />
      <span className={`text-sm ${isComplete ? "text-content-secondary" :
        isCurrent ? "text-content font-medium" :
          isFailed ? "text-rose-600 dark:text-rose-400 font-medium" :
            "text-content-tertiary"
        }`}>
        {label}
      </span>
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
    let errorCount = 0;
    const MAX_ERRORS = 5;
    const POLL_INTERVAL = 4000;

    async function load() {
      try {
        const data = await fetchOrder(orderId);
        if (!active) return;
        setOrder(data);
        errorCount = 0;
        // Stop polling on terminal states
        if (data.status === "complete" || data.errorCode) {
          clearInterval(interval);
        }
      } catch (err) {
        if (!active) return;
        errorCount++;
        setError(err.message || "Unable to load order");
        if (errorCount >= MAX_ERRORS) {
          clearInterval(interval);
          setError("Unable to load order. Please refresh the page to try again.");
        }
      }
    }

    load();
    interval = setInterval(load, POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [orderId]);

  const activeStatus = order?.status || "onramp_started";
  const hasError = !!order?.errorCode;
  const isComplete = order?.status === "complete";

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Order Status" />

      <main className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Page Header */}
        <div className="mb-10">
          <p className="text-[13px] font-mono font-medium uppercase tracking-[0.08em] text-accent-text mb-2">
            Order Status
          </p>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-content tracking-[-0.03em] mb-4">
            Data Credit Purchase
          </h1>
          <p className="text-content-secondary">
            {isComplete
              ? "Your Data Credits have been delivered."
              : hasError
                ? "There was an issue with your order."
                : "Your order is being processed. This page updates automatically."}
          </p>
        </div>

        {/* Status Display */}
        <div className="space-y-8">
          {/* Success Banner */}
          {isComplete && order?.dcDelegated && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800/50 dark:bg-emerald-950/40">
              <div className="flex items-start gap-4">
                <CheckCircleIcon className="h-8 w-8 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div>
                  <p className="text-lg font-bold text-emerald-900 dark:text-emerald-200 mb-1">
                    {numberFormatter.format(order.dcDelegated)} Data Credits Delivered
                  </p>
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">
                    Your Data Credits have been delegated to OUI {order.oui}.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {order?.errorMessage && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-800/50 dark:bg-rose-950/40">
              <div className="flex items-start gap-4">
                <ExclamationTriangleIcon className="h-8 w-8 text-rose-600 dark:text-rose-400 shrink-0" />
                <div>
                  <p className="text-lg font-bold text-rose-900 dark:text-rose-200 mb-1">Order Error</p>
                  <p className="text-sm text-rose-700 dark:text-rose-300">{order.errorMessage}</p>
                  {order.errorCode && (
                    <p className="text-xs text-rose-500 dark:text-rose-400 mt-2 font-mono">Error: {order.errorCode}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Load Error */}
          {error && !order && (
            <StatusBanner tone="error" message={error} />
          )}

          {/* Order Details */}
          <div className="grid gap-px bg-border rounded-xl overflow-hidden">
            <div className="bg-surface-raised p-4 sm:grid sm:grid-cols-2 sm:gap-4">
              <div className="mb-4 sm:mb-0">
                <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">Order ID</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm text-content-secondary truncate">{orderId}</code>
                  <CopyButton text={orderId} size="h-3.5 w-3.5" />
                </div>
              </div>
              <div>
                <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">Amount</p>
                <p className="text-sm text-content font-medium">
                  {order?.usdRequested ? usdFormatter.format(order.usdRequested) : "—"}
                </p>
              </div>
            </div>
            {/* Progress amounts row */}
            {(order?.hntAmountReceived || order?.dcDelegated) && (
              <div className="bg-surface-raised p-4 sm:grid sm:grid-cols-2 sm:gap-4">
                <div className="mb-4 sm:mb-0">
                  <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">HNT Received</p>
                  <p className="text-sm text-content font-medium">
                    {order?.hntAmountReceived
                      ? `${(Number(order.hntAmountReceived) / 1e8).toFixed(4)} HNT`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">DC Minted</p>
                  <p className="text-sm text-content font-medium">
                    {order?.dcDelegated
                      ? numberFormatter.format(order.dcDelegated)
                      : "—"}
                  </p>
                </div>
              </div>
            )}
            <div className="bg-surface-raised p-4 overflow-hidden">
              <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">Payer Key</p>
              <div className="flex items-start gap-2">
                {order?.payer ? (
                  <>
                    <code
                      className="flex-1 min-w-0 text-sm text-content-secondary"
                      title={order.payer}
                    >
                      <MiddleEllipsis>
                        <span>{order.payer}</span>
                      </MiddleEllipsis>
                    </code>
                    <CopyButton text={order.payer} size="h-3.5 w-3.5" />
                  </>
                ) : (
                  <span className="text-sm text-content-tertiary">—</span>
                )}
              </div>
            </div>
            <div className="bg-surface-raised p-4 overflow-hidden">
              <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-1">Escrow Account</p>
              {order?.escrow ? (
                <a
                  className="text-sm text-accent-text hover:opacity-80 flex items-center gap-1"
                  href={`https://solscan.io/account/${encodeURIComponent(order.escrow)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <code className="min-w-0 flex-1" title={order.escrow}>
                    <MiddleEllipsis>
                      <span>{order.escrow}</span>
                    </MiddleEllipsis>
                  </code>
                  <ArrowRightIcon className="h-3 w-3 shrink-0 -rotate-45" />
                </a>
              ) : (
                <span className="text-sm text-content-tertiary">—</span>
              )}
            </div>
          </div>

          {/* Progress Steps */}
          <div className="bg-surface-inset rounded-xl p-6">
            <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary mb-4">Progress</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {STATUS_FLOW.map((step) => (
                <StatusStep
                  key={step.key}
                  statusKey={step.key}
                  label={step.label}
                  activeStatus={activeStatus}
                  hasError={hasError}
                />
              ))}
            </div>
          </div>

          {/* Transaction Signatures */}
          {order?.txs && Object.keys(order.txs).some((k) => order.txs[k]) && (
            <div className="space-y-3">
              <p className="text-sm font-mono uppercase tracking-widest text-content-tertiary">Transactions</p>
              <div className="space-y-2 text-xs">
                {order.txs.usdcSig && (
                  <a
                    href={`https://solscan.io/tx/${order.txs.usdcSig}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-accent-text hover:opacity-80"
                  >
                    <span>USDC Receipt</span>
                    <ArrowRightIcon className="h-3 w-3 -rotate-45" />
                  </a>
                )}
                {order.txs.swapSig && (
                  <a
                    href={`https://solscan.io/tx/${order.txs.swapSig}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-accent-text hover:opacity-80"
                  >
                    <span>HNT Swap</span>
                    <ArrowRightIcon className="h-3 w-3 -rotate-45" />
                  </a>
                )}
                {order.txs.mintSigs?.length > 0 && order.txs.mintSigs.map((sig, i) => (
                  <a
                    key={sig}
                    href={`https://solscan.io/tx/${sig}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-accent-text hover:opacity-80"
                  >
                    <span>DC Mint {order.txs.mintSigs.length > 1 ? `(${i + 1})` : ""}</span>
                    <ArrowRightIcon className="h-3 w-3 -rotate-45" />
                  </a>
                ))}
                {order.txs.delegateSig && (
                  <a
                    href={`https://solscan.io/tx/${order.txs.delegateSig}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-accent-text hover:opacity-80"
                  >
                    <span>Delegation</span>
                    <ArrowRightIcon className="h-3 w-3 -rotate-45" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 text-sm text-amber-800 dark:bg-amber-950/40 dark:border-amber-800/50 dark:text-amber-300">
            <p className="font-medium mb-1">Note</p>
            <p>
              Final Data Credits may differ from estimates because funds are swapped and minted after payment.
              Prices, slippage, and fees can affect the delivered amount.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-4">
            <Link
              to="/dc-purchase"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              Buy More Credits
            </Link>
            {order?.oui && (
              <Link
                to={`/oui-notifier/?oui=${order.oui}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-5 py-3 text-sm font-semibold text-content-secondary shadow-sm transition hover:bg-surface-inset"
              >
                View OUI Balance
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
