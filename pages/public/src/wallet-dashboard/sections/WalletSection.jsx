import { memo } from "react";
import { fmtCount, fmtUsd } from "../format.js";

/**
 * Wallet: balances, veHNT, activity. STUB (U0a): the final props, a
 * placeholder body; U6 replaces it.
 *
 * Props: wallet, summary ({ data, loading, error, retry }), governance
 * ({ data, loading, error, retry }), transactions (useWalletTransactions
 * state: { data, loading, error, retry, loadMore, loadingMore,
 * loadMoreError }), money.
 */
export default memo(function WalletSection({ summary, governance, transactions }) {
  return (
    <section id="wallet" aria-labelledby="wallet-title" data-wd-section="wallet">
      <h2 id="wallet-title" className="m-0 font-display text-wd-h2-sm font-semibold md:text-wd-h2">
        Wallet
      </h2>
      <p className="mt-2 text-wd-sm text-wd-ink-2">
        Balances {summary.data ? fmtUsd(summary.data.totalUsd) : summary.error ? "couldn't load" : "…"} · veHNT positions{" "}
        {governance.data ? fmtCount(Number(governance.data.totals?.positionCount ?? 0)) : governance.error ? "couldn't load" : "…"} ·
        Transactions {transactions.data ? fmtCount(transactions.data.transactions?.length ?? 0) : transactions.error ? "couldn't load" : "…"}
      </p>
    </section>
  );
});
