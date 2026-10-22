import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Btn2, Card, ExtLink, Skeleton, StatusMark, Tag } from "../ui/index.js";
import { accountUrl, txUrl } from "../format.js";
import { NEW_TAB_SR } from "../copy.js";
import { RECENT_DAYS, groupActivity } from "./activityModel.js";

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const secondsFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dayYearFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The viewer's time zone as a short name ("PDT"), for "times in PDT". */
function zoneName() {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "your time zone";
  } catch {
    return "your time zone";
  }
}

const relText = (ago) => (ago == null ? "" : ago <= 0 ? "Today" : ago === 1 ? "Yesterday" : ago <= RECENT_DAYS ? `${ago} days ago` : "");
// A transaction without a block time reads in words, never as an epoch date.
const timeText = (ms) => (ms == null ? "Time unknown" : timeFmt.format(ms));
const secondsText = (ms) => (ms == null ? "Time unknown" : secondsFmt.format(ms));
const dateText = (d) => (d.at == null ? "Date unknown" : (d.ago > RECENT_DAYS ? dayYearFmt : dayFmt).format(d.at));
const sigShort = (s) => `${s.slice(0, 8)}…${s.slice(-4)}`;
const feeText = (lamports) =>
  lamports == null ? null : `Fee ${(lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL`;

const ROW =
  "-mx-2 flex min-h-11 w-[calc(100%+16px)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-wd-ink hover:bg-wd-well hover:no-underline";
const TIME = "flex-none whitespace-nowrap text-wd-cap tabular-nums text-wd-ink-2";

function GroupLine({ g, failed }) {
  const count = g.multi && g.typed ? `×${g.count}` : null;
  const label = g.multi && !g.typed ? `${g.count} transactions` : g.label;
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
      {failed && (
        <span className="inline-flex items-center gap-1.5 self-center text-sm font-semibold text-wd-critical-text">
          <StatusMark tier="serious" sr={false} />
          Failed
        </span>
      )}
      <span className="text-sm font-medium text-wd-ink [overflow-wrap:anywhere]">{label}</span>
      {count && <span className="font-display text-wd-sm font-semibold text-wd-ink-2">{count}</span>}
      {g.source && <Tag>{g.source}</Tag>}
      {g.detail && <span className="text-wd-cap text-wd-ink-3">{g.detail}</span>}
    </span>
  );
}

