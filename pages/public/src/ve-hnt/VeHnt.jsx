import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAsyncCallback } from "react-async-hook";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Address from "@helium/address";
import {
  ArrowTopRightOnSquareIcon,
  BoltIcon,
  CheckCircleIcon,
  ClockIcon,
  LockClosedIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import CopyButton from "../components/CopyButton.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import Tooltip from "../components/Tooltip.jsx";
import { formatDuration, numberFormatter, truncateString } from "../lib/utils.js";
import { fetchPositions, buildClaimTransactions } from "../lib/veHntApi.js";

const inputClassName =
  "block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

function resolveSolanaWallet(input) {
  if (!input) return null;
  const trimmed = input.trim();
  try {
    return new PublicKey(trimmed);
  } catch {
    try {
      return new PublicKey(Address.fromB58(trimmed).publicKey);
    } catch {
      return null;
    }
  }
}

function fmtHnt(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  if (n < 1) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function SummaryHeader({ totals, currentEpoch, cached }) {
  const stats = [
    { label: "Positions", value: numberFormatter.format(totals.positionCount) },
    { label: "HNT Locked", value: fmtHnt(totals.hntLocked) },
    { label: "veHNT", value: fmtHnt(totals.veHnt) },
    { label: "Pending Rewards", value: `${fmtHnt(totals.pendingRewardsHnt)} HNT` },
  ];
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-xs font-mono uppercase tracking-widest text-content-tertiary">
              {s.label}
            </p>
            <p className="mt-1 text-xl font-semibold text-content">{s.value}</p>
          </div>
        ))}
      </div>
      {cached && (
        <p className="mt-4 text-xs text-content-tertiary">
          Current epoch {currentEpoch} · veHNT snapshot as of {new Date().toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

// ─── Position Card ────────────────────────────────────────────────────────────

function LockupMeter({ startTs, endTs, kind }) {
  const now = Date.now() / 1000;
  const total = endTs - startTs;
  const elapsed = Math.max(0, Math.min(total, now - startTs));
  const pct = total > 0 ? (elapsed / total) * 100 : 100;
  const isConstant = kind === "Constant";
  return (
    <div>
      <div className="h-2 w-full rounded-full bg-surface-inset overflow-hidden">
        <div
          className={`h-full rounded-full ${isConstant ? "bg-amber-400" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PositionCard({ position, canClaim, onClaim, claimState }) {
  const {
    mint,
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

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-content">
              {fmtHnt(amountLockedHnt)} HNT
            </h3>
            <span className="text-xs text-content-tertiary">locked</span>
            {isLandrush && (
              <Tooltip content={`Landrush bonus: ${landrushMultiplier}× voting power until genesis end`}>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-800/50">
                  <SparklesIcon className="h-3 w-3" />
                  Landrush {landrushMultiplier}×
                </span>
              </Tooltip>
            )}
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              lockup.kind === "Constant"
                ? "bg-violet-50 text-violet-700 ring-1 ring-violet-100 dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-800/50"
                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-800/50"
            }`}>
              <LockClosedIcon className="h-3 w-3" /> {lockup.kind}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-content-tertiary">
            <span className="font-mono">{truncateString(positionKey, 6, 4)}</span>
            <CopyButton text={positionKey} size="h-3 w-3" />
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-mono uppercase tracking-widest text-content-tertiary">
            veHNT
          </p>
          <p className="text-xl font-semibold text-content">{fmtHnt(veHnt)}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-content-secondary mb-1.5">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="h-3.5 w-3.5" />
            {lockup.timeRemainingSecs > 0 ? formatDuration(lockup.timeRemainingSecs) : "Expired"}
            {lockup.kind === "Constant" && lockup.timeRemainingSecs > 0 && " min"}
          </span>
          <span className="text-content-tertiary">
            {new Date(lockup.startTs * 1000).toLocaleDateString()} → {new Date(lockup.endTs * 1000).toLocaleDateString()}
          </span>
        </div>
        <LockupMeter startTs={lockup.startTs} endTs={lockup.endTs} kind={lockup.kind} />
      </div>

      {/* Delegation + rewards */}
      {delegation ? (
        <div className="rounded-lg border border-border-muted bg-surface-inset p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-widest text-content-tertiary">
              Delegation
            </span>
            <span className="text-sm font-medium text-content">
              {delegation.subDao}
              {delegation.purged && <span className="ml-2 text-xs text-rose-500">purged</span>}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-content-tertiary">Pending rewards</p>
              <p className={`font-mono ${hasPending ? "text-content" : "text-content-tertiary"}`}>
                {fmtHnt(pendingRewardsHnt)} HNT
                {pendingRewardsApprox === "current-vehnt" && (
                  <Tooltip content="Approximates historical veHNT with current value. Actual rewards may differ slightly for Cliff positions.">
                    <span className="ml-1 text-content-tertiary">*</span>
                  </Tooltip>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-content-tertiary">≈ Daily</p>
              <p className="font-mono text-content-secondary">
                {fmtHnt(dailyRewardHnt)} HNT
              </p>
            </div>
          </div>
          {delegation.unclaimedEpochs > 0 && (
            <p className="text-xs text-content-tertiary">
              {delegation.unclaimedEpochs} unclaimed {delegation.unclaimedEpochs === 1 ? "epoch" : "epochs"}
            </p>
          )}
          {canClaim && hasPending && (
            <button
              onClick={onClaim}
              disabled={claimState === "signing" || claimState === "sending"}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
            >
              <BoltIcon className="h-4 w-4" />
              {claimState === "signing" && "Waiting for wallet…"}
              {claimState === "sending" && "Broadcasting…"}
              {claimState === "claimed" && (
                <>
                  <CheckCircleIcon className="h-4 w-4" /> Claimed
                </>
              )}
              {!claimState && "Claim rewards"}
            </button>
          )}
          {!canClaim && hasPending && (
            <a
              href={`https://heliumvote.com/hnt/positions`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:text-content hover:border-content-tertiary transition"
            >
              Claim on helium.vote
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border-muted p-3">
          <p className="text-xs text-content-tertiary">
            Not delegated — this position earns no delegation rewards.{" "}
            <a
              href="https://heliumvote.com/hnt/positions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-text hover:opacity-80"
            >
              Delegate on helium.vote
            </a>
          </p>
        </div>
      )}

      {/* Voting activity */}
      {(numActiveVotes > 0 || recentProposalsCount > 0 || proxy) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-content-secondary">
          {proxy && (
            <span className="inline-flex items-center gap-1">
              Proxy:
              <span className="font-mono">{truncateString(proxy.voteController, 4, 4)}</span>
              <CopyButton text={proxy.voteController} size="h-3 w-3" />
            </span>
          )}
          {numActiveVotes > 0 && <span>{numActiveVotes} active {numActiveVotes === 1 ? "vote" : "votes"}</span>}
          {recentProposalsCount > 0 && <span>{recentProposalsCount} recent proposals</span>}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VeHnt() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlWallet = searchParams.get("wallet") || "";
  const [input, setInput] = useState(urlWallet);
  const { publicKey: connectedKey } = useWallet();
  const { connection } = useConnection();

  const submittedWallet = useMemo(() => resolveSolanaWallet(input), [input]);
  const submittedWalletStr = submittedWallet?.toBase58() || "";
  const connectedStr = connectedKey?.toBase58() || "";
  const canClaim = Boolean(connectedKey && submittedWalletStr && connectedStr === submittedWalletStr);

  // Auto-populate paste input with connected wallet if input is empty
  useEffect(() => {
    if (!input && connectedStr) {
      setInput(connectedStr);
    }
  }, [connectedStr, input]);

  // Sync ?wallet= URL param
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

  const {
    execute: load,
    result: data,
    error,
    loading,
  } = useAsyncCallback(fetchPositions);

  // Fire on submit
  const onSubmit = useCallback(() => {
    if (submittedWalletStr) load(submittedWalletStr);
  }, [submittedWalletStr, load]);

  // Auto-load on URL-provided wallet
  useEffect(() => {
    if (urlWallet && submittedWalletStr && !data) {
      load(submittedWalletStr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Claim state: Map<positionMint, "signing"|"sending"|"claimed"|"error">
  const [claimStates, setClaimStates] = useState({});
  const [claimErrors, setClaimErrors] = useState({});
  const [claimSignatures, setClaimSignatures] = useState({});

  const { publicKey: walletPk, sendTransaction } = useWallet();

  const handleClaim = useCallback(
    async (position) => {
      if (!walletPk) return;
      const mint = position.mint;
      setClaimStates((s) => ({ ...s, [mint]: "signing" }));
      setClaimErrors((e) => ({ ...e, [mint]: null }));
      try {
        const { transactions } = await buildClaimTransactions({
          wallet: walletPk.toBase58(),
          positionMint: mint,
        });
        if (!transactions || transactions.length === 0) {
          setClaimStates((s) => ({ ...s, [mint]: "claimed" }));
          return;
        }
        const sigs = [];
        for (const b64 of transactions) {
          const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
          setClaimStates((s) => ({ ...s, [mint]: "signing" }));
          const sig = await sendTransaction(tx, connection);
          setClaimStates((s) => ({ ...s, [mint]: "sending" }));
          await connection.confirmTransaction(sig, "confirmed");
          sigs.push(sig);
        }
        setClaimSignatures((sg) => ({ ...sg, [mint]: sigs }));
        setClaimStates((s) => ({ ...s, [mint]: "claimed" }));
        // Refresh after confirmation
        setTimeout(() => load(submittedWalletStr), 1500);
      } catch (err) {
        setClaimStates((s) => ({ ...s, [mint]: "error" }));
        setClaimErrors((e) => ({ ...e, [mint]: err?.message || "Claim failed" }));
      }
    },
    [walletPk, sendTransaction, connection, load, submittedWalletStr],
  );

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="veHNT Positions" />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <p className="text-[13px] font-mono font-medium uppercase tracking-[0.08em] text-accent-text mb-2">
            HNT Holders
          </p>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-content tracking-[-0.03em] mb-2">
            veHNT Positions
          </h1>
          <p className="text-base text-content-secondary">
            Analyze staked HNT positions on any Solana wallet. See lockup status, landrush
            bonus, delegation, and pending delegation rewards.
          </p>
        </div>

        {/* Wallet input + connect */}
        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="wallet" className="block text-sm font-medium text-content-secondary mb-1.5">
              Wallet address
            </label>
            <input
              id="wallet"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              placeholder="Helium or Solana address"
              className={`${inputClassName} font-mono text-xs`}
            />
          </div>
          <div className="flex items-end gap-2">
            <WalletMultiButton style={{ borderRadius: "8px", height: "42px", fontSize: "14px" }} />
            <button
              onClick={onSubmit}
              disabled={!submittedWalletStr || loading}
              className="h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
            >
              {loading ? "Loading…" : "Analyze"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6">
            <StatusBanner tone="error" message={error.message || "Request failed"} />
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <SummaryHeader totals={data.totals} currentEpoch={data.currentEpoch} cached />

            {data.positions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-12 text-center">
                <LockClosedIcon className="h-10 w-10 mx-auto text-content-tertiary mb-3" />
                <h3 className="text-base font-semibold text-content">No veHNT positions</h3>
                <p className="mt-1 text-sm text-content-secondary">
                  This wallet has no HNT staked.{" "}
                  <a
                    href="https://heliumvote.com/hnt/positions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-text hover:opacity-80"
                  >
                    Stake on helium.vote
                  </a>
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {data.positions.map((p) => (
                  <PositionCard
                    key={p.mint}
                    position={p}
                    canClaim={canClaim}
                    onClaim={() => handleClaim(p)}
                    claimState={claimStates[p.mint]}
                  />
                ))}
              </div>
            )}

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
              <div key={mint} className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-700 dark:text-emerald-300">
                Claimed {truncateString(mint, 6, 4)} —{" "}
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
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <p className="text-sm text-content-secondary">
              Paste any HNT holder's wallet address — or connect your own — to see their
              staked positions and rewards.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
