import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRightIcon, CheckBadgeIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import { numberFormatter } from "../lib/utils.js";
import { fetchProposals } from "../lib/voteApi.js";
import { fmtVeHnt, fmtDate, StatusPill, isFinalStatus, isElection, choiceTone } from "./voteUi.jsx";

// Blind index page (like /vote itself, deliberately not on the landing page):
// every governance vote this site has tracked, current first, each linking to
// its detail page at /vote/:proposalId. Served from the worker's D1 catalog —
// past votes stay listed long after their on-chain markers close.

const POLL_MS = 60_000;
// Display cap for a card's leader list when the election's seat count isn't
// known — a layout bound, not a claim about how many seats there are.
const LEADERS_SHOWN = 5;

function winnerNames(p) {
  if (!Array.isArray(p.winningChoices) || p.winningChoices.length === 0) return [];
  const byIndex = new Map((p.choices || []).map((c) => [c.index, c]));
  return p.winningChoices
    .map((i) => byIndex.get(i))
    .filter(Boolean)
    .sort((a, b) => (b.veHnt || 0) - (a.veHnt || 0));
}

// The election-night one-liner under each card title: leaders while live,
// winners once resolved, pass/fail margin for yes-no votes.
function Standings({ p }) {
  const final = isFinalStatus(p.status);
  const choices = [...(p.choices || [])].sort((a, b) => (b.veHnt || 0) - (a.veHnt || 0));
  if (choices.length === 0) return null;

  // Yes-no vote: show the For share of votes cast.
  if (choices.length <= 2) {
    const total = choices.reduce((acc, c) => acc + (c.veHnt || 0), 0);
    const top = choices[0];
    if (!(total > 0)) return null;
    const tone = choiceTone(top.name, top.index);
    return (
      <p className="text-xs text-content-secondary truncate">
        <span className={`font-medium ${tone.text}`}>{top.name}</span>
        <span className="tabular-nums"> · {(((top.veHnt || 0) / total) * 100).toFixed(1)}% of votes cast</span>
      </p>
    );
  }

  // Election: the winner list (resolved) or current leaders (live).
  const winners = final ? winnerNames(p) : [];
  const listed = winners.length ? winners : choices.slice(0, p.seats || LEADERS_SHOWN);
  const more = choices.length - listed.length;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-secondary">
      <span className="font-mono text-[10px] uppercase tracking-wide text-content-tertiary">
        {final ? "Elected" : "Leading"}
      </span>
      {listed.map((c) => (
        <span key={c.index} className="inline-flex items-center gap-1 min-w-0">
          {final && <CheckBadgeIcon className={`h-3.5 w-3.5 shrink-0 ${choiceTone(c.name, c.index).text}`} />}
          <span className={`truncate font-medium ${choiceTone(c.name, c.index).text}`}>{c.name}</span>
        </span>
      ))}
      {!final && more > 0 && <span className="text-content-tertiary">+{more} more</span>}
    </p>
  );
}

function VoteCard({ p }) {
  const final = isFinalStatus(p.status);
  return (
    <Link
      to={`/vote/${p.address}`}
      className="group block rounded-2xl bg-surface-raised shadow-soft hover:shadow-soft-lg transition-shadow"
    >
      <div className="px-6 py-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <StatusPill status={p.status} />
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-content-tertiary tabular-nums">
            {final
              ? `Ended ${fmtDate(p.endTs)}`
              : p.endTs
                ? `Ends ${fmtDate(p.endTs)}`
                : `Created ${fmtDate(p.createdAt)}`}
            <ChevronRightIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
        <h2 className="font-display text-lg font-semibold text-content tracking-[-0.02em] leading-snug">
          {p.name || p.address}
        </h2>
        {isElection(p) && (
          <p className="mt-0.5 text-xs text-content-tertiary">
            {p.seats}-seat election · {p.choices.length} candidates
          </p>
        )}
        <div className="mt-3 space-y-2">
          <Standings p={p} />
          <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-content-tertiary tabular-nums">
            {p.uniqueVoters != null && (
              <span>{numberFormatter.format(p.uniqueVoters)} voters</span>
            )}
            {(p.votedVeHnt ?? p.totalVeHnt) != null && (
              <span>{fmtVeHnt(p.votedVeHnt ?? p.totalVeHnt)} veHNT voted</span>
            )}
            {p.tags?.map((t) => (
              <span key={t} className="rounded-full border border-border-muted px-2 py-0.5 text-[10px] uppercase tracking-wide">
                {t}
              </span>
            ))}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function VotesIndex() {
  const [proposals, setProposals] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchProposals();
      setProposals(data.proposals || []);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const live = (proposals || []).filter((p) => !isFinalStatus(p.status));
  const past = (proposals || []).filter((p) => isFinalStatus(p.status));

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Votes" />
      <main className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="font-display text-3xl font-bold text-content tracking-[-0.03em]">
          Governance votes
        </h1>
        <p className="mt-2 text-sm text-content-secondary">
          Helium network votes tracked by this page — live tallies for open votes,
          final results for past ones. Read directly from the Solana chain.
        </p>

        {error && !proposals && (
          <div className="mt-8">
            <StatusBanner tone="error" message={error.message || "Failed to load votes."} />
          </div>
        )}

        {!proposals && !error && (
          <div className="mt-8 rounded-2xl border border-dashed border-border px-8 py-16 text-center">
            <p className="text-sm text-content-secondary">Loading votes…</p>
          </div>
        )}

        {proposals && proposals.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-border px-8 py-16 text-center">
            <p className="text-sm text-content-secondary">
              No votes tracked yet — the index fills in as votes are viewed.
            </p>
          </div>
        )}

        {live.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
              Live
            </h2>
            <div className="space-y-4">
              {live.map((p) => <VoteCard key={p.address} p={p} />)}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
              Past
            </h2>
            <div className="space-y-4">
              {past.map((p) => <VoteCard key={p.address} p={p} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
