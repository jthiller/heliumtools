import { useEffect, useMemo, useState } from "react";
import { fetchCouncilRuns } from "../lib/councilEmissionsApi.js";
import { fmtDateTime, fmtDay, fmtHnt, txUrl } from "./format.js";

/**
 * The distribution runs behind the timeline: when each daily run fired, what each
 * seat got, and the attempts that failed and were retried. Loaded on open.
 */
export default function DistributionRuns({ totals }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || data) return undefined;
    const ctrl = new AbortController();
    fetchCouncilRuns({ signal: ctrl.signal }).then(setData).catch((err) => {
      if (err?.name !== "AbortError") setError(err);
    });
    return () => ctrl.abort();
  }, [open, data]);

  const rows = useMemo(() => {
    if (!data?.runs) return [];
    return [...data.runs].reverse().map((r) => {
      const perSeat = Object.values(r.perSeat || {});
      const each = perSeat.length ? perSeat[0] : "0";
      const late = r.minutesAfterMidnight != null && r.minutesAfterMidnight > 30;
      return { ...r, each, late };
    });
  }, [data]);

  const failedByName = useMemo(() => {
    const out = {};
    for (const f of data?.failed || []) {
      const name = f.error?.name || "Other error";
      out[name] = (out[name] || 0) + 1;
    }
    return out;
  }, [data]);

  return (
    <details className="rounded-2xl bg-surface-raised p-5 shadow-soft sm:p-6" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer font-display text-lg font-semibold text-content">Distribution runs</summary>
      <div className="mt-3 space-y-3 text-sm text-content-secondary">
        <p>
          The fanout ran {totals.runs} times. {totals.distributedRuns} runs sent HNT to the seats and {totals.emptyRuns} found it empty.
          {totals.failedAttempts > 0 && ` ${totals.failedAttempts} attempts failed and were retried.`}
        </p>
        <p className="text-xs text-content-tertiary">
          The mint and the distribution both fire at 00:00 UTC. When the distribution runs first, it finds the fanout empty and the next run distributes two days at once. That is why one run sometimes distributes nothing and the next distributes two days' worth, even though each seat accrues the same amount every day.
        </p>
        {error && <p className="text-xs text-rose-600 dark:text-rose-400">Couldn't load the distribution runs.</p>}
        {data && (
          <>
            {Object.keys(failedByName).length > 0 && (
              <p className="text-xs text-content-tertiary">
                Failed attempts by error: {Object.entries(failedByName).map(([name, n]) => `${name} ${n}`).join(", ")}.
              </p>
            )}
            <div className="max-h-96 overflow-auto rounded-xl bg-surface-inset">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Distribution runs, newest first</caption>
                <thead className="sticky top-0 bg-surface-inset">
                  <tr className="border-b border-border text-content-tertiary">
                    <th scope="col" className="px-3 py-2 font-medium">Run (UTC)</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Each seat</th>
                    <th scope="col" className="px-3 py-2 font-medium">Mints distributed</th>
                    <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Transaction</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.sig}>
                      <td className="px-3 py-1.5 text-content">
                        {fmtDateTime(r.t)}
                        {r.late && <span className="ml-1.5 text-content-tertiary">(late)</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-content">{BigInt(r.total) > 0n ? fmtHnt(r.each, { unit: false }) : <span className="text-content-tertiary">Empty</span>}</td>
                      <td className="px-3 py-1.5 text-content-tertiary">{r.epochs.map((e) => fmtDay(e)).join(", ")}</td>
                      <td className="px-3 py-1.5 text-right">
                        <a href={txUrl(r.sig)} target="_blank" rel="noopener noreferrer" className="text-content-tertiary underline decoration-dotted underline-offset-2 hover:text-accent-text">
                          tx<span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
