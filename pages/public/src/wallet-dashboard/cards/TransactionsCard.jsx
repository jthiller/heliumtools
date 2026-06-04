import { useState, useEffect, useCallback } from "react";
import {
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { Card, Skeleton, CardEmpty } from "./primitives.jsx";
import { fetchTransactions } from "../../lib/walletDashboardApi.js";
import { fmtAgoSeconds, txUrl } from "../format.js";

function prettyType(type) {
  if (!type || type === "UNKNOWN") return "Transaction";
  return type
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export default function TransactionsCard({ wallet }) {
  const [txns, setTxns] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTxns([]);
    setCursor(null);
    fetchTransactions(wallet)
      .then((data) => {
        if (cancelled) return;
        setTxns(data.transactions || []);
        setCursor(data.cursor || null);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchTransactions(wallet, { before: cursor });
      setTxns((prev) => [...prev, ...(data.transactions || [])]);
      setCursor(data.cursor || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [wallet, cursor]);

  return (
    <Card title="Recent wallet activity">
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <CardEmpty>Couldn&apos;t load transactions</CardEmpty>
      ) : txns.length === 0 ? (
        <CardEmpty>No transactions</CardEmpty>
      ) : (
        <>
          <div className="-mr-2 max-h-[380px] divide-y divide-border overflow-y-auto pr-2">
            {txns.map((t) => (
              <a
                key={t.signature}
                href={txUrl(t.signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 py-2.5"
              >
                {t.success ? (
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-content-tertiary" role="img" aria-label="Succeeded" />
                ) : (
                  <XCircleIcon className="h-4 w-4 shrink-0 text-rose-500" role="img" aria-label="Failed" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content">{prettyType(t.type)}</span>
                    {t.source && t.source !== "SYSTEM_PROGRAM" && (
                      <span className="text-[10px] uppercase tracking-wide text-content-tertiary">
                        {t.source}
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <div className="truncate text-xs text-content-tertiary">{t.description}</div>
                  )}
                </div>
                <span className="shrink-0 text-xs text-content-tertiary">{fmtAgoSeconds(t.timestamp)}</span>
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0 text-content-tertiary opacity-0 transition group-hover:opacity-100" />
              </a>
            ))}
          </div>
          {cursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 w-full rounded-lg border border-border py-2 text-sm font-medium text-content-secondary transition hover:border-content-tertiary disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
