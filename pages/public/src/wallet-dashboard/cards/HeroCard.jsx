import { useState } from "react";
import {
  ArrowTopRightOnSquareIcon,
  LinkIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import CopyButton from "../../components/CopyButton.jsx";
import { Skeleton } from "./primitives.jsx";
import { fmtUsd, fmtCount, fmtDate, truncateString, accountUrl, unclaimedTotalUsd } from "../format.js";

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-content-secondary transition hover:border-content-tertiary hover:text-content"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <LinkIcon className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function HeroStat({ label, value, valueClass = "text-content", sub }) {
  return (
    <div className="px-5 first:pl-0">
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-content-tertiary">
        {label}
      </div>
      <div className={`mt-1.5 font-display text-xl font-semibold tabular-nums tracking-[-0.01em] ${valueClass}`}>
        {value}
      </div>
      {sub != null && <div className="mt-0.5 text-[11px] text-content-tertiary">{sub}</div>}
    </div>
  );
}

export default function HeroCard({ wallet, summary, loading, rewards, rewardsDone, rewardsUnavailable, iotStatus, iotStatusDone, prices, governance, govLoading }) {
  const counted = rewards?.counted || 0;
  const earningPct = counted ? Math.round((rewards.earning / counted) * 100) : null;
  // IoT connectivity: share of IoT Hotspots the liveness feed actually REPORTED
  // on (active + inactive) that connected during its most recent reported day.
  // Unknown (failed lookups) and setting-up Hotspots are excluded from the
  // denominator — otherwise an api-iot outage would render as "IoT Active 0%",
  // indistinguishable from the whole fleet being offline.
  const iotKnown = (iotStatus?.active || 0) + (iotStatus?.inactive || 0);
  const iotActivePct = iotKnown ? Math.round((iotStatus.active / iotKnown) * 100) : null;
  // Wallet-wide unclaimed value: Hotspot pending + veHNT delegation pending.
  const unclaimedUsd = unclaimedTotalUsd(rewards, governance, prices);
  // "…" only while a source is still loading and we have nothing yet.
  const unclaimedLoading = (!rewardsDone || govLoading) && unclaimedUsd === 0;
  const fleetCount = summary?.fleet?.count;

  return (
    <section className="relative overflow-hidden rounded-2xl bg-surface-raised shadow-soft lg:col-span-12">
      {/* Atmosphere: dot grid + a soft teal glow (echoes the landing hero). */}
      <div className="pointer-events-none absolute inset-0 bg-grid-slate opacity-40 [background-size:22px_22px] dark:opacity-20" />
      <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative flex flex-col gap-7 p-6 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-content-tertiary">
            <span className="font-mono text-content-secondary">{truncateString(wallet, 6, 6)}</span>
            <CopyButton text={wallet} />
            <a
              href={accountUrl(wallet)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-accent-text hover:underline"
            >
              Explorer <ArrowTopRightOnSquareIcon className="h-3 w-3" />
            </a>
            <CopyLinkButton />
          </div>

          <div className="mt-5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-content-tertiary">
            Portfolio value
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-12 w-56" />
          ) : (
            <div className="font-display text-[2.75rem] font-bold leading-none tracking-[-0.04em] text-content tabular-nums sm:text-6xl">
              {fmtUsd(summary?.totalUsd)}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-stretch gap-y-5 divide-x divide-border">
          <HeroStat label="Hotspots" value={loading ? "—" : fmtCount(fleetCount)} />
          <HeroStat label="Oldest Hotspot" value={loading ? "—" : fmtDate(summary?.fleet?.oldestCreatedAt)} />
          {(iotStatus?.iotTotal || 0) > 0 && (
            <HeroStat
              label="IoT Active"
              value={iotActivePct == null ? (iotStatusDone ? "—" : "…") : `${iotActivePct}%`}
              sub={iotKnown ? `${iotStatus.active} of ${iotKnown} reported` : null}
            />
          )}
          <HeroStat
            label="Earning"
            value={earningPct == null ? (rewardsDone ? "—" : "…") : `${earningPct}%`}
            sub={counted ? `${rewards.earning} of ${counted}` : null}
          />
          <HeroStat
            label="Unclaimed"
            value={rewardsUnavailable ? "—" : unclaimedLoading ? "…" : fmtUsd(unclaimedUsd)}
            valueClass="text-emerald-600 dark:text-emerald-400"
          />
        </div>
      </div>
    </section>
  );
}
