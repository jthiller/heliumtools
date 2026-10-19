import { memo } from "react";
import { Card, CardHead, StatusMark } from "../ui/index.js";
import { NetDot } from "../ui/NetDot.jsx";
import { fmtCount, plural } from "../format.js";

const EYEBROW = "font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-3";
const CAP = "text-wd-cap text-wd-ink-3";
const LINK = "min-h-6 shrink-0 cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-wd-sm font-medium text-accent-text hover:underline max-md:min-h-11";

/** A block inside an About card: eyebrow and caption over its content. */
export function Block({ eyebrow, caption, className = "", children }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2.5 [&+&]:border-t [&+&]:border-wd-line-2 [&+&]:pt-4 ${className}`}>
      {(eyebrow || caption) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {eyebrow && <span className={EYEBROW}>{eyebrow}</span>}
          {caption && <span className={CAP}>{caption}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** "View in list" and the like: a text button (it filters the list, it doesn't navigate). */
export function TextButton({ onClick, label, children, ...rest }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={LINK} {...rest}>
      {children}
    </button>
  );
}

/**
 * One ranked row (a device, a city): label, count, share of the fleet and a
 * track sized to that share; a button that shows those Hotspots in the list.
 * Without `onClick` it renders the same row, static.
 */
export function RankRow({ label, lead, tag, count, share, width, onClick, ariaLabel }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        {lead}
        <span>{label}</span>
        {tag}
      </span>
      <span className="flex items-baseline gap-2.5 whitespace-nowrap">
        <span className="font-display font-semibold tabular-nums text-wd-ink">{fmtCount(count)}</span>
        <span className={`${CAP} min-w-[46px] text-right tabular-nums`}>{share}</span>
        <span aria-hidden="true" className={`w-2 text-base leading-4 text-wd-ink-3 ${onClick ? "" : "invisible"}`}>
          ›
        </span>
      </span>
      <span aria-hidden="true" className="col-span-2 block h-1 overflow-hidden rounded-full bg-wd-line">
        <i className="block h-full min-w-[2px] rounded-full bg-wd-ink-3" style={{ width }} />
      </span>
    </>
  );
  const cls =
    "-mx-2.5 grid min-h-10 w-[calc(100%+20px)] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg border-0 bg-transparent px-2.5 pb-[9px] pt-[7px] text-left text-sm text-wd-ink max-md:min-h-11";
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={`${cls} cursor-pointer hover:bg-wd-well`}>
      {body}
    </button>
  );
}

/** A Hotspot name that opens its detail (a link to `?hotspot=`; a plain click stays on the page). */
export function HotspotName({ item, onOpenHotspot, className = "" }) {
  return (
    <a
      href={`?hotspot=${encodeURIComponent(item.param)}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpenHotspot(item.param, e.currentTarget);
      }}
      className={className}
    >
      {item.name}
    </a>
  );
}

function RewardedMeter({ r, onShow }) {
  const T = r.total;
  const pct = (n) => `${T ? ((n / T) * 100).toFixed(2) : 0}%`;
  const scanning = r.state === "scanning" || r.state === "checking";
  let figure;
  let word = scanning && r.state === "scanning" ? "rewarded so far" : "rewarded";
  let valueText;
  if (r.state === "checking") {
    figure = (
      <>
        <span aria-hidden="true">…</span>
        <span className="sr-only">Checking</span>
      </>
    );
    valueText = "Checking rewards";
  } else if (r.state === "failed") {
    figure = null;
    word = "Couldn't check rewards";
    valueText = "Couldn't check rewards";
  } else if (r.state === "scanning") {
    figure = `${fmtCount(r.rewarded)} of ${fmtCount(r.checked)}`;
    valueText = `${fmtCount(r.rewarded)} rewarded of ${fmtCount(r.checked)} checked so far, ${plural(T, "Hotspot")} in all`;
  } else {
    figure = `${fmtCount(r.rewarded)} of ${fmtCount(T)}`;
    valueText = `${fmtCount(r.rewarded)} of ${fmtCount(T)} rewarded`;
  }
  const unchecked = T - r.checked;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={EYEBROW}>Rewarded</span>
        <span className={CAP}>Lifetime, any token</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        {figure != null && <span className="font-display text-wd-s font-semibold tracking-[-0.02em] text-wd-ink">{figure}</span>}
        <span className="text-wd-sm text-wd-ink-2">{word}</span>
      </div>
      <div
        role="meter"
        aria-label="Rewarded Hotspots"
        aria-valuemin={0}
        aria-valuemax={T}
        aria-valuenow={r.rewarded}
        aria-valuetext={valueText}
        className="flex h-2 overflow-hidden rounded-full bg-wd-line"
      >
        <span className="block h-full flex-none rounded-full bg-wd-ink-3" style={{ width: pct(r.rewarded) }} />
        <span className="block h-full flex-none" style={{ width: pct(r.never) }} />
        {unchecked > 0 && <span className="wd-hatch block h-full flex-none" style={{ width: pct(unchecked) }} />}
      </div>
      {scanning && <span className={CAP}>{`Checking ${fmtCount(r.checked)} of ${plural(T, "Hotspot")}…`}</span>}
      {!scanning && r.unchecked > 0 && r.state !== "failed" && (
        <span className={CAP}>{`${plural(r.unchecked, "Hotspot")} couldn't be checked.`}</span>
      )}
      {r.never > 0 && (
        <div className="flex min-h-6 items-center gap-2 text-wd-sm max-md:min-h-11">
          <StatusMark tier="quiet" />
          <span className="min-w-0">{`${fmtCount(r.never)} never rewarded${scanning ? " so far" : ""}`}</span>
          <span className="ml-auto pl-2">
            <TextButton onClick={() => onShow({ status: "neverRewarded" })} label="View the never rewarded Hotspots in the list">
              View in list
            </TextButton>
          </span>
        </div>
      )}
    </div>
  );
}

