import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  CheckBadgeIcon,
} from "@heroicons/react/24/outline";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import Header from "../components/Header.jsx";
import CopyButton from "../components/CopyButton.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import Tooltip from "../components/Tooltip.jsx";
import { readChartColors } from "../lib/chartColors.js";
import useDarkMode from "../lib/useDarkMode.js";
import { numberFormatter, truncateString } from "../lib/utils.js";
import { fetchProposal, fetchVotes, fetchActivity, fetchHistory } from "../lib/voteApi.js";

// The vote this blind page is built for. /vote with no id falls back to it.
const DEFAULT_PROPOSAL = "4zLh9V1wiZJ3GffytCnqQA9FX1VQSM3kXxx22RpzPXWo";
// The worker snapshots on a ~15-min cron and serves everyone from cache, so
// there's no value in viewers polling fast — these just refresh the view.
const POLL_MS = 60_000;
const HISTORY_POLL_MS = 5 * 60_000;

// ─── formatting ────────────────────────────────────────────────────────────

function fmtVeHnt(n, { compact = true } = {}) {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (compact && v >= 1_000_000) {
    return (v / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M";
  }
  if (compact && v >= 10_000) {
    const k = Math.round(v / 1000);
    return k >= 1000
      ? (k / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M"
      : k.toLocaleString() + "k";
  }
  if (v < 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtDate(unixSec) {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function relTime(unixSec) {
  if (!unixSec) return "—";
  const diff = Math.floor(Date.now() / 1000 - unixSec);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(unixSec);
}

const STATUS_META = {
  active:    { label: "Voting open", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", pulse: true },
  passed:    { label: "Passed",      dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  failed:    { label: "Failed",      dot: "bg-rose-500",    text: "text-rose-600 dark:text-rose-400" },
  completed: { label: "Resolved",    dot: "bg-violet-500",  text: "text-violet-600 dark:text-violet-400" },
  cancelled: { label: "Cancelled",   dot: "bg-content-tertiary", text: "text-content-tertiary" },
  draft:     { label: "Draft",       dot: "bg-amber-400",   text: "text-amber-600 dark:text-amber-400" },
  unknown:   { label: "Unknown",     dot: "bg-content-tertiary", text: "text-content-tertiary" },
};

// Choice color: For/Yes → emerald, Against/No → rose, otherwise cycle accents.
const NEUTRAL_TONES = [
  { text: "text-sky-600 dark:text-sky-400", bar: "bg-sky-500" },
  { text: "text-violet-600 dark:text-violet-400", bar: "bg-violet-500" },
  { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
  { text: "text-pink-600 dark:text-pink-400", bar: "bg-pink-500" },
];
function choiceTone(name, index) {
  const n = (name || "").toLowerCase();
  if (n.startsWith("for") || n.startsWith("yes")) {
    return { text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" };
  }
  if (n.startsWith("against") || n.startsWith("no")) {
    return { text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500" };
  }
  return NEUTRAL_TONES[index % NEUTRAL_TONES.length];
}

// recharts strokes take hex, not Tailwind classes — keep this palette aligned
// with choiceTone above.
const NEUTRAL_HEX = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#ec4899"];
function choiceHex(name, index) {
  const n = (name || "").toLowerCase();
  if (n.startsWith("for") || n.startsWith("yes")) return "#10b981";
  if (n.startsWith("against") || n.startsWith("no")) return "#f43f5e";
  return NEUTRAL_HEX[index % NEUTRAL_HEX.length];
}

// ─── results ─────────────────────────────────────────────────────────────────

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em]">
      <span className={`relative flex h-2 w-2`}>
        {meta.pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${meta.dot} opacity-60`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
      </span>
      <span className={meta.text}>{meta.label}</span>
    </span>
  );
}

function ChoiceBar({ choice, isWinner, isResolved }) {
  const tone = choiceTone(choice.name, choice.index);
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-sm font-medium truncate ${isWinner ? tone.text : "text-content"}`}>
            {choice.name}
          </span>
          {isWinner && isResolved && (
            <Tooltip content="Winning choice">
              <CheckBadgeIcon className={`h-4 w-4 ${tone.text}`} />
            </Tooltip>
          )}
        </div>
        <div className="flex items-baseline gap-2 shrink-0 font-mono tabular-nums">
          <span className="text-sm font-semibold text-content">{choice.percent.toFixed(2)}%</span>
          <span className="text-[11px] text-content-tertiary">{fmtVeHnt(choice.veHnt)} veHNT</span>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-inset">
        <div
          className={`h-full rounded-full ${tone.bar} transition-[width] duration-700 ${isWinner ? "" : "opacity-70"}`}
          style={{ width: `${Math.max(choice.percent, choice.percent > 0 ? 1.5 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function OutcomeCard({ proposal, votes }) {
  const isResolved = ["passed", "failed", "completed"].includes(proposal.status);
  const winners = new Set(
    proposal.winningChoices && proposal.winningChoices.length
      ? proposal.winningChoices
      : proposal.leadingIndex >= 0 ? [proposal.leadingIndex] : [],
  );
  const choices = proposal.choices || [];
  const sorted = useMemo(
    () => [...choices].sort((a, b) => b.percent - a.percent),
    [choices],
  );

  return (
    <div className="rounded-2xl border border-border bg-surface-raised">
      <div className="grid grid-cols-2 divide-x divide-border-muted border-b border-border-muted">
        <div className="px-6 py-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-content-tertiary">
            Total voting power
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-content tabular-nums leading-none">
            {fmtVeHnt(proposal.totalVeHnt)}
            <span className="ml-1.5 text-sm font-sans text-content-secondary">veHNT</span>
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-content-tertiary">
            Voters
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-content tabular-nums leading-none">
            {votes ? numberFormatter.format(votes.uniqueVoters) : "—"}
            {votes && votes.markerCount !== votes.uniqueVoters && (
              <span className="ml-1.5 text-sm font-sans text-content-secondary">
                · {numberFormatter.format(votes.markerCount)} positions
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="px-6 py-3 divide-y divide-border-muted">
        {sorted.map((choice) => (
          <ChoiceBar
            key={choice.index}
            choice={choice}
            isWinner={winners.has(choice.index)}
            isResolved={isResolved}
          />
        ))}
      </div>
    </div>
  );
}

// ─── voter roster ─────────────────────────────────────────────────────────────

function choiceNames(indices, proposal) {
  return indices
    .map((i) => proposal.choices[i]?.name ?? `#${i}`)
    .join(", ");
}

function VoterRoster({ proposal, votes, error }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-raised">
      <header className="flex items-baseline justify-between gap-3 px-5 py-3.5 border-b border-border-muted">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
          Voters
        </h2>
        {votes && (
          <span className="font-mono text-[11px] text-content-tertiary tabular-nums">
            {numberFormatter.format(votes.markerCount)} position{votes.markerCount === 1 ? "" : "s"}
            {votes.truncated && ` · top ${numberFormatter.format(votes.returned)}`}
          </span>
        )}
      </header>
      {error ? (
        <p className="px-5 py-6 text-sm text-content-tertiary">Couldn't load voters.</p>
      ) : !votes ? (
        <p className="px-5 py-6 text-sm text-content-tertiary">Loading voters…</p>
      ) : votes.votes.length === 0 ? (
        <p className="px-5 py-6 text-sm text-content-tertiary">
          No open vote markers.{" "}
          {proposal.status !== "active" &&
            "Markers are closed after a proposal resolves — the tallies above remain authoritative."}
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-inset z-10">
              <tr className="text-left text-content-tertiary font-mono uppercase tracking-[0.08em] text-[10px]">
                <th className="px-5 py-2 font-medium">Voter</th>
                <th className="px-3 py-2 font-medium">Choice</th>
                <th className="px-5 py-2 font-medium text-right">veHNT</th>
              </tr>
            </thead>
            <tbody>
              {votes.votes.map((v) => {
                const tone = choiceTone(proposal.choices[v.choices[0]]?.name, v.choices[0] ?? 0);
                return (
                  <tr key={v.mint} className="border-t border-border-muted hover:bg-surface-inset/40">
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`https://solscan.io/account/${v.voter}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-content-secondary hover:text-content"
                        >
                          {truncateString(v.voter, 4, 4)}
                        </a>
                        <CopyButton text={v.voter} size="h-3 w-3" />
                        {v.proxyIndex > 0 && (
                          <Tooltip content="Cast via a vote proxy / delegation">
                            <span className="font-mono text-[9px] uppercase tracking-wide text-content-tertiary border border-border-muted rounded px-1">
                              proxy
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`font-medium ${tone.text}`}>
                        {choiceNames(v.choices, proposal)}
                      </span>
                    </td>
                    <td className="px-5 py-2 text-right font-mono tabular-nums text-content">
                      {fmtVeHnt(v.veHnt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── activity feed ────────────────────────────────────────────────────────────

function ActivityFeed({ activity, error }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-raised">
      <header className="flex items-baseline justify-between gap-3 px-5 py-3.5 border-b border-border-muted">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
          Recent activity
        </h2>
        <Tooltip content="On-chain transactions that touched this proposal (votes, resolution). Each vote writes the proposal account.">
          <span className="font-mono text-[10px] uppercase tracking-wide text-content-tertiary border-b border-dotted border-content-tertiary cursor-help">
            on-chain
          </span>
        </Tooltip>
      </header>
      {error ? (
        <p className="px-5 py-6 text-sm text-content-tertiary">Couldn't load activity.</p>
      ) : !activity ? (
        <p className="px-5 py-6 text-sm text-content-tertiary">Loading activity…</p>
      ) : activity.activity.length === 0 ? (
        <p className="px-5 py-6 text-sm text-content-tertiary">No recent transactions.</p>
      ) : (
        <ul className="max-h-[28rem] overflow-y-auto divide-y divide-border-muted">
          {activity.activity.map((a) => (
            <li key={a.signature} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                {a.success ? (
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <XCircleIcon className="h-4 w-4 shrink-0 text-rose-500" />
                )}
                <a
                  href={`https://solscan.io/tx/${a.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-content-secondary hover:text-content truncate"
                >
                  {truncateString(a.signature, 6, 6)}
                </a>
                <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0 text-content-tertiary" />
              </div>
              <span className="font-mono text-[11px] text-content-tertiary tabular-nums shrink-0">
                {relTime(a.blockTime)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── trend chart ──────────────────────────────────────────────────────────────

function fmtAxisTime(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const VoteTrendChart = memo(function VoteTrendChart({ history, proposal }) {
  const dark = useDarkMode();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colors = useMemo(() => readChartColors(), [dark]);
  const points = history?.points || [];
  const voteCount = history?.total ?? points.length;

  const series = useMemo(
    () =>
      (proposal?.choices || []).map((c) => ({
        key: `c${c.index}`,
        name: c.name,
        color: choiceHex(c.name, c.index),
      })),
    [proposal?.choices],
  );

  // One row per vote (precise blockTime). Every choice gets a value on every
  // row (0 until its first vote) so the cumulative step-lines stay continuous.
  // Seed a zero point at voting-open so each line starts at the baseline.
  const data = useMemo(() => {
    const indices = (proposal?.choices || []).map((c) => c.index);
    const rows = points.map((pt) => {
      const byIdx = new Map((pt.choices || []).map((c) => [c.index, c.veHnt]));
      const row = { t: pt.ts * 1000 };
      for (const idx of indices) row[`c${idx}`] = byIdx.get(idx) ?? 0;
      return row;
    });
    const startSec = proposal?.startTs || proposal?.createdAt;
    if (startSec && rows.length && rows[0].t > startSec * 1000) {
      const seed = { t: startSec * 1000 };
      for (const idx of indices) seed[`c${idx}`] = 0;
      rows.unshift(seed);
    }
    return rows;
  }, [points, proposal?.choices, proposal?.startTs, proposal?.createdAt]);

  if (data.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-surface-raised px-6 py-10 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary mb-1">
          Vote trend
        </p>
        <p className="text-sm text-content-secondary">
          Collecting data — the worker records each vote at its on-chain time and
          refreshes every ~15 minutes. The chart fills in shortly.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface-raised">
      <header className="flex items-baseline justify-between gap-3 px-5 py-3.5 border-b border-border-muted">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
          Vote trend · veHNT over time
        </h2>
        <span className="font-mono text-[10px] text-content-tertiary tabular-nums">
          {voteCount} vote{voteCount === 1 ? "" : "s"}
        </span>
      </header>
      <div className="px-2 py-4" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={colors?.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtAxisTime}
              stroke={colors?.tickText}
              tick={{ fontSize: 11 }}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={(v) => fmtVeHnt(v)}
              stroke={colors?.tickText}
              tick={{ fontSize: 11 }}
              width={48}
            />
            <RechartsTooltip
              contentStyle={{
                background: colors?.tooltipBg,
                border: `1px solid ${colors?.tooltipBorder}`,
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: colors?.tooltipText }}
              itemStyle={{ color: colors?.tooltipText }}
              labelFormatter={(t) => new Date(t).toLocaleString()}
              formatter={(val, key) => {
                const s = series.find((x) => x.key === key);
                return [`${fmtVeHnt(val)} veHNT`, s?.name || key];
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="stepAfter"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-4">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-content-secondary">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </section>
  );
});

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Vote() {
  const params = useParams();
  const proposalId = params.proposalId || DEFAULT_PROPOSAL;

  const [proposal, setProposal] = useState(null);
  const [votes, setVotes] = useState(null);
  const [activity, setActivity] = useState(null);
  const [history, setHistory] = useState(null);
  const [proposalError, setProposalError] = useState(null);
  const [votesError, setVotesError] = useState(null);
  const [activityError, setActivityError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Keep the latest id in a ref so the polling effect doesn't restart on every
  // render but always fetches the current proposal.
  const idRef = useRef(proposalId);
  idRef.current = proposalId;

  const refresh = useCallback(async () => {
    const id = idRef.current;
    setRefreshing(true);
    try {
      const [p, v, a] = await Promise.allSettled([
        fetchProposal(id),
        fetchVotes(id),
        fetchActivity(id),
      ]);
      if (idRef.current !== id) return; // a newer proposal was selected meanwhile
      if (p.status === "fulfilled") { setProposal(p.value); setProposalError(null); }
      else setProposalError(p.reason);
      if (v.status === "fulfilled") { setVotes(v.value); setVotesError(null); }
      else setVotesError(v.reason);
      if (a.status === "fulfilled") { setActivity(a.value); setActivityError(null); }
      else setActivityError(a.reason);
    } finally {
      if (idRef.current === id) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  // History changes slowly (one point per ~15 min), so poll it on its own,
  // gentler cadence. Failures are non-fatal — the chart just stays as-is.
  const refreshHistory = useCallback(async () => {
    const id = idRef.current;
    try {
      const h = await fetchHistory(id);
      if (idRef.current === id) setHistory(h);
    } catch {
      /* keep prior history */
    }
  }, []);

  // Initial load + reset when the proposal changes.
  useEffect(() => {
    setProposal(null); setVotes(null); setActivity(null); setHistory(null);
    setProposalError(null); setVotesError(null); setActivityError(null);
    setLoading(true);
    refresh();
    refreshHistory();
  }, [proposalId, refresh, refreshHistory]);

  // Auto-refresh while the tab is visible.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) refreshHistory();
    }, HISTORY_POLL_MS);
    return () => clearInterval(interval);
  }, [refreshHistory]);

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Vote" />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-10">
        {loading && !proposal && (
          <div className="rounded-2xl border border-dashed border-border px-8 py-16 text-center">
            <p className="text-sm text-content-secondary">Loading proposal…</p>
          </div>
        )}

        {proposalError && !proposal && (
          <StatusBanner tone="error" message={proposalError.message || "Failed to load proposal."} />
        )}

        {proposal?.warming && (
          <div className="rounded-2xl border border-dashed border-border px-8 py-16 text-center">
            <p className="text-sm text-content-secondary">
              Warming up — the worker is fetching this proposal for the first time.
              It’ll appear in a few seconds.
            </p>
          </div>
        )}

        {proposal && !proposal.warming && (
          <div className="space-y-6">
            {/* Title block */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <StatusPill status={proposal.status} />
                <div className="flex items-center gap-3">
                  <Tooltip content="Polled on-chain by the worker on a schedule (~every 15 min) and served from cache — so viewing this page doesn't hit the RPC.">
                    <span className="font-mono text-[11px] text-content-tertiary tabular-nums border-b border-dotted border-content-tertiary cursor-help">
                      {proposal.snapshotAt ? `data ${relTime(Math.floor(proposal.snapshotAt / 1000))}` : ""}
                    </span>
                  </Tooltip>
                  <button
                    onClick={() => refresh()}
                    disabled={refreshing}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wide text-content-secondary hover:text-content hover:border-content-tertiary transition disabled:opacity-50"
                    aria-label="Refresh"
                  >
                    <ArrowPathIcon className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold text-content tracking-[-0.03em] leading-tight">
                {proposal.name || truncateString(proposal.address, 6, 6)}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-content-tertiary font-mono">
                <span>Created {fmtDate(proposal.createdAt)}</span>
                {proposal.status === "active" && proposal.startTs && (
                  <span>· Opened {fmtDate(proposal.startTs)}</span>
                )}
                {proposal.endTs && <span>· Ended {fmtDate(proposal.endTs)}</span>}
                {proposal.tags?.map((t) => (
                  <span key={t} className="rounded-full border border-border-muted px-2 py-0.5 text-[10px] uppercase tracking-wide">
                    {t}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1">
                  <a
                    href={`https://heliumvote.com/hnt/proposals/${proposal.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-text hover:opacity-80 inline-flex items-center gap-1"
                  >
                    View on Helium Vote
                    <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                  </a>
                </span>
              </div>
            </div>

            <OutcomeCard proposal={proposal} votes={votes} />

            <VoteTrendChart history={history} proposal={proposal} />

            <div className="grid gap-6 lg:grid-cols-2">
              <VoterRoster proposal={proposal} votes={votes} error={votesError} />
              <ActivityFeed activity={activity} error={activityError} />
            </div>

            {proposal.content?.text && (
              <details className="rounded-2xl border border-border bg-surface-raised">
                <summary className="cursor-pointer px-6 py-4 font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary hover:text-content-secondary">
                  Proposal details
                </summary>
                <div className="border-t border-border-muted px-6 py-4">
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-content-secondary leading-relaxed">
                    {proposal.content.text}
                  </pre>
                  {proposal.content.truncated && (
                    <p className="mt-3 text-[11px] text-content-tertiary">
                      Truncated —{" "}
                      <a
                        href={`https://heliumvote.com/hnt/proposals/${proposal.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-text hover:opacity-80"
                      >
                        read the full proposal
                      </a>
                      .
                    </p>
                  )}
                </div>
              </details>
            )}

            <p className="text-center text-[11px] font-mono text-content-tertiary">
              Read directly from the Solana chain ·{" "}
              <a
                href={`https://solscan.io/account/${proposal.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-content-secondary"
              >
                {truncateString(proposal.address, 6, 6)}
              </a>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
