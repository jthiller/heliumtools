import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fetchSummary, fetchFleet, fetchTransactions } from "../lib/walletDashboardApi.js";
import { fetchPositions } from "../lib/veHntApi.js";

// The wallet's own data, one hook per source. Each state is scoped to the
// wallet it was fetched for: a late response for a previous wallet is
// dropped, and a state that belongs to another wallet reads as loading, so a
// wallet switch never shows the last wallet's figures for a render.

const IDLE = { wallet: null, data: null, loading: false, error: null };

/**
 * Run `reset` when `value` changes (not on the first render): per-wallet
 * state resets without re-keying a component (a re-keyed root would replay
 * the entrance motion). Runs during render, so `reset` may call only this
 * component's own state setters and reset refs, and must be idempotent.
 * The value last seen is state, not a ref: under StrictMode's double render a
 * ref already holds the new value on the second pass, so the setState calls
 * made by the first pass's reset would be dropped.
 */
export function useResetOnChange(value, reset) {
  const [seen, setSeen] = useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    reset();
  }
}

function useWalletResource(wallet, fetcher) {
  const [state, setState] = useState(IDLE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!wallet) {
      setState(IDLE);
      return undefined;
    }
    let cancelled = false;
    // A retry keeps what loaded for this wallet until the answer replaces it.
    setState((s) => ({ wallet, data: s.wallet === wallet ? s.data : null, loading: true, error: null }));
    fetcher(wallet)
      .then((data) => !cancelled && setState({ wallet, data, loading: false, error: null }))
      .catch((e) => !cancelled && setState((s) => ({ wallet, data: s.wallet === wallet ? s.data : null, loading: false, error: e?.message || String(e) })));
    return () => {
      cancelled = true;
    };
  }, [wallet, fetcher, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const mine = state.wallet === wallet;
  return useMemo(
    () => ({
      data: mine ? state.data : null,
      loading: mine ? state.loading : Boolean(wallet),
      error: mine ? state.error : null,
      retry,
    }),
    [mine, state, wallet, retry],
  );
}

/** `/summary`: balances, prices, fleet stats. @returns {{ data, loading, error, retry }} */
export function useWalletSummary(wallet) {
  return useWalletResource(wallet, fetchSummary);
}

/** `/fleet`: every Hotspot row. `data.hotspots` is the fleet. @returns {{ data, loading, error, retry }} */
export function useWalletFleet(wallet) {
  return useWalletResource(wallet, fetchFleet);
}

/** `/ve-hnt/positions`: veHNT positions and totals. @returns {{ data, loading, error, retry }} */
export function useGovernance(wallet) {
  return useWalletResource(wallet, fetchPositions);
}

/**
 * Recent transactions, paginated by signature cursor.
 * `data`: { transactions (every page loaded so far), cursor (null at the end),
 *   ...the first page's other fields }.
 * `loadMore()` appends the next page; a failed page keeps the loaded rows and
 * sets `loadMoreError`. A page that answers after a wallet switch is dropped.
 * @returns {{ data, loading, error, retry, loadMore, loadingMore, loadMoreError }}
 */
export function useWalletTransactions(wallet) {
  const first = useWalletResource(wallet, fetchTransactions);
  const [more, setMore] = useState({ wallet: null, pages: [], cursor: undefined, loading: false, error: null });
  const genRef = useRef(0);

  // A wallet switch or a reload of the first page drops the pages after it.
  useEffect(() => {
    genRef.current++;
    setMore({ wallet, pages: [], cursor: undefined, loading: false, error: null });
  }, [wallet, first.data]);

  const mine = more.wallet === wallet;
  const cursor = mine && more.cursor !== undefined ? more.cursor : (first.data?.cursor ?? null);
  const loadMore = useCallback(async () => {
    if (!wallet || !cursor || (mine && more.loading)) return;
    const gen = genRef.current;
    setMore((m) => ({ ...m, wallet, loading: true, error: null }));
    try {
      const page = await fetchTransactions(wallet, { before: cursor });
      if (gen !== genRef.current) return;
      setMore((m) => ({ ...m, wallet, pages: [...m.pages, page], cursor: page.cursor || null, loading: false }));
    } catch (e) {
      if (gen !== genRef.current) return;
      setMore((m) => ({ ...m, wallet, loading: false, error: e?.message || String(e) }));
    }
  }, [wallet, cursor, mine, more.loading]);

  const data = useMemo(() => {
    if (!first.data) return null;
    const pages = mine ? more.pages : [];
    if (!pages.length) return first.data;
    return {
      ...first.data,
      transactions: [...(first.data.transactions || []), ...pages.flatMap((p) => p.transactions || [])],
      cursor,
    };
  }, [first.data, mine, more.pages, cursor]);

  return useMemo(
    () => ({
      data,
      loading: first.loading,
      error: first.error,
      retry: first.retry,
      loadMore,
      loadingMore: mine && more.loading,
      loadMoreError: mine ? more.error : null,
    }),
    [data, first.loading, first.error, first.retry, loadMore, mine, more.loading, more.error],
  );
}
