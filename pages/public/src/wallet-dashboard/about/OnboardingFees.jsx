import { memo } from "react";
import { Card, CardHead } from "../ui/index.js";
import { NetDot } from "../ui/NetDot.jsx";
import { fmtUtcDate, ONBOARDED_NOTE } from "../format.js";
import { hotspotOnboardedAt } from "./aboutModel.js";
import { HotspotName } from "./Composition.jsx";

const CAP = "text-wd-cap text-wd-ink-3";

function DateRow({ label, iso, done, list, onOpenHotspot }) {
  const who = done ? hotspotOnboardedAt(list, iso) : null;
  return (
    <div>
      <dt className="text-wd-cap text-wd-ink-3">{label}</dt>
      <dd className="m-0 mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {done ? (
          <span className="font-semibold text-wd-ink">{iso ? `${fmtUtcDate(iso)} (UTC)` : "Unknown"}</span>
        ) : (
          <>
            <span aria-hidden="true" className="font-semibold text-wd-ink">
              …
            </span>
            <span className="sr-only">Waiting on onboard dates</span>
          </>
        )}
        {who && <HotspotName item={who} onOpenHotspot={onOpenHotspot} className="text-accent-text hover:underline" />}
      </dd>
    </div>
  );
}

/**
 * About: Onboarding fees (DC first, then USD at the fixed DC price; one line
 * per network and fee, Hotspots with no fee on record, the dual-network
 * rule) and the first and latest onboard dates, named for fleets of 200 or
 * fewer. `model` is aboutModel.feesOf; `showDates` is false when the
 * timeline already reads as one month's sentence.
 */
export default memo(function OnboardingFees({ model, onboarding, list, showDates, onOpenHotspot, className = "" }) {
  const stats = onboarding.stats;
  return (
    <Card as="article" aria-labelledby="about-fees-title" className={`flex flex-col gap-4 ${className}`}>
      <CardHead id="about-fees-title" title="Onboarding fees" right={<span className={CAP}>Location fees not included</span>} />
      <div className="flex min-w-0 flex-col gap-4 md:max-xl:grid md:max-xl:grid-cols-2 md:max-xl:gap-x-8">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="whitespace-nowrap font-display text-wd-m font-semibold text-wd-ink">
              {model.dcText}
              <span className="ml-[0.22em] text-[0.5em] font-semibold tracking-normal text-wd-ink-3">DC</span>
            </span>
            <span className="text-wd-sm text-wd-ink-2">· {model.usd}</span>
          </div>
          <span className={CAP}>At the fixed DC price, 100,000 DC = $1.</span>
          <ul className="m-0 list-none p-0">
            {model.lines.map((g) => (
              <li
                key={g.key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-t border-wd-line-2 py-2 text-wd-sm"
              >
                <span className="flex min-w-0 items-center gap-2 text-wd-ink-2">
                  {g.net ? (
                    <NetDot net={g.net} />
                  ) : (
                    <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full border-[1.5px] border-wd-ink-3" />
                  )}
                  {g.label}
                </span>
                <span className="whitespace-nowrap text-right font-display font-semibold tabular-nums text-wd-ink">{g.value}</span>
              </li>
            ))}
          </ul>
          {model.note && <p className={`m-0 ${CAP}`}>{model.note}</p>}
        </div>
        {showDates && (
          <div className="flex min-w-0 flex-col gap-2.5 border-t border-wd-line-2 pt-4 md:max-xl:border-t-0 md:max-xl:pt-0">
            <dl className="m-0 flex flex-col gap-3">
              <DateRow label="First onboarded" iso={stats?.oldest} done={onboarding.done} list={list} onOpenHotspot={onOpenHotspot} />
              <DateRow label="Latest onboarded" iso={stats?.newest} done={onboarding.done} list={list} onOpenHotspot={onOpenHotspot} />
            </dl>
            {!onboarding.done && <span className={CAP}>Waiting on onboard dates.</span>}
            <p className={`m-0 ${CAP}`}>{ONBOARDED_NOTE}</p>
          </div>
        )}
      </div>
    </Card>
  );
});
