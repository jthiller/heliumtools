import { memo } from "react";
import { CopyIconButton, ExtLink, InfoTip, Skeleton } from "../ui/index.js";
import { accountUrl, fmtCount, fmtUtcDate, plural, shortAddress } from "../format.js";
import { ONBOARDED_NOTE } from "../copy.js";
import DataStatus from "./DataStatus.jsx";

// Btn2's look for the Solscan link (ExtLink takes the classes whole).
const BTN2 =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-wd-control bg-surface-raised px-3 text-[13px] font-medium text-wd-ink transition hover:bg-wd-well hover:no-underline md:min-h-8 md:text-xs";

/** "8 Mobile, 2 IoT" from /summary's primary-network counts (the fleet failed, so no sites). */
function byNetworkText(byNetwork) {
  const parts = [];
  if (byNetwork?.mobile) parts.push(`${fmtCount(byNetwork.mobile)} Mobile`);
  if (byNetwork?.iot) parts.push(`${fmtCount(byNetwork.iot)} IoT`);
  return parts.join(", ");
}

/** "Onboarded Apr 24, 2023 to Dec 4, 2024 (UTC)", "All onboarded Aug 5, 2025 (UTC)", or null. */
function onboardRange(stats, total) {
  if (!stats?.oldest) return null;
  const first = fmtUtcDate(stats.oldest);
  const last = fmtUtcDate(stats.newest);
  if (first === last) return total > 1 && stats.dated === total ? `All onboarded ${first} (UTC)` : `Onboarded ${first} (UTC)`;
  return `Onboarded ${first} to ${last} (UTC)`;
}

/**
 * The page's identity: the "Wallet" eyebrow, the h1 (the short address, the
 * full one for screen readers), Copy wallet address, the fleet caption
 * (`places.caption()` plus the onboard range and its InfoTip), and the
 * actions: Data status, Copy link (this exact view: filters, sort and the
 * open Hotspot are in the URL) and Solscan.
 */
export default memo(function IdentityRow({ wallet, places, summary, fleetState, onboarding, governance, status }) {
  const total = places?.counts.total ?? 0;
  let caption = null;
  let onb = null;
  let onbTip = false;
  if (fleetState.state === "failed") {
    const count = summary.data?.fleet?.count;
    const split = byNetworkText(summary.data?.fleet?.byNetwork);
    caption = count != null ? `${plural(count, "Hotspot")}${split ? ` · ${split}` : ""}` : "Hotspots couldn't load";
    if (count) onb = "Onboard dates couldn't load";
  } else if (places) {
    caption = places.caption();
    if (total === 0) {
      const n = Number(governance.data?.totals?.positionCount) || 0;
      if (n > 0) caption += ` · ${plural(n, "veHNT position")}`;
    } else if (!onboarding.done) onb = "Onboard dates: checking";
    else if (onboarding.retrying) onb = "Onboard dates: retrying";
    else {
      const range = onboardRange(onboarding.stats, total);
      const failed = onboarding.failed ?? 0;
      // A range from the dates that loaded, and how many couldn't be read.
      onb =
        failed > 0
          ? range
            ? `${range} · ${plural(failed, "onboard date")} couldn't load`
            : "Onboard dates couldn't load"
          : range;
      onbTip = Boolean(range);
    }
  }

  return (
    <div
      data-wd-card="identity"
      className="mb-3.5 flex flex-col items-stretch gap-3 md:mb-[18px] md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-x-6 md:gap-y-3.5"
    >
      <div className="flex min-w-0 flex-col gap-1.5 md:flex-[1_1_440px]">
        <span className="font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-3">Wallet</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 id="summary-title" className="m-0 min-w-0 font-display text-wd-h1-sm font-semibold text-wd-ink md:text-wd-h1">
            <span aria-hidden="true">{shortAddress(wallet)}</span>
            <span className="sr-only">Wallet {wallet}</span>
          </h1>
          <CopyIconButton text={wallet} label="Copy wallet address" copiedText="Wallet address copied" />
        </div>
        {caption == null ? (
          <Skeleton w={440} h={14} className="my-0.5 max-w-full" />
        ) : (
          <p className="m-0 text-[13px] leading-5 text-wd-ink-2">
            <span>{onb ? `${caption} · ${onb}` : caption}</span>
            {onbTip && (
              <span className="ml-1.5 inline-flex align-middle">
                <InfoTip label="onboard dates">{ONBOARDED_NOTE}</InfoTip>
              </span>
            )}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
        <DataStatus status={status} wallet={wallet} />
        {/* One cell, so a "Couldn't copy" message stays under its button. */}
        <div className="flex min-w-0 flex-col gap-1">
          <CopyIconButton
            text={() => window.location.href}
            copiedText="Link copied."
            icon={false}
            className="w-full justify-center text-[13px] md:w-auto md:text-xs"
          >
            Copy link
          </CopyIconButton>
        </div>
        <ExtLink href={accountUrl(wallet)} className={`${BTN2} w-full md:w-auto`}>
          Solscan
        </ExtLink>
      </div>
    </div>
  );
});
