import { memo } from "react";
import { Card, CardHead, Skeleton, StatusMark, Tag } from "../ui/index.js";
import { fmtCount, fmtHnt, fmtUsd, plural } from "../format.js";
import { rewardsFromScope } from "../copy.js";

const tok = (v) => fmtHnt(v, "stat");
const LEGACY = [
  ["iot", "IOT"],
  ["mobile", "MOBILE"],
];

/** Lifetime HNT plus the legacy tokens, at today's prices; null when the HNT price is missing. */
function lifetimeUsd(l, prices) {
  if (prices?.hnt == null || l.hnt == null) return null;
  let usd = l.hnt * prices.hnt;
  for (const [k] of LEGACY) if (l.legacy[k] > 0 && prices[k] != null) usd += l.legacy[k] * prices[k];
  return usd;
}

/**
 * Earnings' Lifetime earned card (WdEarnings): all the HNT the wallet's
 * Hotspots have earned, across IoT and Mobile, at today's prices, split into
 * Claimed and Unclaimed, with the legacy IOT and MOBILE earned before rewards
 * moved to HNT (not in the HNT figure). A Hotspot whose unclaimed HNT
 * couldn't be confirmed counts at what it claimed, so the total reads "At
 * least" (a lower bound). "So far" while the rewards scan runs.
 */
export default memo(function LifetimeCard({ money, list, prices }) {
  const l = money.lifetime;
  const u = money.unclaimed;
  const hs = u.hotspotsState;
  const total = u.total || list.counts.total;
  const loading = hs === "loading" && !u.fleetFailed;
  const failed = hs === "failed" || u.fleetFailed;
  const scanning = hs === "scanning";
  const sofar = scanning ? " so far" : "";
  const failedRows = list.rows.reduce((n, r) => n + (r.lifetime.state === "failed" ? 1 : 0), 0);
  const legacy = LEGACY.filter(([k]) => l.legacy[k] > 0);
  const usd = lifetimeUsd(l, prices);
  const lowerBound = !scanning && l.lowerBound;
  const unconfirmed = list.totals.unconfirmed;

  let sub;
  if (scanning) sub = `From ${fmtCount(u.checked)} of ${plural(total, "Hotspot")} checked so far.`;
  else if (failedRows > 0) sub = rewardsFromScope(total, failedRows);
  else if (l.never === 0)
    sub = total === 1 ? "From 1 Hotspot, rewarded." : `From ${plural(total, "Hotspot")}. All ${fmtCount(total)} rewarded.`;
  else sub = `From ${plural(total, "Hotspot")}. ${fmtCount(l.ever)} rewarded, ${fmtCount(l.never)} never rewarded.`;

  return (
    <Card busy={loading || scanning} className="flex min-w-0 flex-col gap-3.5">
      <CardHead title="Lifetime earned" right="lifetime, all Hotspots" />

      {loading && (
        <div className="flex flex-col gap-1.5">
          <Skeleton w={200} h={38} className="max-w-full" />
          <Skeleton w={180} h={14} className="max-w-full" />
          <span className="sr-only">Loading</span>
        </div>
      )}

      {failed && (
        <div className="flex flex-col items-start gap-2.5 pb-1 pt-2">
          <p className="m-0 text-sm font-semibold text-wd-ink">Couldn&apos;t check Hotspot rewards.</p>
          <span className="text-[13px] leading-[18px] text-wd-ink-2">Lifetime earned appears once they&apos;re checked.</span>
        </div>
      )}

      {!loading && !failed && (
        <>
          <div className="flex flex-col gap-0.5">
            <div className="font-display text-wd-l font-semibold text-wd-ink">
              {lowerBound && <span className="mr-[0.3em] text-[0.5em] font-semibold tracking-normal text-wd-ink-2">At least</span>}
              {tok(l.hnt ?? 0)}
              <span className="ml-[0.22em] text-[0.5em] font-semibold tracking-normal text-wd-ink-3">HNT</span>
              {scanning && <span className="ml-[0.45em] font-sans text-sm font-medium tracking-normal text-wd-ink-2">so far</span>}
            </div>
            {usd == null && money.walletValue.state === "loading" ? (
              <Skeleton w={180} h={14} className="mt-1 max-w-full" />
            ) : (
              <span className="text-[13px] leading-[18px] text-wd-ink-2">
                {usd == null
                  ? "USD at today's prices unavailable."
                  : `${fmtUsd(usd)}${scanning ? " so far, at today's prices." : " at today's prices."}${legacy.length ? " Includes legacy tokens." : ""}`}
              </span>
            )}
            <span className="text-wd-cap text-wd-ink-3">{sub}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-wd-well px-3 py-2.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-wd-cap text-wd-ink-2">Claimed</span>
              <span className="font-display text-[15px] font-semibold leading-5 text-wd-ink">
                {tok(l.claimed ?? 0)} HNT{sofar}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-wd-cap text-wd-ink-2">Unclaimed</span>
              <span className="font-display text-[15px] font-semibold leading-5 text-wd-ink">
                {l.unclaimed > 0 ? `${tok(l.unclaimed)} HNT${sofar}` : scanning ? "None so far" : "None"}
              </span>
            </div>
          </div>
          {lowerBound && (
            <div className="flex items-start gap-2 pt-1 text-[13px] leading-[18px] text-wd-ink-2">
              <StatusMark tier="unknown" className="mt-[3px]" />
              <span>
                {plural(unconfirmed, "Hotspot")} {unconfirmed === 1 ? "is" : "are"} counted at the HNT{" "}
                {unconfirmed === 1 ? "it has" : "they have"} claimed, because {unconfirmed === 1 ? "its" : "their"} unclaimed HNT
                couldn&apos;t be confirmed right now. This is a lower bound.
              </span>
            </div>
          )}
          {legacy.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-wd-line-2 pt-3">
              <span className="text-xs font-semibold text-wd-ink-2">{scanning ? "Legacy tokens, so far" : "Legacy tokens"}</span>
              {legacy.map(([k, t]) => (
                <div key={k} className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-[18px] text-wd-ink-2">
                  <span className="font-display text-sm font-medium leading-5 tracking-[-0.01em]">{tok(l.legacy[k])}</span>
                  <span>{t}</span>
                  <Tag>legacy</Tag>
                </div>
              ))}
              <span className="text-wd-cap text-wd-ink-3">Earned before Hotspot rewards moved to HNT. Not included in the HNT figure.</span>
            </div>
          )}
        </>
      )}
    </Card>
  );
});