function Group({ g, day, open, onToggle }) {
  const time = timeText(g.at);
  const when = g.at == null ? "date and time unknown" : `${day.date}${day.ago <= 0 ? " (today)" : ""} at ${time}`;
  if (!g.multi) {
    const t = g.txs[0];
    return (
      <a
        href={txUrl(t.signature)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${g.ok ? "" : "Failed: "}${g.label}${g.detail ? ` ${g.detail}` : ""}, ${when}. View on Solscan${NEW_TAB_SR}`}
        className={ROW}
      >
        <span aria-hidden="true" className="w-3 flex-none" />
        <GroupLine g={g} failed={!g.ok} />
        <span className={TIME}>
          {time} <span aria-hidden="true" className="font-medium text-accent-text">↗</span>
        </span>
      </a>
    );
  }
  const panelId = `wallet-tx-${g.id}`;
  const label = g.typed ? g.label : `${g.count} transactions`;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}${g.typed ? `, ${g.count} transactions` : ""}${g.detail ? ` ${g.detail}` : ""}${g.source ? `, ${g.source}` : ""}, latest ${when}`}
        onClick={onToggle}
        className={`${ROW} cursor-pointer border-0 bg-transparent`}
      >
        <span
          aria-hidden="true"
          className={`w-3 flex-none text-center text-lg font-medium leading-4 text-wd-ink-3 motion-safe:transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
        <GroupLine g={g} />
        <span className={TIME}>{time}</span>
      </button>
      <div id={panelId} hidden={!open} className="mb-2 ml-[22px] mt-0.5 rounded-lg bg-wd-well px-3 pb-1 pt-0.5 max-md:ml-0">
        {g.full && (
          <p className="mb-1 mt-2 text-wd-cap text-wd-ink-2 [overflow-wrap:anywhere]">
            {g.fullLead} <b className="font-mono font-medium text-wd-ink">{g.full}</b>
          </p>
        )}
        <ul className="m-0 list-none p-0">
          {g.txs.map((t) => {
            const fee = feeText(t.fee);
            return (
              <li key={t.signature} className="border-t border-wd-line first:border-t-0">
                <a
                  href={txUrl(t.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${t.ok ? "Succeeded" : "Failed"}. ${t.label}${t.detail ? ` ${t.detail}` : ""}, ${t.at == null ? "date and time unknown" : `${dayYearFmt.format(t.at)} at ${secondsFmt.format(t.at)}`}. View on Solscan${NEW_TAB_SR}`}
                  className="group flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1.5 py-1 text-wd-cap text-wd-ink hover:no-underline max-md:min-h-11"
                >
                  <StatusMark tier={t.ok ? "ok" : "serious"} sr={false} />
                  <span className={t.ok ? "sr-only" : "font-semibold text-wd-critical-text"}>{t.ok ? "Succeeded" : "Failed"}</span>
                  <span className="tabular-nums">{secondsText(t.at)}</span>
                  <span className="font-mono text-[11px] font-medium text-wd-ink-2">{sigShort(t.signature)}</span>
                  {fee && <span className="text-wd-ink-2">{fee}</span>}
                  <span aria-hidden="true" className="ml-auto font-medium text-accent-text group-hover:underline">
                    Solscan ↗
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/**
 * Wallet: Activity. The loaded transactions grouped by local day ("Today",
 * "Yesterday", "3 days ago"), then by what happened: repeats fold into one
 * row ("Rewards distributed ×4", "12 transactions") that opens to each
 * signature with its time, fee and Solscan link; a single transaction links
 * to Solscan directly; a failed one never folds into a group. Load more
 * extends the days (a failed page keeps the rows loaded so far). Open groups
 * reset per wallet; the hook drops a page that answers after a switch.
 * `transactions` is useWalletTransactions' state.
 */
export default memo(function Activity({ wallet, transactions }) {
  // Groups the viewer opened or closed; any wallet switch collapses back to
  // the default open group (the last wallet is kept in state, so the reset
  // survives StrictMode's double render).
  const [toggledState, setToggled] = useState({ wallet, ids: {} });
  if (toggledState.wallet !== wallet) setToggled({ wallet, ids: {} });
  const toggled = toggledState.wallet === wallet ? toggledState.ids : {};
  const { data, error, retry, loadMore, loadingMore, loadMoreError } = transactions;
  const loading = !data && !error;
  const model = useMemo(() => (data ? groupActivity(data.transactions, wallet) : null), [data, wallet]);
  const zone = useMemo(zoneName, []);
  const days = useMemo(
    () =>
      model?.days.map((d) => ({ ...d, date: dateText(d), rel: relText(d.ago) })) ?? [],
    [model],
  );
  const isOpen = (g) => (g.id in toggled ? toggled[g.id] : g.id === model?.defaultOpen);
  const has = Boolean(model?.count);

  // After Load more or its Retry, keyboard focus follows the action instead
  // of falling to the page: Load more keeps it while the page loads
  // (aria-disabled, never disabled, which would drop focus), a failed page
  // hands it to Retry, Retry hands it back to Load more, and the last page
  // hands it to the Solscan link. Only lost focus is moved.
  const follow = useRef(false);
  const moreRef = useRef(null);
  const retryRef = useRef(null);
  const footRef = useRef(null);
  const cursor = data?.cursor ?? null;
  useEffect(() => {
    if (!follow.current) return;
    const active = document.activeElement;
    if (!active || active === document.body) {
      (loadMoreError ? retryRef.current : (moreRef.current ?? footRef.current?.querySelector("a")))?.focus();
    }
    if (!loadingMore) follow.current = false;
  }, [loadingMore, loadMoreError, cursor]);
  const onMore = () => {
    if (loadingMore) return;
    follow.current = true;
    loadMore();
  };

  return (
    <Card as="article" aria-labelledby="wallet-act-title" busy={loading} className="flex flex-col">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id="wallet-act-title" className="m-0 font-display text-wd-title font-semibold text-wd-ink">
          Activity
        </h3>
        {(loading || has) && (
          <span className="text-right text-wd-cap text-wd-ink-3">{loading ? "Loading" : `Latest ${model.count} · times in ${zone}`}</span>
        )}
      </div>
      {loading && (
        <>
          <span className="sr-only">Loading transactions</span>
          <div aria-hidden="true">
            {["46%", "38%", "52%", "30%", "44%", "36%"].map((w, i) => (
              <div key={w} className="flex items-center gap-3 border-t border-wd-line-2 py-[13px] first:border-t-0">
                <Skeleton w={i % 3 === 0 ? 56 : 0} h={14} />
                <Skeleton w={w} h={14} style={{ marginLeft: i % 3 === 0 ? 40 : 96 }} />
                <Skeleton w={56} h={12} style={{ marginLeft: "auto" }} />
              </div>
            ))}
          </div>
        </>
      )}
      {!data && error && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-wd-critical-surface px-3 py-2.5">
          <span className="inline-flex min-w-[180px] flex-1 items-center gap-2 text-wd-sm font-medium text-wd-critical-text">
            <StatusMark tier="serious" sr={false} />
            Couldn&apos;t load transactions.
          </span>
          <Btn2 onClick={retry} aria-label="Retry loading transactions">
            Retry
          </Btn2>
        </div>
      )}
      {data && !has && <p className="m-0 mt-0.5 text-sm text-wd-ink-2">No transactions in this wallet.</p>}
      {has && (
        <>
          <ul aria-label="Transactions by day" className="m-0 list-none p-0">
            {days.map((d) => (
              <li
                key={d.key}
                className="grid grid-cols-1 border-t border-wd-line-2 pb-1.5 pt-0.5 first:border-t-0 md:grid-cols-[84px_minmax(0,1fr)] md:gap-x-3 md:py-1 xl:grid-cols-[96px_minmax(0,1fr)]"
              >
                <h4 className="m-0 flex flex-row items-baseline gap-2 pb-0.5 pt-3 text-wd-sm font-semibold text-wd-ink md:flex-col md:items-start md:gap-0 md:pb-0">
                  {d.date}
                  {d.rel && <span className="text-wd-cap font-normal text-wd-ink-3">{d.rel}</span>}
                </h4>
                <ul className="m-0 min-w-0 list-none p-0">
                  {d.groups.map((g) => (
                    <li key={g.id}>
                      <Group g={g} day={d} open={isOpen(g)} onToggle={() => setToggled({ wallet, ids: { ...toggled, [g.id]: !isOpen(g) } })} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {loadMoreError && (
            <div role="alert" className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-wd-critical-surface px-3 py-2.5">
              <span className="inline-flex min-w-[180px] flex-1 items-center gap-2 text-wd-sm font-medium text-wd-critical-text">
                <StatusMark tier="serious" sr={false} />
                Couldn&apos;t load more transactions.
              </span>
              <Btn2 ref={retryRef} onClick={onMore} aria-label="Retry loading more transactions">
                Retry
              </Btn2>
            </div>
          )}
          <div ref={footRef} className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 pt-3.5">
            {data.cursor && !loadMoreError && (
              <button
                ref={moreRef}
                type="button"
                onClick={onMore}
                aria-disabled={loadingMore || undefined}
                className={`h-11 w-full rounded-lg border border-wd-control bg-surface-raised px-4 text-[13px] font-medium text-wd-ink transition md:h-9 md:w-auto ${
                  loadingMore ? "cursor-default opacity-55" : "cursor-pointer hover:bg-wd-well"
                }`}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
            <ExtLink href={accountUrl(wallet)} className="text-wd-sm font-medium text-accent-text hover:underline max-md:-my-3 max-md:inline-block max-md:py-3">
              All transactions on Solscan
            </ExtLink>
          </div>
        </>
      )}
    </Card>
  );
});
