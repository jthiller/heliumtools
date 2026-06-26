import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  ChevronDownIcon,
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
import { fetchProposal, fetchVotes, fetchActivity, fetchHistory, fetchVoterHistory } from "../lib/voteApi.js";

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

function ChoiceBar({ choice, isWinner, isResolved, voterCount }) {
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
          {voterCount != null && (
            <span className="text-[11px] text-content-tertiary">
              · {numberFormatter.format(voterCount)} {voterCount === 1 ? "voter" : "voters"}
            </span>
          )}
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

// --- Governance thresholds for this proposal ---------------------------------
// Approval: a choice passes with a two-thirds (66%) supermajority of votes CAST.
// Quorum: minimum participation as a share of total circulating veHNT — set this
// once we have the figure and the quorum line/verdict light up automatically.
const APPROVAL_THRESHOLD_PCT = 66;
const QUORUM_THRESHOLD_PCT = null; // e.g. 33 ⇒ "33% of circulating must vote"

// The choice that "approval" refers to (the For/Yes side of a yes-no proposal).
function approvalChoice(choices) {
  return (choices || []).find((c) => /^(for|yes|approve|in favor)/i.test(c.name || "")) || null;
}

// Election-night approval meter: For as a share of votes CAST against a fixed
// 66% "to pass" line — like watching a tally climb toward 270. Only shown for
// yes-no proposals (where a For/Yes choice exists).
function ApprovalMeter({ proposal }) {
  const voted = proposal.totalVeHnt || 0;
  const forChoice = approvalChoice(proposal.choices);
  if (!forChoice || !(voted > 0)) return null;

  const forPct = (forChoice.veHnt / voted) * 100;
  const passing = forPct >= APPROVAL_THRESHOLD_PCT;
  const isResolved = ["passed", "failed", "completed"].includes(proposal.status);
  const label = isResolved
    ? (passing ? "Passed" : "Did not pass")
    : (passing ? "On track to pass" : "Below threshold");

  // Order the combined bar For → others → Against so the green grows from the
  // left toward the 66% line and the red anchors the right, election-night style.
  const choices = proposal.choices || [];
  const isAgainst = (c) => /^(against|no)\b/i.test(c.name || "");
  const ordered = [
    forChoice,
    ...choices.filter((c) => c !== forChoice && !isAgainst(c)),
    ...choices.filter((c) => c !== forChoice && isAgainst(c)),
  ].filter((c) => c.veHnt > 0);

  return (
    <div className="px-6 py-5 border-b border-border-muted">
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-mono uppercase tracking-wide ${
          passing
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        }`}>
          {label}
        </span>
        <span className="text-xs text-content-secondary tabular-nums">
          <span className="font-semibold text-content">{forPct.toFixed(1)}%</span>
          {" "}{forChoice.name} · {APPROVAL_THRESHOLD_PCT}% to pass
        </span>
      </div>
      <div className="relative mt-2.5">
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-inset"
          role="img" aria-label={`${forChoice.name} ${forPct.toFixed(1)}% of votes cast; ${APPROVAL_THRESHOLD_PCT}% needed to pass`}>
          {ordered.map((c) => (
            <div
              key={c.index}
              className={`${choiceTone(c.name, c.index).bar} h-full`}
              style={{ width: `${(c.veHnt / voted) * 100}%` }}
              title={`${c.name}: ${((c.veHnt / voted) * 100).toFixed(1)}% of votes cast`}
            />
          ))}
        </div>
        {/* Fixed 66% "to pass" line — the marker never moves. */}
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${APPROVAL_THRESHOLD_PCT}%` }}>
          <div className="h-full w-0.5 -translate-x-1/2 bg-content ring-1 ring-surface-raised/60" />
        </div>
      </div>
      <div className="relative mt-1 h-3">
        <span className="absolute -translate-x-1/2 font-mono text-[10px] text-content-tertiary tabular-nums"
          style={{ left: `${APPROVAL_THRESHOLD_PCT}%` }}>
          {APPROVAL_THRESHOLD_PCT}%
        </span>
      </div>
    </div>
  );
}

