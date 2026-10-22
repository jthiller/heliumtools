import { memo } from "react";
import { Section } from "../ui/index.js";
import Balances from "../wallet/Balances.jsx";
import VeHnt from "../wallet/VeHnt.jsx";
import Activity from "../wallet/Activity.jsx";

/**
 * Wallet: Balances and veHNT on the left, Activity on the right (one column
 * below 1024 px). Each card has its own loading, error (with Retry) and
 * empty state, so one source failing never blanks the others.
 *
 * Props: wallet, summary ({ data, loading, error, retry }), governance
 * ({ data, loading, error, retry }), transactions (useWalletTransactions
 * state: { data, loading, error, retry, loadMore, loadingMore,
 * loadMoreError }), money (deriveMoney: the Hotspot rewards a missing token
 * account blocks).
 */
export default memo(function WalletSection({ wallet, summary, governance, transactions, money }) {
  return (
    <Section id="wallet" title="Wallet" caption="Token balances, veHNT positions and recent transactions" data-wd-section="wallet">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Balances summary={summary} money={money} governance={governance} />
          <VeHnt wallet={wallet} governance={governance} hntPrice={summary.data?.prices?.hnt ?? null} />
        </div>
        <Activity wallet={wallet} transactions={transactions} />
      </div>
    </Section>
  );
});
