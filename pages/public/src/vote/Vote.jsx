import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  XCircleIcon,
  CheckBadgeIcon,
  ClockIcon,
  Squares2X2Icon,
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
import {
  fmtVeHnt, fmtDate, relTime, StatusPill, isFinalStatus,
  choiceTone, choiceHex, NEUTRAL_HUE_COUNT,
} from "./voteUi.jsx";

// The vote the blind page currently features. /vote with no id falls back to
// it. Current: the HIP-149 Advisory Council election (5 community seats).
// Past votes stay reachable from the /votes index.
const DEFAULT_PROPOSAL = "EejcqoypTXfix3m8GrPwLPQfs1P16yCPhiyzkMLvLRx4";
// The worker snapshots on a ~15-min cron and serves everyone from cache, so
// there's no value in viewers polling fast — these just refresh the view.
const POLL_MS = 60_000;
const HISTORY_POLL_MS = 5 * 60_000;

// ─── results ─────────────────────────────────────────────────────────────────

// Live time-remaining for an open proposal; falls back to the end date once it
// resolves. Ticks once a second in its own leaf state so it never re-renders
// the heavier tables/chart above it.
function fmtCountdown(remaining) {
  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  if (d > 0) return { big: `${d}d ${h}h`, tail: `${m}m` };
  if (h > 0) return { big: `${h}h ${m}m`, tail: `${s}s` };
  if (m > 0) return { big: `${m}m ${s}s`, tail: "" };
  return { big: `${s}s`, tail: "" };
}

function Countdown({ endTs, status }) {
  const isActive = status === "active";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive || !endTs) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive, endTs]);

  if (!endTs) return null;

  const base =
    "inline-flex items-center gap-1.5 font-mono text-[11px] text-content-tertiary tabular-nums";

  // Resolved/closed: no ticking, just when it ended.
  if (!isActive) {
    return (
      <span className={base}>
        <ClockIcon className="h-3.5 w-3.5" />
        <span className="uppercase tracking-wide">Ended</span>
        <span className="text-content-secondary">{fmtDate(endTs)}</span>
      </span>
    );
  }

  const remaining = endTs - Math.floor(now / 1000);
  if (remaining <= 0) {
    return (
      <span className={base}>
        <ClockIcon className="h-3.5 w-3.5" />
        <span className="uppercase tracking-wide">Voting closed</span>
      </span>
    );
  }

  const { big, tail } = fmtCountdown(remaining);
  return (
    <span className={base}>
      <ClockIcon className="h-3.5 w-3.5" />
      <span className="uppercase tracking-wide">Ends in</span>
      <span className="font-medium text-content">{big}</span>
      {tail && <span className="text-content-tertiary">{tail}</span>}
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
// Approval: a HIP passes with a two-thirds (66.67%) supermajority of votes CAST.
// Quorum: minimum participation as a share of total circulating veHNT — set this
// once we have the figure and the quorum line/verdict light up automatically.
const APPROVAL_THRESHOLD_PCT = 200 / 3; // two-thirds
const QUORUM_THRESHOLD_PCT = null; // e.g. 33 ⇒ "33% of circulating must vote"

// The choice that "approval" refers to (the For/Yes side of a yes-no proposal).
function approvalChoice(choices) {
  return (choices || []).find((c) => /^(for|yes|approve|in favor)/i.test(c.name || "")) || null;
}

// Election-night approval meter: For as a share of votes CAST against a fixed
// two-thirds "to pass" line — like watching a tally climb toward 270. Only for
// yes-no proposals: a For/Yes choice must exist and there must be at most one
// other choice (a multi-candidate election has no pass line).
function ApprovalMeter({ proposal }) {
  const voted = proposal.totalVeHnt || 0;
  const forChoice = approvalChoice(proposal.choices);
  if (!forChoice || !(voted > 0) || (proposal.choices || []).length > 2) return null;

  const forPct = (forChoice.veHnt / voted) * 100;
  const passing = forPct >= APPROVAL_THRESHOLD_PCT;
  const isResolved = isFinalStatus(proposal.status);
  // Once resolved, the verdict is the chain's outcome — the threshold math is
  // only a live projection (the two could disagree, e.g. on a quorum failure).
  const label = isResolved
    ? (proposal.status === "passed" ? "Passed" : "Did not pass")
    : (passing ? "On track to pass" : "Below threshold");

  // Once resolved, color the verdict by the chain's outcome too.
  const good = isResolved ? proposal.status === "passed" : passing;
  const thresholdLabel = `${APPROVAL_THRESHOLD_PCT.toFixed(1)}%`;

  // Order the combined bar For → others → Against so the green grows from the
  // left toward the two-thirds line and the red anchors the right,
  // election-night style.
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
          good
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        }`}>
          {label}
        </span>
        <span className="text-xs text-content-secondary tabular-nums">
          <span className="font-semibold text-content">{forPct.toFixed(1)}%</span>
          {" "}{forChoice.name} · {thresholdLabel} to pass
        </span>
      </div>
      <div className="relative mt-2.5">
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-inset"
          role="img" aria-label={`${forChoice.name} ${forPct.toFixed(1)}% of votes cast; ${thresholdLabel} needed to pass`}>
          {ordered.map((c) => (
            <div
              key={c.index}
              className={`${choiceTone(c.name, c.index).bar} h-full`}
              style={{ width: `${(c.veHnt / voted) * 100}%` }}
              title={`${c.name}: ${((c.veHnt / voted) * 100).toFixed(1)}% of votes cast`}
            />
          ))}
        </div>
        {/* Fixed two-thirds "to pass" line — the marker never moves. */}
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${APPROVAL_THRESHOLD_PCT}%` }}>
          <div className="h-full w-0.5 -translate-x-1/2 bg-content ring-1 ring-surface-raised/60" />
        </div>
      </div>
      <div className="relative mt-1 h-3">
        <span className="absolute -translate-x-1/2 font-mono text-[10px] text-content-tertiary tabular-nums"
          style={{ left: `${APPROVAL_THRESHOLD_PCT}%` }}>
          {thresholdLabel}
        </span>
      </div>
    </div>
  );
}