// Turnout: how much of the TOTAL circulating veHNT has voted, broken down by
// choice, with the unvoted remainder. `circulating` is the network-wide voting
// power (computed server-side); absent until the worker has first computed it,
// in which case the whole card is hidden rather than showing a bogus 100%.
function VoteProgress({ proposal }) {
  const circulating = proposal.circulating?.veHnt;
  if (!(circulating > 0)) return null;

  const voted = proposal.totalVeHnt || 0;
  const pct = Math.min(100, (voted / circulating) * 100);
  const remainder = Math.max(0, circulating - voted);
  const share = (v) => Math.min(100, (v / circulating) * 100);
  // Heaviest choices first; only choices with weight get a segment/legend row.
  const segs = (proposal.choices || []).filter((c) => c.veHnt > 0).sort((a, b) => b.veHnt - a.veHnt);
  const positions = proposal.circulating?.positions;

  return (
    <div className="rounded-2xl bg-surface-raised shadow-soft">
      <header className="flex items-baseline justify-between gap-3 px-6 py-3.5 border-b border-border-muted">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
          Turnout
        </h2>
        <Tooltip content={`Total veHNT voting power across all HNT positions${positions ? ` (${numberFormatter.format(positions)} positions)` : ""}. Vote progress is measured against this.`}>
          <span className="font-mono text-[11px] text-content-tertiary tabular-nums border-b border-dotted border-content-tertiary cursor-help">
            {fmtVeHnt(circulating)} veHNT circulating
          </span>
        </Tooltip>
      </header>
      <div className="px-6 py-5">
        <p className="font-display text-3xl font-semibold text-content tabular-nums leading-none">
          {pct.toFixed(1)}%
          <span className="ml-2 text-sm font-sans font-normal text-content-secondary">
            of voting power has voted
          </span>
        </p>
        {QUORUM_THRESHOLD_PCT != null && (
          <p className="mt-1 text-xs text-content-secondary">
            {pct >= QUORUM_THRESHOLD_PCT
              ? `Quorum met (${QUORUM_THRESHOLD_PCT}% needed)`
              : `${(QUORUM_THRESHOLD_PCT - pct).toFixed(1)}% short of the ${QUORUM_THRESHOLD_PCT}% quorum`}
          </p>
        )}

        {/* Stacked progress bar: each choice's share of the full circulating
            total, left-to-right; the unfilled track is the unvoted remainder.
            When a quorum is configured, a fixed marker shows the line. */}
        <div className="relative mt-4">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-inset" role="img"
            aria-label={`${pct.toFixed(1)}% of circulating veHNT has voted`}>
            {segs.map((c) => (
              <div
                key={c.index}
                className={`${choiceTone(c.name, c.index).bar} h-full first:rounded-l-full`}
                style={{ width: `${share(c.veHnt)}%` }}
                title={`${c.name}: ${fmtVeHnt(c.veHnt)} veHNT (${share(c.veHnt).toFixed(1)}%)`}
              />
            ))}
          </div>
          {QUORUM_THRESHOLD_PCT != null && (
            <div className="pointer-events-none absolute inset-y-0" style={{ left: `${Math.min(100, QUORUM_THRESHOLD_PCT)}%` }}
              title={`Quorum: ${QUORUM_THRESHOLD_PCT}% of circulating veHNT`}>
              <div className="h-3 w-0.5 -translate-x-1/2 bg-content ring-1 ring-surface-raised/60" />
            </div>
          )}
        </div>

        <ul className="mt-4 space-y-1.5">
          {segs.map((c) => (
            <li key={c.index} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${choiceTone(c.name, c.index).bar}`} />
                <span className="text-content truncate">{c.name}</span>
              </span>
              <span className="flex items-center gap-3 shrink-0 tabular-nums">
                <span className="text-content-secondary">{fmtVeHnt(c.veHnt)}</span>
                <span className="w-14 text-right text-content-tertiary">{share(c.veHnt).toFixed(1)}%</span>
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 min-w-0">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-surface-inset ring-1 ring-inset ring-border" />
              <span className="text-content-tertiary truncate">Not voted</span>
            </span>
            <span className="flex items-center gap-3 shrink-0 tabular-nums">
              <span className="text-content-secondary">{fmtVeHnt(remainder)}</span>
              <span className="w-14 text-right text-content-tertiary">{(100 - pct).toFixed(1)}%</span>
            </span>
          </li>
        </ul>
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
  // Distinct voters per choice, from the roster aggregation (the proposal
  // account only carries weights, not voter identities).
  const votersByChoice = useMemo(() => {
    const m = new Map();
    for (const pc of votes?.perChoice || []) m.set(pc.index, pc.voters);
    return m;
  }, [votes]);

  return (
    <div className="rounded-2xl bg-surface-raised shadow-soft">
      <ApprovalMeter proposal={proposal} />
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
            voterCount={votersByChoice.get(choice.index)}
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

function VoteTimeline({ actions, proposal }) {
  if (!actions || actions.length === 0) {
    return <p className="text-xs text-content-tertiary">No detailed history available.</p>;
  }
  return (
    <ol className="space-y-1.5">
      {actions.map((a, i) => {
        const name = a.choice != null ? proposal.choices[a.choice]?.name ?? `#${a.choice}` : null;
        const tone = name ? choiceTone(name, a.choice ?? 0) : null;
        return (
          <li key={`${a.signature}-${i}`} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[10px] uppercase tracking-wide text-content-tertiary">
                {a.action === "relinquish" ? "relinquished" : "voted"}
              </span>
              {name && <span className={`font-medium ${tone.text}`}>{name}</span>}
            </span>
            <a
              href={`https://solscan.io/tx/${a.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] text-content-tertiary hover:text-content-secondary tabular-nums shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {a.ts ? new Date(a.ts * 1000).toLocaleString() : "—"}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function VoterRow({ v, proposal }) {
  const tone = choiceTone(proposal.choices[v.choices[0]]?.name, v.choices[0] ?? 0);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !history && !loading) {
      setLoading(true);
      setErr(false);
      fetchVoterHistory(proposal.address, v.voter)
        .then(setHistory)
        .catch(() => setErr(true))
        .finally(() => setLoading(false));
    }
  };

  return (
    <>
      <tr
        className={`border-t border-border-muted hover:bg-surface-inset/40 ${v.flipped ? "cursor-pointer" : ""}`}
        onClick={v.flipped ? toggle : undefined}
      >
        <td className="px-5 py-2">
          <div className="flex items-center gap-1.5">
            {v.proxyName ? (
              <Tooltip content={v.voter}>
                <a
                  href={`https://solscan.io/account/${v.voter}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-content hover:text-accent-text truncate max-w-[12rem]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {v.proxyName}
                </a>
              </Tooltip>
            ) : (
              <a
                href={`https://solscan.io/account/${v.voter}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-content-secondary hover:text-content"
                onClick={(e) => e.stopPropagation()}
              >
                {truncateString(v.voter, 4, 4)}
              </a>
            )}
            <CopyButton text={v.voter} size="h-3 w-3" />
            {v.proxy && (
              <Tooltip content="Cast via a vote proxy / delegation">
                <span className="font-mono text-[9px] uppercase tracking-wide text-content-tertiary border border-border-muted rounded px-1">
                  proxy
                </span>
              </Tooltip>
            )}
            {v.positions > 1 && (
              <Tooltip content={`Total across ${v.positions} veHNT positions`}>
                <span className="font-mono text-[9px] uppercase tracking-wide text-content-tertiary tabular-nums">
                  ×{v.positions}
                </span>
              </Tooltip>
            )}
          </div>
        </td>
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1.5">
            <span className={`font-medium ${tone.text}`}>{choiceNames(v.choices, proposal)}</span>
            {v.flipped && (
              <Tooltip content="Changed their vote — click to see the history">
                <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                  <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
                  <ChevronDownIcon className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
                </span>
              </Tooltip>
            )}
          </span>
        </td>
        <td className="px-5 py-2 text-right font-mono tabular-nums text-content">{fmtVeHnt(v.veHnt)}</td>
      </tr>
      {open && (
        <tr className="bg-surface-inset/30">
          <td colSpan={3} className="px-5 py-3">
            {loading ? (
              <p className="text-xs text-content-tertiary">Loading vote history…</p>
            ) : err ? (
              <p className="text-xs text-content-tertiary">Couldn't load vote history.</p>
            ) : (
              <VoteTimeline actions={history?.actions} proposal={proposal} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function VoterRoster({ proposal, votes, error }) {
  return (
    <section className="rounded-2xl bg-surface-raised shadow-soft">
      <header className="flex items-baseline justify-between gap-3 px-5 py-3.5 border-b border-border-muted">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
          Voters
        </h2>
        {votes && (
          <span className="font-mono text-[11px] text-content-tertiary tabular-nums">
            {numberFormatter.format(votes.uniqueVoters)} voter{votes.uniqueVoters === 1 ? "" : "s"}
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
              {votes.votes.map((v) => (
                <VoterRow key={v.voter} v={v} proposal={proposal} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── activity feed ────────────────────────────────────────────────────────────

function ActivityRow({ a, proposal }) {
  const isVote = a.action === "vote" || a.action === "relinquish";
  const hasChoices = isVote && Array.isArray(a.choices) && a.choices.length > 0;
  const name = hasChoices && proposal ? choiceNames(a.choices, proposal) : null;
  const tone = name ? choiceTone(proposal.choices[a.choices[0]]?.name, a.choices[0] ?? 0) : null;
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        {a.success ? (
          <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : (
          <XCircleIcon className="h-4 w-4 shrink-0 text-rose-500" />
        )}
        <div className="min-w-0">
          {isVote && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wide text-content-tertiary">
                {a.action === "relinquish" ? "relinquished" : "voted"}
              </span>
              {name && <span className={`text-xs font-medium ${tone.text}`}>{name}</span>}
            </div>
          )}
          <a
            href={`https://solscan.io/tx/${a.signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-[11px] text-content-tertiary hover:text-content-secondary truncate"
          >
            {truncateString(a.signature, 6, 6)}
            <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0" />
          </a>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0 text-right">
        {a.veHnt > 0 && (
          <span className="font-mono text-[11px] text-content-secondary tabular-nums">
            {fmtVeHnt(a.veHnt)} veHNT
          </span>
        )}
        <span className="font-mono text-[10px] text-content-tertiary tabular-nums">
          {relTime(a.blockTime)}
        </span>
      </div>
    </li>
  );
}

function ActivityFeed({ activity, error, proposal }) {
  return (
    <section className="rounded-2xl bg-surface-raised shadow-soft">
      <header className="flex items-baseline justify-between gap-3 px-5 py-3.5 border-b border-border-muted">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
          Recent activity
        </h2>
        <Tooltip content="On-chain transactions that touched this proposal (votes, resolution). Vote rows show the choice and the veHNT cast.">
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
            <ActivityRow key={a.signature} a={a} proposal={proposal} />
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
      <section className="rounded-2xl bg-surface-raised shadow-soft px-6 py-10 text-center">
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
    <section className="rounded-2xl bg-surface-raised shadow-soft">
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

            <VoteProgress proposal={proposal} />

            <VoteTrendChart history={history} proposal={proposal} />

            <div className="grid gap-6 lg:grid-cols-2">
              <VoterRoster proposal={proposal} votes={votes} error={votesError} />
              <ActivityFeed activity={activity} error={activityError} proposal={proposal} />
            </div>

            {proposal.content?.text && (
              <details className="rounded-2xl bg-surface-raised shadow-soft">
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
