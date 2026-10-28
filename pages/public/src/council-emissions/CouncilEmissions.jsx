import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import { fetchCouncilSeat, fetchCouncilSummary } from "../lib/councilEmissionsApi.js";
import { fetchCurrentPrice } from "../lib/hntPriceApi.js";
import { useWebMcpTools } from "../webmcp/useWebMcpTools.js";
import { makeCouncilEmissionsTools } from "./webmcpTools.js";
import EmissionsTimeline from "./EmissionsTimeline.jsx";
import FateBars from "./FateBars.jsx";
import DistributionRuns from "./DistributionRuns.jsx";
import SeatDetail from "./SeatDetail.jsx";
import { accountUrl, fmtAgo, fmtDateTime, fmtDay, fmtHnt, fmtUsd, nextDistributionAt, toHnt } from "./format.js";

// The worker indexes on a 15-min cron and serves everyone from cache, so
// polling faster than this only re-reads the same document.
const POLL_MS = 60_000;
const ELECTION = "EejcqoypTXfix3m8GrPwLPQfs1P16yCPhiyzkMLvLRx4";
// The election's top five by veHNT, who hold the five seats receiving emissions.
const ELECTED = ["James Fayal", "Chris Ferebee", "Samuel Andrews, MD", "Jacob Brady", "Eric Eife"];
const HIP_149 = "https://github.com/helium/HIP/blob/main/0149-helium-utility-and-emissions-realignment.md";

function ExtLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent-text">
      {children}
      <ArrowTopRightOnSquareIcon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">, opens in a new tab</span>
    </a>
  );
}

function Countdown({ to }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, to - Math.floor(now / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return <>{h > 0 ? `in ${h} h ${m} min` : `in ${m} min`}</>;
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl bg-surface-raised p-4 shadow-soft">
      <dt className="text-xs text-content-tertiary">{label}</dt>
      <dd className="mt-1.5 font-mono text-xl tabular-nums tracking-tight text-content">{value}</dd>
      {sub && <dd className="mt-1 text-xs text-content-tertiary">{sub}</dd>}
    </div>
  );
}