function LocationFact({ unasserted, total, onShow }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={EYEBROW}>Location</span>
        <span className={CAP}>On-chain</span>
      </div>
      <div className="flex min-h-6 items-center gap-2 text-wd-sm max-md:min-h-11">
        {unasserted > 0 ? (
          <>
            <StatusMark tier="quiet" />
            <span className="min-w-0">{`${fmtCount(unasserted)} without an asserted location`}</span>
            <span className="ml-auto pl-2">
              <TextButton onClick={() => onShow({ status: "noLocation" })} label="View the Hotspots without an asserted location in the list">
                View in list
              </TextButton>
            </span>
          </>
        ) : (
          <>
            <StatusMark tier="ok" />
            <span className="min-w-0 text-wd-ink-2">
              {total === 2 ? "Both have an asserted location" : `All ${fmtCount(total)} have an asserted location`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * About: Composition. The network split (one stacked bar, each Hotspot
 * once), devices (each row shows that device type in the list), the
 * rewarded share as a meter (unchecked Hotspots hatched, never drawn as
 * never rewarded) and the asserted-location fact. `model` is
 * aboutModel.compositionOf; `onShow(patch)` filters the list.
 */
export default memo(function Composition({ model, onShow, className = "" }) {
  const { total, parts, splitLabel, dualNote, devices, rewarded, unasserted } = model;
  return (
    <Card as="article" aria-labelledby="about-comp-title" className={`flex flex-col gap-4 ${className}`}>
      <CardHead id="about-comp-title" title="Composition" />
      <Block eyebrow="Network">
        <div role="img" aria-label={splitLabel} className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {parts.map((p) => (
            <i key={p.key} className={`block h-full min-w-[3px] ${p.fill}`} style={{ flex: `${p.count} 1 0px` }} />
          ))}
        </div>
        <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center gap-[7px] text-wd-sm">
              <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[3px] ${p.fill}`} />
              <span className="font-semibold text-wd-ink">{p.label}</span>
              <span className="font-display font-semibold tabular-nums text-wd-ink">{fmtCount(p.count)}</span>
              <span className={CAP}>{p.share}</span>
            </li>
          ))}
        </ul>
        {dualNote && <p className={`m-0 ${CAP}`}>{dualNote}</p>}
      </Block>
      <Block eyebrow="Devices" caption={`Share of all ${plural(total, "Hotspot")}`}>
        <ul className="m-0 flex list-none flex-col p-0">
          {devices.map((d) => (
            <li key={d.key}>
              <RankRow
                label={d.label}
                lead={d.net ? <NetDot net={d.net} /> : <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full border-[1.5px] border-wd-ink-3" />}
                count={d.count}
                share={d.share}
                width={d.width}
                onClick={() => onShow({ device: d.key })}
                ariaLabel={`${d.label}: ${plural(d.count, "Hotspot")}, ${d.share} of the fleet. Show them in the Hotspot list.`}
              />
            </li>
          ))}
        </ul>
      </Block>
      <Block>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 xl:grid-cols-2">
          <RewardedMeter r={rewarded} onShow={onShow} />
          <LocationFact unasserted={unasserted} total={total} onShow={onShow} />
        </div>
      </Block>
    </Card>
  );
});
