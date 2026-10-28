import { memo, useMemo } from "react";
import useDarkMode from "../lib/useDarkMode.js";
import { FATES, fmtHnt, seatTitle, shortAddress } from "./format.js";
import { FateFill, PatternSheet, Swatch } from "./patterns.jsx";

function Bar({ byKind, total, dark, label }) {
  const parts = FATES.filter((f) => byKind[f.kind] && BigInt(byKind[f.kind]) > 0n);
  const sum = Number(total) || 1;
  let x = 0;
  return (
    <svg viewBox="0 0 1000 28" preserveAspectRatio="none" className="block h-7 w-full overflow-hidden rounded-lg" role="img" aria-label={label}>
      {parts.map((f) => {
        const w = (Number(byKind[f.kind]) / sum) * 1000;
        const el = <FateFill key={f.kind} kind={f.kind} dark={dark} x={x} y={0} width={w} height={28} />;
        x += w;
        return el;
      })}
    </svg>
  );
}

const pct = (part, total) => {
  const t = Number(total);
  if (!t) return "";
  const p = (Number(part) / t) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
};

/**
 * Where each seat's emissions went: a 100% bar per seat over everything
 * emitted to it, plus the same numbers as a table.
 */
function FateBars({ summary, onOpenSeat }) {
  const dark = useDarkMode();
  // The fates any seat has, for the legend and the table's columns.
  const kinds = useMemo(
    () => FATES.filter((f) => summary.seats.some((s) => s.byKind[f.kind] && BigInt(s.byKind[f.kind]) > 0n)),
    [summary],
  );

  return (
    <div className="space-y-5">
      <PatternSheet dark={dark} />
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-content-secondary">
        {kinds.map((f) => (
          <li key={f.kind} className="flex items-center gap-1.5">
            <Swatch kind={f.kind} dark={dark} />
            {f.label}
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        {summary.seats.map((s) => (
          <div key={s.wallet}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <button type="button" onClick={() => onOpenSeat(s.wallet)} className="min-w-0 truncate text-left font-medium text-content hover:text-accent-text">
                {seatTitle(s)} <span className="font-mono text-xs font-normal text-content-tertiary">{shortAddress(s.wallet)}</span>
              </button>
              <span className="shrink-0 font-mono text-xs tabular-nums text-content-tertiary">{fmtHnt(s.received)}</span>
            </div>
            <Bar byKind={s.byKind} total={s.received} dark={dark} label={`Where ${seatTitle(s)}'s emissions went`} />
            {s.label?.custodial && (
              <p className="mt-1.5 text-xs text-content-tertiary">
                This seat's receiving address is a {s.label.org || "exchange"} deposit address, so each emission lands on the exchange.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl bg-surface-inset">
        <table className="w-full min-w-[560px] text-left text-xs">
          <caption className="sr-only">Where each seat's emissions went, in HNT</caption>
          <thead>
            <tr className="border-b border-border text-content-tertiary">
              <th scope="col" className="px-3 py-2 font-medium">Seat</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Received</th>
              {kinds.map((f) => (
                <th key={f.kind} scope="col" className="px-3 py-2 text-right font-medium">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summary.seats.map((s) => (
              <tr key={s.wallet}>
                <th scope="row" className="px-3 py-2 font-medium text-content">{seatTitle(s)}</th>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-content">{fmtHnt(s.received, { unit: false })}</td>
                {kinds.map((f) => (
                  <td key={f.kind} className="px-3 py-2 text-right font-mono tabular-nums text-content-secondary">
                    {s.byKind[f.kind] && BigInt(s.byKind[f.kind]) > 0n ? (
                      <>
                        {fmtHnt(s.byKind[f.kind], { unit: false })}
                        <span className="ml-1 text-content-tertiary">{pct(s.byKind[f.kind], s.received)}</span>
                      </>
                    ) : (
                      <span className="text-content-tertiary">None</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default memo(FateBars);