function Section({ title, children, caption }) {
  return (
    <section className="rounded-2xl bg-surface-raised p-5 shadow-soft sm:p-6">
      <h2 className="font-display text-lg font-semibold text-content">{title}</h2>
      {caption && <p className="mt-1 max-w-3xl text-xs text-content-tertiary">{caption}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function sumKind(seats, pred) {
  let total = 0n;
  for (const s of seats) for (const [k, v] of Object.entries(s.byKind)) if (pred(k)) total += BigInt(v);
  return total.toString();
}

export default function CouncilEmissions() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const seatWallet = params.get("seat");
  const focusLot = params.get("lot");
  const focusTx = params.get("tx");

  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [warming, setWarming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [price, setPrice] = useState(null);
  const builtAtRef = useRef(null);

  useWebMcpTools(() => makeCouncilEmissionsTools(navigate), []);

  const refresh = useCallback(async (signal) => {
    setRefreshing(true);
    try {
      const s = await fetchCouncilSummary({ signal });
      if (s?.warming) {
        setWarming(true);
      } else {
        setWarming(false);
        setSummary(s);
        builtAtRef.current = s.builtAt;
      }
      setSummaryError(null);
    } catch (err) {
      if (err?.name !== "AbortError") setSummaryError(err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    refresh(ctrl.signal);
    fetchCurrentPrice({ signal: ctrl.signal }).then((p) => setPrice(p?.spot?.usd ?? null)).catch(() => {});
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [refresh]);

  // The seat view reloads whenever the snapshot behind it is rebuilt.
  useEffect(() => {
    if (!seatWallet) {
      setDetail(null);
      return undefined;
    }
    const ctrl = new AbortController();
    setDetailError(null);
    // Never show one seat's detail under another seat's address.
    setDetail((d) => (d?.seat?.wallet === seatWallet ? d : null));
    fetchCouncilSeat(seatWallet, { signal: ctrl.signal })
      .then((d) => setDetail(d?.warming ? null : d))
      .catch((err) => {
        if (err?.name !== "AbortError") setDetailError(err);
      });
    return () => ctrl.abort();
  }, [seatWallet, summary?.builtAt]);

  const openSeat = useCallback((wallet, extra = {}) => {
    const q = new URLSearchParams({ seat: wallet, ...extra });
    setParams(q);
    window.scrollTo({ top: 0 });
  }, [setParams]);

  const onOpenMark = useCallback(({ wallet, lot, tx }) => {
    openSeat(wallet, lot ? { lot } : tx ? { tx } : {});
  }, [openSeat]);

  const t = summary?.totals;
  const held = summary ? sumKind(summary.seats, (k) => k === "held" || k === "held_by_seat") : null;
  const left = summary ? (BigInt(t.emitted) - BigInt(held)).toString() : null;
  // One empty run (the distribution beating the mint) means a 48 h gap is normal.
  const staleEmission = summary?.backfill.done && t?.lastEmissionAt && Date.now() / 1000 - t.lastEmissionAt > 54 * 3600;

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Council Emissions" />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <h1 className="font-display text-3xl font-semibold tracking-tight text-content sm:text-4xl">HIP-149 Council Emissions</h1>
              <p className="mt-3 text-content-secondary">
                HIP-149 mints {t?.perSeatPerDay ? fmtHnt(BigInt(t.perSeatPerDay) * BigInt(t.seats)) : "HNT"} a day for the five elected Advisory Council seats and distributes it to each seat at 00:00 UTC. This page tracks every emission and where it went.
              </p>
            </div>
            {summary && (
              <button
                type="button"
                onClick={() => refresh()}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-content-secondary transition hover:border-content-tertiary hover:text-content disabled:opacity-50"
              >
                <ArrowPathIcon className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
                Refresh
              </button>
            )}
          </div>
          {summary && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-tertiary">
              <span>Updated {fmtAgo(summary.builtAt)}{summary.indexedThrough ? `, indexed through ${fmtDateTime(summary.indexedThrough.t)}` : ""}</span>
              <ExtLink href={accountUrl(summary.fanout.pda)}>Fanout on Solscan</ExtLink>
              <ExtLink href={HIP_149}>HIP-149</ExtLink>
              <Link to={`/vote/${ELECTION}`} className="hover:text-accent-text">Council election</Link>
            </div>
          )}
        </div>

        {summaryError && !summary && <StatusBanner tone="error" message={`Couldn't load council emissions. ${summaryError.message || ""}`} />}
        {warming && !summary && <StatusBanner tone="loading" message="Building the council emission history. This takes a few minutes the first time." />}
        {!summary && !warming && !summaryError && (
          <div className="rounded-2xl border border-dashed border-border px-8 py-16 text-center text-sm text-content-secondary">Loading council emissions…</div>
        )}

        {summary && (
          <>
            {!summary.backfill.done && (
              <StatusBanner tone="info" message={`Still reading emission history from Solana (${summary.backfill.indexed} of ${summary.backfill.cursors} accounts, ${summary.backfill.pending} transactions queued). Figures may be incomplete.`} />
            )}
            {summary.drift.fanoutMissing && <StatusBanner tone="warning" message="The council fanout account no longer exists on chain." />}
            {summary.drift.sharesChanged && <StatusBanner tone="warning" message="The fanout's recipients or shares have changed since this page was set up. New emissions follow the on-chain shares." />}
            {summary.drift.unexpectedSeats.length > 0 && <StatusBanner tone="warning" message={`The fanout sent emissions to ${summary.drift.unexpectedSeats.length} wallet(s) outside the original five seats. They appear as extra seats below.`} />}
            {staleEmission && <StatusBanner tone="warning" message={`No emission has reached the seats since ${fmtDateTime(t.lastEmissionAt)}.`} />}

            {seatWallet ? (
              detailError ? (
                <div className="space-y-3">
                  <StatusBanner tone="error" message={detailError.status === 404 ? "That wallet isn't one of the council's seat wallets." : `Couldn't load this seat. ${detailError.message || ""}`} />
                  <button type="button" onClick={() => setParams({})} className="text-sm text-content-secondary hover:text-content">Back to all seats</button>
                </div>
              ) : detail?.seat?.wallet === seatWallet ? (
                <SeatDetail key={seatWallet} detail={detail} focusLot={focusLot} focusTx={focusTx} onBack={() => setParams({})} />
              ) : (
                <div className="rounded-2xl border border-dashed border-border px-8 py-16 text-center text-sm text-content-secondary">Loading seat…</div>
              )
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                  <Stat label="Emitted to seats" value={fmtHnt(t.emitted)} sub={summary.lanes[0]?.lots[0] ? `since ${fmtDay(summary.lanes[0].lots[0].t)}` : null} />
                  <Stat label="Waiting in the fanout" value={fmtHnt(t.waiting)} sub={<>distributed at 00:00 UTC, <Countdown to={nextDistributionAt()} /></>} />
                  <Stat label="Per seat per day" value={t.perSeatPerDay ? fmtHnt(t.perSeatPerDay) : "Not known"} sub={`average of the last ${t.recentEpochs} days of mints`} />
                  <Stat label="Still held by seats" value={fmtHnt(held)} sub={BigInt(t.emitted) > 0n ? `${Math.round((Number(held) / Number(t.emitted)) * 100)}% of everything emitted` : null} />
                  <Stat label="Left the seat wallets" value={fmtHnt(left)} sub={price ? `about ${fmtUsd(toHnt(left) * price)} at today's HNT price` : null} />
                </dl>

                <Section
                  title="Every emission, and where it went"
                  caption="One lane per seat. Each bar above a lane is one daily emission, colored by where that HNT went; each marker below is an outgoing transfer. A wallet's oldest HNT is counted as leaving first. Hover or focus a mark to see what it connects to, and select it for the full path."
                >
                  <EmissionsTimeline summary={summary} onOpen={onOpenMark} />
                </Section>

                <Section
                  title="Where it went, by seat"
                  caption="Split of everything emitted to each seat. HNT held before the first emission, and HNT received from elsewhere, isn't counted. Sent to an exchange means it arrived at an exchange address, not that it was sold."
                >
                  <FateBars summary={summary} onOpenSeat={(w) => openSeat(w)} />
                </Section>

                <DistributionRuns totals={t} />

                <section className="rounded-2xl bg-surface-raised p-5 shadow-soft sm:p-6">
                  <h2 className="font-display text-lg font-semibold text-content">Who holds the seats</h2>
                  <p className="mt-2 text-sm text-content-secondary">
                    The five seats receiving emissions went to the top five candidates in the{" "}
                    <Link to={`/vote/${ELECTION}`} className="text-accent-text hover:underline">HIP-149 Advisory Council election</Link>:{" "}
                    {ELECTED.join(", ")}.
                  </p>
                  <p className="mt-2 text-sm text-content-tertiary">
                    No public source says which wallet belongs to whom, so seats are shown by wallet. A seat shows a name only once a public source ties it to a wallet.
                  </p>
                </section>

                <details className="rounded-2xl bg-surface-raised p-5 shadow-soft sm:p-6">
                  <summary className="cursor-pointer font-display text-lg font-semibold text-content">How this is worked out</summary>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-content-secondary">
                    <li>Each epoch, HIP-149 mints the council's share into the token account of a mini-fanout, which distributes it to the five seats in equal shares at 00:00 UTC. Every emission is read from chain.</li>
                    <li>HNT is interchangeable, so the page counts a wallet's oldest HNT as leaving first. A transfer uses up any HNT the wallet held before emissions began, then the earliest emissions.</li>
                    <li>When HNT moves to another wallet, the page follows it there, up to six wallets deep, until it is swapped, locked in veHNT, burned for Data Credits or reaches an exchange. Moves under 1 HNT, and wallets too busy to follow, are marked not traced further.</li>
                    <li>Exchange and other labels come from a hand-checked list first, then from Helius wallet identity data. An exchange label means the HNT reached that exchange, not that it was sold.</li>
                    <li>Figures are in HNT. The dollar figure uses today's price only; there is no historical price on this page.</li>
                  </ul>
                </details>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
