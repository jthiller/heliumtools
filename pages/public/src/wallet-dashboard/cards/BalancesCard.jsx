import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { Card, Skeleton, Dot } from "./primitives.jsx";
import { fmtToken, fmtUsd, TOKEN_META } from "../format.js";

const ORDER = ["hnt", "mobile", "iot", "sol", "dc"];

export default function BalancesCard({ tokens, loading }) {
  return (
    <Card title="Token balances">
      {loading ? (
        <div className="space-y-3 pt-1">
          {ORDER.map((k) => (
            <Skeleton key={k} className="h-7 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {ORDER.map((k) => {
            const t = tokens?.[k];
            const meta = TOKEN_META[k];
            if (!t) return null;
            return (
              <div key={k} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-content-secondary">
                  <Dot color={meta.color} />
                  {meta.label}
                  {t.ataEstablished === true && (
                    <span title="Associated token account established" aria-label="ATA established">
                      <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-500/70" />
                    </span>
                  )}
                  {t.ataEstablished === false && (
                    <span
                      title={`No associated token account — needed before this wallet can receive ${meta.label}`}
                      className="rounded border border-amber-300 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:border-amber-700/60 dark:text-amber-400"
                    >
                      No ATA
                    </span>
                  )}
                </span>
                <span className="text-right">
                  <span className="block text-sm font-medium tabular-nums text-content">
                    {fmtToken(t.uiAmount, { max: k === "dc" ? 0 : 4 })}
                  </span>
                  <span className="block text-xs tabular-nums text-content-tertiary">
                    {fmtUsd(t.valueUsd)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