// Turnout: how much of the TOTAL circulating veHNT has voted, with the unvoted
// remainder. `circulating` is the network-wide voting power (computed
// server-side); absent until the worker has first computed it, in which case
// the whole card is hidden rather than showing a bogus 100%.
//
// Counting: on a yes-no vote the proposal's summed choice weights ARE the
// participating veHNT. On a multi-choice election a single ballot adds its
// weight to EVERY candidate it backs (up to maxChoicesPerVoter), so that sum
// overcounts participation — the roster's distinct total (each position counted
// once) is the honest numerator, and the by-choice breakdown moves to the
// outcome card where it means "support", not "turnout".
function VoteProgress({ proposal, votes }) {
  const circulating = proposal.circulating?.veHnt;
  const multi = (proposal.maxChoicesPerVoter || 1) > 1;
  if (!(circulating > 0)) return null;

  const distinct = votes && !votes.unavailable ? votes.totalVeHnt : null;
  // Multi-choice with no roster yet → wait rather than overcount.
  const voted = multi ? distinct : (proposal.totalVeHnt || 0);
  if (voted == null) return null;

  const pct = Math.min(100, (voted / circulating) * 100);
  const remainder = Math.max(0, circulating - voted);
  const share = (v) => Math.min(100, (v / circulating) * 100);
  // Yes-no: per-choice segments (they sum to the turnout). Multi-choice: one
  // aggregate segment — per-candidate shares of circulating would overlap.
  const segs = multi
    ? []
    : (proposal.choices || []).filter((c) => c.veHnt > 0).sort((a, b) => b.veHnt - a.veHnt);
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
        {multi && (
          <p className="mt-1 text-xs text-content-tertiary">
            Each ballot counted once, however many candidates it backs.
          </p>
        )}
        {QUORUM_THRESHOLD_PCT != null && (
          <p className="mt-1 text-xs text-content-secondary">
            {pct >= QUORUM_THRESHOLD_PCT
              ? `Quorum met (${QUORUM_THRESHOLD_PCT}% needed)`
              : `${(QUORUM_THRESHOLD_PCT - pct).toFixed(1)}% short of the ${QUORUM_THRESHOLD_PCT}% quorum`}
          </p>
        )}

        {/* Stacked progress bar against the full circulating total; the
            unfilled track is the unvoted remainder. When a quorum is
            configured, a fixed marker shows the line. */}
        <div className="relative mt-4">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-inset" role="img"
            aria-label={`${pct.toFixed(1)}% of circulating veHNT has voted`}>
            {multi ? (
              <div
                className="h-full rounded-l-full bg-accent"
                style={{ width: `${pct}%` }}
                title={`Voted: ${fmtVeHnt(voted)} veHNT (${pct.toFixed(1)}%)`}
              />
            ) : (
              segs.map((c) => (
                <div
                  key={c.index}
                  className={`${choiceTone(c.name, c.index).bar} h-full first:rounded-l-full`}
                  style={{ width: `${share(c.veHnt)}%` }}
                  title={`${c.name}: ${fmtVeHnt(c.veHnt)} veHNT (${share(c.veHnt).toFixed(1)}%)`}
                />
              ))
            )}
          </div>
          {QUORUM_THRESHOLD_PCT != null && (
            <div className="pointer-events-none absolute inset-y-0" style={{ left: `${Math.min(100, QUORUM_THRESHOLD_PCT)}%` }}
              title={`Quorum: ${QUORUM_THRESHOLD_PCT}% of circulating veHNT`}>
              <div className="h-3 w-0.5 -translate-x-1/2 bg-content ring-1 ring-surface-raised/60" />
            </div>
          )}
        </div>

        <ul className="mt-4 space-y-1.5">
          {multi ? (
            <li className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
                <span className="text-content truncate">Voted</span>
              </span>
              <span className="flex items-center gap-3 shrink-0 tabular-nums">
                <span className="text-content-secondary">{fmtVeHnt(voted)}</span>
                <span className="w-14 text-right text-content-tertiary">{pct.toFixed(1)}%</span>
              </span>
            </li>
          ) : (
            segs.map((c) => (
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
            ))
          )}
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
  const multi = (proposal.maxChoicesPerVoter || 1) > 1;
  const seats = proposal.seats || null;
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

  // On a multi-choice election the summed choice weights count a ballot once
  // per candidate it backs — the honest headline is the roster's distinct
  // total (each position once). Yes-no proposals: the sums are identical.
  const distinct = votes && !votes.unavailable ? votes.totalVeHnt : null;
  const powerVeHnt = multi ? distinct : proposal.totalVeHnt;
  // Where to draw the elected-seats cut. Live: a projection after the leading
  // `seats` rows. Resolved: the chain's winner set is authoritative — only draw
  // the line if the winners are exactly the top block of the sort (ties or
  // unusual resolution rules could break that, in which case badges carry it).
  let cutAfter = null;
  if (seats && sorted.length > seats) {
    if (!isResolved) {
      cutAfter = seats;
    } else if (winners.size && sorted.slice(0, winners.size).every((c) => winners.has(c.index))) {
      cutAfter = winners.size;
    }
  }

  return (
    <div className="rounded-2xl bg-surface-raised shadow-soft">
      <ApprovalMeter proposal={proposal} />
      <div className="grid grid-cols-2 divide-x divide-border-muted border-b border-border-muted">
        <div className="px-6 py-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-content-tertiary">
            {multi ? "Voting power voted" : "Total voting power"}
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-content tabular-nums leading-none">
            {fmtVeHnt(powerVeHnt)}
            <span className="ml-1.5 text-sm font-sans text-content-secondary">veHNT</span>
          </p>
          {multi && (
            <p className="mt-1.5 text-[11px] text-content-tertiary">
              Distinct veHNT — each ballot may back up to {proposal.maxChoicesPerVoter} candidates.
            </p>
          )}
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
        {sorted.map((choice, pos) => (
          <div key={choice.index}>
            {/* Elected-seats cut line: everything above wins a seat. */}
            {cutAfter != null && pos === cutAfter && (
              <div className="flex items-center gap-3 pt-3 pb-0.5" role="separator">
                <span className="h-px flex-1 border-t border-dashed border-content-tertiary/50" />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-content-tertiary">
                  {isResolved ? `Top ${seats} elected` : `Top ${seats} win seats`}
                </span>
                <span className="h-px flex-1 border-t border-dashed border-content-tertiary/50" />
              </div>
            )}
            <ChoiceBar
              choice={choice}
              isWinner={winners.has(choice.index)}
              isResolved={isResolved}
              voterCount={votersByChoice.get(choice.index)}
            />
          </div>
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
        <span className="flex items-baseline gap-2">
          {votes?.reconstructed && (
            <Tooltip content="This vote has resolved and its on-chain vote markers are closed. The final roster is rebuilt from the votes this page recorded while the vote was open; the tallies above are read from the proposal itself.">
              <span className="font-mono text-[10px] uppercase tracking-wide text-content-tertiary border-b border-dotted border-content-tertiary cursor-help">
                final roster
              </span>
            </Tooltip>
          )}
          {votes && (
            <span className="font-mono text-[11px] text-content-tertiary tabular-nums">
              {numberFormatter.format(votes.uniqueVoters)} voter{votes.uniqueVoters === 1 ? "" : "s"}
              {votes.truncated && ` · top ${numberFormatter.format(votes.returned)}`}
            </span>
          )}
        </span>
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-inset">
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
        <ul className="divide-y divide-border-muted">
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

  // A line per choice reads fine up to the palette's 8 distinct hues; beyond
  // that (a crowded election) the leaders keep their own lines and the tail is
  // folded into one dashed gray "Others" — repeating hues on a chart would make
  // lines unidentifiable. Charted choices keep index order so their colors stay
  // with the candidate, not their rank.
  const { series, charted, othersKey } = useMemo(() => {
    const choices = proposal?.choices || [];
    let chartedChoices = choices;
    if (choices.length > NEUTRAL_HUE_COUNT) {
      const leaders = new Set(
        [...choices]
          .sort((a, b) => b.veHnt - a.veHnt)
          .slice(0, NEUTRAL_HUE_COUNT)
          .map((c) => c.index),
      );
      chartedChoices = choices.filter((c) => leaders.has(c.index));
    }
    const s = chartedChoices.map((c, pos) => ({
      key: `c${c.index}`,
      name: c.name,
      color: choiceHex(c.name, choices.length > NEUTRAL_HUE_COUNT ? pos : c.index, dark),
      dash: null,
    }));
    const folded = choices.length > chartedChoices.length;
    if (folded) {
      s.push({
        key: "others",
        name: `Others (${choices.length - chartedChoices.length})`,
        color: colors?.tickText || "#9ca3af",
        dash: "4 3",
      });
    }
    return {
      series: s,
      charted: new Set(chartedChoices.map((c) => c.index)),
      othersKey: folded ? "others" : null,
    };
  }, [proposal?.choices, dark, colors]);

  // One row per vote (precise blockTime). Every charted choice gets a value on
  // every row (0 until its first vote) so the cumulative step-lines stay
  // continuous; non-charted choices sum into the Others line. Seed a zero point
  // at voting-open so each line starts at the baseline.
  const data = useMemo(() => {
    const rows = points.map((pt) => {
      const row = { t: pt.ts * 1000 };
      for (const idx of charted) row[`c${idx}`] = 0;
      if (othersKey) row[othersKey] = 0;
      for (const c of pt.choices || []) {
        if (charted.has(c.index)) row[`c${c.index}`] = c.veHnt;
        else if (othersKey) row[othersKey] += c.veHnt;
      }
      return row;
    });
    const startSec = proposal?.startTs || proposal?.createdAt;
    if (startSec && rows.length && rows[0].t > startSec * 1000) {
      const seed = { t: startSec * 1000 };
      for (const idx of charted) seed[`c${idx}`] = 0;
      if (othersKey) seed[othersKey] = 0;
      rows.unshift(seed);
    }
    return rows;
  }, [points, charted, othersKey, proposal?.startTs, proposal?.createdAt]);

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
                strokeDasharray={s.dash || undefined}
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
  // render but always fetches the current proposal. Same trick for the status:
  // once a vote is final there's nothing to poll for.
  const idRef = useRef(proposalId);
  idRef.current = proposalId;
  const finalRef = useRef(false);
  finalRef.current = !!proposal && !proposal.warming && isFinalStatus(proposal.status);

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

  // Auto-refresh while the tab is visible — until the vote is final, after
  // which the data can't change and polling is just noise.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden && !finalRef.current) refresh();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden && !finalRef.current) refreshHistory();
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                  <StatusPill status={proposal.status} />
                  <Countdown endTs={proposal.endTs} status={proposal.status} />
                </div>
                <div className="flex items-center gap-3">
                  {isFinalStatus(proposal.status) ? (
                    <Tooltip content="This vote has resolved — the results below are final and no longer refresh.">
                      <span className="font-mono text-[11px] text-content-tertiary uppercase tracking-wide border-b border-dotted border-content-tertiary cursor-help">
                        Final results
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Polled on-chain by the worker on a schedule (~every 15 min) and served from cache — so viewing this page doesn't hit the RPC.">
                      <span className="font-mono text-[11px] text-content-tertiary tabular-nums border-b border-dotted border-content-tertiary cursor-help">
                        {proposal.snapshotAt ? `data ${relTime(Math.floor(proposal.snapshotAt / 1000))}` : ""}
                      </span>
                    </Tooltip>
                  )}
                  {!isFinalStatus(proposal.status) && (
                    <button
                      onClick={() => refresh()}
                      disabled={refreshing}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wide text-content-secondary hover:text-content hover:border-content-tertiary transition disabled:opacity-50"
                      aria-label="Refresh"
                    >
                      <ArrowPathIcon className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                      Refresh
                    </button>
                  )}
                  <Link
                    to="/votes"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wide text-content-secondary hover:text-content hover:border-content-tertiary transition"
                  >
                    <Squares2X2Icon className="h-3.5 w-3.5" />
                    All votes
                  </Link>
                </div>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold text-content tracking-[-0.03em] leading-tight">
                {proposal.name || truncateString(proposal.address, 6, 6)}
              </h1>
              {proposal.seats && (proposal.choices || []).length > 2 && (
                <p className="mt-2 text-sm text-content-secondary">
                  Electing the top {proposal.seats} of {proposal.choices.length} candidates
                  {proposal.maxChoicesPerVoter > 1 &&
                    ` — each ballot may back up to ${proposal.maxChoicesPerVoter}`}
                  .
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-content-tertiary font-mono">
                <span>Created {fmtDate(proposal.createdAt)}</span>
                {proposal.status === "active" && proposal.startTs && (
                  <span>· Opened {fmtDate(proposal.startTs)}</span>
                )}
                {proposal.endTs && (
                  <span>· {proposal.status === "active" ? "Ends" : "Ended"} {fmtDate(proposal.endTs)}</span>
                )}
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

            <VoteProgress proposal={proposal} votes={votes} />

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
