import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAsyncCallback } from "react-async-hook";
import { VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { resolveSolanaWallet } from "../lib/solanaAddress.js";
import {
  ArrowTopRightOnSquareIcon,
  BoltIcon,
  CheckCircleIcon,
  LockClosedIcon,
  SparklesIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import CopyButton from "../components/CopyButton.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import Tooltip from "../components/Tooltip.jsx";
import { formatDuration, numberFormatter, truncateString } from "../lib/utils.js";
import { fetchPositions, buildClaimTransactions } from "../lib/veHntApi.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtHnt(value, opts = {}) {
  const { dp = 2, compact = false } = opts;
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  if (compact && n >= 1_000_000) {
    return (n / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "M";
  }
  if (compact && n >= 10_000) {
    return Math.round(n / 1000).toLocaleString() + "k";
  }
  if (n < 1) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: Math.max(4, dp) });
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function splitDurationParts(seconds) {
  if (seconds <= 0) return { big: "0d", small: null };
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const years = d >= 365 ? Math.floor(d / 365) : 0;
  const days = d % 365;
  if (years > 0) return { big: `${years}y ${days}d`, small: null };
  if (d > 0) return { big: `${d}d`, small: h > 0 ? `${h}h` : null };
  return { big: formatDuration(seconds), small: null };
}

function lockupSummary(lockup) {
  if (lockup.timeRemainingSecs <= 0) return { primary: "Expired", secondary: fmtDate(lockup.endTs) };
  const { big, small } = splitDurationParts(lockup.timeRemainingSecs);
  if (lockup.kind === "Cliff") {
    return { primary: `Unlocks in ${big}${small ? ` ${small}` : ""}`, secondary: `on ${fmtDate(lockup.endTs)}` };
  }
  // Constant: indefinite lockup with minimum unwind period.
  const totalDays = Math.floor((lockup.endTs - lockup.startTs) / 86400);
  return {
    primary: "Indefinite lockup",
    secondary: `${totalDays}d minimum to unwind · started ${fmtDate(lockup.startTs)}`,
  };
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function SummaryHeader({ totals, currentEpoch }) {
  const pendingNum = Number(totals.pendingRewardsHnt || 0);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-raised">
      {/* Headline */}
      <div className="px-6 sm:px-8 pt-7 pb-6">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-content-tertiary">
            Total voting power
          </p>
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-content-tertiary">
            epoch {currentEpoch}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <p className="font-display text-5xl sm:text-[64px] font-semibold text-content tracking-[-0.035em] tabular-nums leading-none">
            {fmtHnt(totals.veHnt, { dp: 0, compact: false })}
          </p>
          <p className="pb-2 font-display text-xl text-content-secondary tracking-[-0.01em]">veHNT</p>
        </div>
        <p className="mt-3 text-sm text-content-secondary">
          <span className="font-mono tabular-nums text-content">{fmtHnt(totals.hntLocked)}</span>{" "}
          HNT locked across{" "}
          <span className="font-mono tabular-nums text-content">{numberFormatter.format(totals.positionCount)}</span>{" "}
          {totals.positionCount === 1 ? "position" : "positions"}
        </p>
      </div>

      {/* Pending rewards footer — visually set apart when nonzero */}
      <div className="border-t border-border-muted bg-surface-inset/60 px-6 sm:px-8 py-4 flex items-baseline justify-between gap-4">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-content-tertiary">
            Pending delegation rewards
          </p>
          <p className={`mt-1 font-display text-2xl tracking-[-0.02em] tabular-nums ${
            pendingNum > 0 ? "text-content" : "text-content-tertiary"
          }`}>
            {fmtHnt(totals.pendingRewardsHnt)} <span className="text-sm font-sans text-content-secondary">HNT</span>
          </p>
        </div>
        {pendingNum > 0 && (
          <Tooltip content="Approximates historical veHNT with current value. Cliff positions may vary slightly from on-chain.">
            <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-content-tertiary border-b border-dotted border-content-tertiary">
              approx*
            </p>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────────

const SUBDAO_COLOR = { IOT: "text-iot", MOBILE: "text-mobile" };

function StatusPill({ position }) {
  const expired = position.lockup.timeRemainingSecs <= 0;
  const hasPending = Number(position.pendingRewardsHnt || 0) > 0;

  if (expired) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]">
        <span className={`h-1.5 w-1.5 rounded-full ${hasPending ? "bg-amber-500" : "bg-content-tertiary"}`} />
        <span className={hasPending ? "text-amber-700 dark:text-amber-400" : "text-content-tertiary"}>
          Expired{hasPending && " · unclaimed"}
        </span>
      </span>
    );
  }
  if (position.delegation && !position.delegation.purged) {
    const subDaoClass = SUBDAO_COLOR[position.delegation.subDao] ?? "text-accent-text";
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="text-content-secondary">Delegated</span>
        <span className={subDaoClass}>· {position.delegation.subDao}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-content-secondary">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Undelegated
    </span>
  );
}

// ─── Position Card (active) ───────────────────────────────────────────────────

function CliffProgress({ startTs, endTs }) {
  const now = Date.now() / 1000;
  const total = endTs - startTs;
  const elapsed = Math.max(0, Math.min(total, now - startTs));
  const pct = total > 0 ? (elapsed / total) * 100 : 100;
  return (
    <div className="relative h-[3px] w-full bg-surface-inset overflow-hidden rounded-full" aria-hidden="true">
      <div
        className="h-full bg-accent transition-[width] duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function PositionCard({ position, index, total, canClaim, onClaim, claimState }) {
  const {
    positionKey,
    amountLockedHnt,
    lockup,
    veHnt,
    isLandrush,
    landrushMultiplier,
    delegation,
    pendingRewardsHnt,
    pendingRewardsApprox,
    dailyRewardHnt,
    numActiveVotes,
    recentProposalsCount,
    proxy,
  } = position;

  const pendingNum = Number(pendingRewardsHnt || 0);
  const hasPending = pendingNum > 0;
  const { primary: lockupPrimary, secondary: lockupSecondary } = lockupSummary(lockup);

  return (
    <article className="group relative rounded-2xl border border-border bg-surface-raised overflow-hidden transition hover:border-content-tertiary">
      {/* Left edge accent rail */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${
          lockup.timeRemainingSecs <= 0 && hasPending
            ? "bg-amber-500"
            : lockup.timeRemainingSecs <= 0
              ? "bg-border"
              : isLandrush
                ? "bg-amber-400"
                : delegation
                  ? "bg-accent"
                  : "bg-border"
        }`}
        aria-hidden="true"
      />

      {/* Header strip: index + status + landrush seal */}
      <header className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border-muted">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-content-tertiary">
            <span className="tabular-nums text-content-secondary">{String(index + 1).padStart(2, "0")}</span>
            <span className="mx-1">/</span>
            <span className="tabular-nums">{String(total).padStart(2, "0")}</span>
          </span>
          <span className="h-3 w-px bg-border" />
          <StatusPill position={position} />
        </div>
        {isLandrush && (
          <Tooltip content={`Landrush: ${landrushMultiplier}× voting power (permanent historical bonus from the Solana migration genesis)`}>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400">
              <SparklesIcon className="h-3 w-3" />
              Landrush {landrushMultiplier}×
            </span>
          </Tooltip>
        )}
      </header>

      {/* Hero: veHNT voting power */}
      <div className="px-6 pt-5">
        <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-content-tertiary">
          Voting power
        </p>
        <div className="mt-1 flex items-end gap-2">
          <p className="font-display text-[40px] font-semibold text-content tracking-[-0.03em] tabular-nums leading-none">
            {fmtHnt(veHnt, { dp: 0, compact: true })}
          </p>
          <p className="pb-1 text-xs font-display text-content-secondary">veHNT</p>
        </div>
        <p className="mt-1.5 text-xs text-content-secondary">
          <span className="font-mono tabular-nums text-content">{fmtHnt(amountLockedHnt)}</span>{" "}
          HNT locked · <span className={`font-mono text-[11px] uppercase tracking-wider ${
            lockup.kind === "Constant" ? "text-violet-600 dark:text-violet-400" : "text-emerald-600 dark:text-emerald-400"
          }`}>{lockup.kind}</span>
        </p>
      </div>

      {/* Lockup */}
      <div className="px-6 pt-4 pb-5">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="text-sm text-content font-medium">{lockupPrimary}</p>
          <p className="text-[11px] font-mono tabular-nums text-content-tertiary text-right">{lockupSecondary}</p>
        </div>
        {lockup.kind === "Cliff" && <CliffProgress startTs={lockup.startTs} endTs={lockup.endTs} />}
      </div>

      {/* Delegation + rewards */}
      {delegation ? (
        <div className="border-t border-border-muted px-6 py-4 bg-surface-inset/40">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-content-tertiary">
                Pending reward
              </p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className={`font-display text-2xl tracking-[-0.02em] tabular-nums ${
                  hasPending ? "text-content" : "text-content-tertiary"
                }`}>
                  {fmtHnt(pendingRewardsHnt)}
                </span>
                <span className="text-xs font-display text-content-secondary">HNT</span>
                {pendingRewardsApprox === "current-vehnt" && hasPending && (
                  <Tooltip content="Approximates historical veHNT with current value. Cliff positions may vary slightly from on-chain.">
                    <span className="text-[10px] font-mono text-content-tertiary border-b border-dotted border-content-tertiary cursor-help">
                      approx
                    </span>
                  </Tooltip>
                )}
              </div>
              {hasPending && dailyRewardHnt && (
                <p className="mt-1 text-[11px] font-mono tabular-nums text-content-tertiary">
                  ≈ <span className="text-content-secondary">{fmtHnt(dailyRewardHnt)}</span> HNT per epoch
                </p>
              )}
            </div>
            {hasPending && (
              canClaim ? (
                <button
                  onClick={onClaim}
                  disabled={claimState === "signing" || claimState === "sending"}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {claimState === "signing" && <><BoltIcon className="h-3.5 w-3.5 animate-pulse" /> Waiting…</>}
                  {claimState === "sending" && <><BoltIcon className="h-3.5 w-3.5 animate-pulse" /> Broadcasting…</>}
                  {claimState === "claimed" && <><CheckCircleIcon className="h-3.5 w-3.5" /> Claimed</>}
                  {!claimState && <><BoltIcon className="h-3.5 w-3.5" /> Claim</>}
                </button>
              ) : (
                <a
                  href="https://heliumvote.com/hnt/positions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-content-secondary hover:text-content hover:border-content-tertiary transition"
                >
                  Claim on helium.vote
                  <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                </a>
              )
            )}
          </div>
        </div>
      ) : (
        <div className="border-t border-border-muted px-6 py-3 text-xs text-content-tertiary">
          Not delegated ·{" "}
          <a
            href="https://heliumvote.com/hnt/positions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-text hover:opacity-80"
          >
            delegate on helium.vote
          </a>
        </div>
      )}

      {/* Footer: position key + vote activity */}
      <footer className="flex items-center justify-between gap-3 px-6 py-3 border-t border-border-muted text-[11px] text-content-tertiary">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono uppercase tracking-[0.1em] text-[10px]">POS</span>
          <span className="font-mono truncate">{truncateString(positionKey, 5, 4)}</span>
          <CopyButton text={positionKey} size="h-3 w-3" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {proxy && (
            <Tooltip content={`Vote controller: ${proxy.voteController}`}>
              <span className="font-mono uppercase tracking-[0.1em] text-[10px]">
                PROXY · {truncateString(proxy.voteController, 4, 4)}
              </span>
            </Tooltip>
          )}
          {numActiveVotes > 0 && (
            <Tooltip content="Proposals this position is currently casting a vote in">
              <span className="font-mono uppercase tracking-[0.1em] text-[10px] border-b border-dotted border-content-tertiary cursor-help">
                {numActiveVotes} active vote{numActiveVotes === 1 ? "" : "s"}
              </span>
            </Tooltip>
          )}
          {recentProposalsCount > 0 && (
            <Tooltip content="Governance proposals this position has participated in within its recent-proposals tracking window (used for reward eligibility)">
              <span className="font-mono uppercase tracking-[0.1em] text-[10px] border-b border-dotted border-content-tertiary cursor-help">
                {recentProposalsCount} recent proposal{recentProposalsCount === 1 ? "" : "s"}
              </span>
            </Tooltip>
          )}
        </div>
      </footer>
    </article>
  );
}

// ─── Expired table ────────────────────────────────────────────────────────────

function ExpiredPositionRow({ position }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-4 gap-y-1 py-3 px-4 sm:px-6 border-b border-border-muted last:border-0 text-sm">
      <div className="min-w-0">
        <p className="font-mono tabular-nums text-content-secondary">
          {fmtHnt(position.amountLockedHnt)} <span className="text-[11px] text-content-tertiary">HNT</span>
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-tertiary">
          pos {truncateString(position.positionKey, 4, 4)}
        </p>
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-content-tertiary">
        {position.lockup.kind}
      </p>
      <p className="font-mono text-[11px] text-content-tertiary tabular-nums">
        expired {fmtDate(position.lockup.endTs)}
      </p>
      <a
        href="https://heliumvote.com/hnt/positions"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] font-mono uppercase tracking-[0.1em] text-accent-text hover:opacity-80 inline-flex items-center gap-1"
      >
        withdraw
        <ArrowTopRightOnSquareIcon className="h-3 w-3" />
      </a>
    </div>
  );
}

function ExpiredSection({ positions }) {
  const [open, setOpen] = useState(false);
  if (positions.length === 0) return null;
  const totalHnt = positions.reduce((a, p) => a + Number(p.amountLockedHnt || 0), 0);
  return (
    <section className="rounded-2xl border border-border bg-surface-raised">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-surface-inset/50 transition"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-content-tertiary">
            Expired
          </span>
          <span className="h-3 w-px bg-border" />
          <p className="text-sm text-content-secondary">
            <span className="font-mono tabular-nums text-content">{positions.length}</span>{" "}
            {positions.length === 1 ? "position" : "positions"} ·{" "}
            <span className="font-mono tabular-nums">{fmtHnt(totalHnt)}</span> HNT previously locked
          </p>
        </div>
        <ChevronDownIcon className={`h-4 w-4 text-content-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border-muted">
          {positions.map((p) => <ExpiredPositionRow key={p.mint} position={p} />)}
        </div>
      )}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VeHnt() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlWallet = searchParams.get("wallet") || "";
  const [input, setInput] = useState(urlWallet);
  const { publicKey: connectedKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const submittedWallet = useMemo(() => resolveSolanaWallet(input), [input]);
  const submittedWalletStr = submittedWallet?.toBase58() || "";
  const connectedStr = connectedKey?.toBase58() || "";
  const canClaim = Boolean(connectedKey && submittedWalletStr && connectedStr === submittedWalletStr);

  useEffect(() => {
    if (!input && connectedStr) setInput(connectedStr);
  }, [connectedStr, input]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (submittedWalletStr) next.set("wallet", submittedWalletStr);
        else next.delete("wallet");
        return next;
      },
      { replace: true },
    );
  }, [submittedWalletStr, setSearchParams]);

  const { execute: load, result: data, error, loading } = useAsyncCallback(fetchPositions);

  const onSubmit = useCallback(() => {
    if (submittedWalletStr) load(submittedWalletStr);
  }, [submittedWalletStr, load]);

  useEffect(() => {
    if (urlWallet && submittedWalletStr && !data) load(submittedWalletStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [claimStates, setClaimStates] = useState({});
  const [claimErrors, setClaimErrors] = useState({});
  const [claimSignatures, setClaimSignatures] = useState({});

  const handleClaim = useCallback(
    async (position) => {
      if (!connectedKey) return;
      const mint = position.mint;
      setClaimStates((s) => ({ ...s, [mint]: "signing" }));
      setClaimErrors((e) => ({ ...e, [mint]: null }));
      try {
        const { transactions } = await buildClaimTransactions({
          wallet: connectedKey.toBase58(),
          positionMint: mint,
        });
        if (!transactions || transactions.length === 0) {
          setClaimStates((s) => ({ ...s, [mint]: "claimed" }));
          return;
        }
        const sigs = [];
        for (const b64 of transactions) {
          const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
          setClaimStates((s) => ({ ...s, [mint]: "signing" }));
          const sig = await sendTransaction(tx, connection);
          setClaimStates((s) => ({ ...s, [mint]: "sending" }));
          await connection.confirmTransaction(sig, "confirmed");
          sigs.push(sig);
        }
        setClaimSignatures((sg) => ({ ...sg, [mint]: sigs }));
        setClaimStates((s) => ({ ...s, [mint]: "claimed" }));
        setTimeout(() => load(submittedWalletStr), 1500);
      } catch (err) {
        setClaimStates((s) => ({ ...s, [mint]: "error" }));
        setClaimErrors((e) => ({ ...e, [mint]: err?.message || "Claim failed" }));
      }
    },
    [connectedKey, sendTransaction, connection, load, submittedWalletStr],
  );

  // Partition: positions worth user attention (active lockup OR has unclaimed
  // rewards) vs. truly dormant expired ones.
  const { active, expired } = useMemo(() => {
    const active = [];
    const expired = [];
    for (const p of data?.positions || []) {
      const hasPending = Number(p.pendingRewardsHnt || 0) > 0;
      if (p.lockup.timeRemainingSecs > 0 || hasPending) active.push(p);
      else expired.push(p);
    }
    return { active, expired };
  }, [data]);

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="veHNT Positions" />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-12">
        {/* Title */}
        <div className="mb-10">
          <p className="text-[12px] font-mono font-medium uppercase tracking-[0.14em] text-accent-text mb-2">
            HNT Holders · Governance
          </p>
          <h1 className="font-display text-4xl sm:text-[44px] font-bold text-content tracking-[-0.035em] leading-[1.05] mb-3">
            veHNT Positions
          </h1>
          <p className="text-[15px] text-content-secondary max-w-2xl leading-relaxed">
            A read-through ledger for any wallet's staked HNT. Inspect each position's lockup,
            landrush bonus, delegation, and accrued rewards.
          </p>
        </div>

        {/* Wallet input */}
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
          className="mb-8 flex flex-col sm:flex-row gap-3"
        >
          <div className="flex-1">
            <label htmlFor="wallet" className="block text-[11px] font-mono uppercase tracking-[0.14em] text-content-tertiary mb-1.5">
              Wallet address
            </label>
            <input
              id="wallet"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste a Helium or Solana wallet address"
              className="block w-full rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 font-mono text-xs text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex items-end gap-2">
            <WalletMultiButton style={{ borderRadius: "8px", height: "44px", fontSize: "14px" }} />
            <button
              type="submit"
              disabled={!submittedWalletStr || loading}
              className="h-[44px] inline-flex items-center justify-center rounded-lg bg-accent px-5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
            >
              {loading ? "Loading…" : "Analyze"}
            </button>
          </div>
        </form>

        {error && (
          <div className="mb-6">
            <StatusBanner tone="error" message={error.message || "Request failed"} />
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <SummaryHeader totals={data.totals} currentEpoch={data.currentEpoch} />

            {data.positions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-12 text-center">
                <LockClosedIcon className="h-10 w-10 mx-auto text-content-tertiary mb-3" />
                <h3 className="font-display text-lg font-semibold text-content">No veHNT positions</h3>
                <p className="mt-1 text-sm text-content-secondary">
                  This wallet has no HNT staked.{" "}
                  <a
                    href="https://heliumvote.com/hnt/positions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-text hover:opacity-80"
                  >
                    Stake on helium.vote →
                  </a>
                </p>
              </div>
            ) : (
              <>
                {active.length > 0 && (
                  <section>
                    <header className="mb-3 flex items-baseline justify-between">
                      <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
                        Active positions · <span className="tabular-nums text-content-secondary">{active.length}</span>
                      </h2>
                      {canClaim && (
                        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-accent-text">
                          Connected — you can claim
                        </p>
                      )}
                    </header>
                    <div className="grid gap-4 md:grid-cols-2">
                      {active.map((p, i) => (
                        <PositionCard
                          key={p.mint}
                          position={p}
                          index={i}
                          total={active.length}
                          canClaim={canClaim}
                          onClaim={() => handleClaim(p)}
                          claimState={claimStates[p.mint]}
                        />
                      ))}
                    </div>
                  </section>
                )}

                <ExpiredSection positions={expired} />
              </>
            )}

            {/* Claim feedback */}
            {Object.entries(claimErrors)
              .filter(([, msg]) => msg)
              .map(([mint, msg]) => (
                <StatusBanner
                  key={mint}
                  tone="error"
                  message={`Claim failed for ${truncateString(mint, 6, 4)}: ${msg}`}
                />
              ))}

            {Object.entries(claimSignatures).map(([mint, sigs]) => (
              <div key={mint} className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                <span className="font-mono uppercase tracking-widest text-[10px] mr-2">Claimed</span>
                <span className="font-mono">{truncateString(mint, 6, 4)}</span>
                <span className="mx-2 text-emerald-500">·</span>
                {sigs.map((s, i) => (
                  <a
                    key={s}
                    href={`https://solscan.io/tx/${s}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:opacity-80 font-mono"
                  >
                    {truncateString(s, 6, 4)}
                    {i < sigs.length - 1 && ", "}
                  </a>
                ))}
              </div>
            ))}
          </div>
        )}

        {!data && !loading && !error && (
          <div className="rounded-2xl border border-dashed border-border px-8 py-14 text-center">
            <p className="font-display text-lg text-content mb-1">
              Inspect any HNT holder's ledger.
            </p>
            <p className="text-sm text-content-secondary max-w-md mx-auto">
              Paste a wallet address above or connect your own to see staked positions,
              lockups, delegation, and pending rewards.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
