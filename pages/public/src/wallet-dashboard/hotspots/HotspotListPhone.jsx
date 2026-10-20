import { memo } from "react";
import { NOT_TRACKED } from "../copy.js";
import { TIERS } from "../statusRegistry.js";
import { Card, Empty } from "../ui/Card.jsx";
import { Btn2 } from "../ui/Controls.jsx";
import { NetDot } from "../ui/NetDot.jsx";
import { Pending } from "../ui/Pending.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { Sparkline } from "../ui/Sparkline.jsx";
import { StatusMark } from "../ui/StatusMark.jsx";
import { StateLabel, markOf } from "./StatusCell.jsx";
import Pager from "./Pager.jsx";
import {
  dayModel,
  lifetimeModel,
  messagesModel,
  noDailyText,
  onboardedModel,
  sublineOf,
  unclaimedModel,
  weekModel,
} from "./HotspotRow.jsx";

const NO_DAILY = { text: NOT_TRACKED, num: false };

// The figure strip's third cell follows the sort: Lifetime, or the sorted
// figure (Oct 14, Onboarded, Messages) with its label.
function stripOf(row, { iot, sortKey, dayLabel, wallet }) {
  const daily = !noDailyText(row);
  const unclaimed = { k: "Unclaimed", m: unclaimedModel(row, wallet), unit: "HNT" };
  const lifetime = { k: "Lifetime", m: lifetimeModel(row), unit: "HNT" };
  const messages = { k: "Messages, 30 days", m: messagesModel(row) };
  let third = lifetime;
  if (sortKey === "day") third = { k: dayLabel, m: daily ? dayModel(row) : NO_DAILY, unit: "HNT" };
  else if (sortKey === "onboarded") third = { k: "Onboarded", m: onboardedModel(row) };
  else if (sortKey === "messages") third = messages;
  if (iot) return [unclaimed, messages, third === messages ? lifetime : third];
  const week = daily ? { k: "7 days", m: weekModel(row), unit: "HNT", spark: true } : { k: "7 days", m: NO_DAILY };
  return [unclaimed, week, third];
}

function StripValue({ m, unit }) {
  if (m.pending) return <Pending className="text-wd-ink-2" />;
  if (!m.num) return <span className="font-sans text-wd-sm font-normal text-wd-ink-2">{m.text}</span>;
  return (
    <span>
      {m.text}
      {unit && <span className="sr-only"> {unit}</span>}
    </span>
  );
}

const LI =
  "relative flex min-h-24 flex-col gap-1 border-t border-wd-line-2 px-4 py-3 has-[:focus-visible]:rounded-lg has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent-text";

/**
 * One Hotspot as a phone list row (JUDGE 10): A the name (a stretched link,
 * so the whole row is one tap target) and a chevron; B the network dot,
 * device and place (only the place truncates); C the top state's mark, label
 * and window, "+1 more" for further states; D a three-figure strip
 * (Unclaimed, 7 days with a 34 px sparkline from 360 px, Lifetime or the
 * sorted figure). Read as "Link, {name}. {device}, {place}. Check: {state}
 * {window}. Unclaimed … HNT. 7 days … HNT. Lifetime … HNT."
 */
const PhoneRow = memo(function PhoneRow({ row, iot, sortKey, dayLabel, selected, noLonger, scaleMax, wallet, href, onOpen }) {
  const sub = sublineOf(row);
  const top = row.states[0];
  const tier = TIERS[top.tier] ?? TIERS.unknown;
  const win = [top.window, top.window2].filter(Boolean).join(" · ");
  const strip = stripOf(row, { iot, sortKey, dayLabel, wallet });
  const onLink = (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(row.param, e.currentTarget);
  };
  return (
    <li aria-current={selected ? "true" : undefined} className={`${LI} ${selected ? "bg-accent-surface" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <a
          href={href}
          data-hotspot-link={row.param}
          onClick={onLink}
          className="text-[15px] font-semibold leading-5 text-wd-ink after:absolute after:inset-0 after:content-[''] hover:opacity-100 focus-visible:!outline-none"
        >
          {row.name || "Unnamed Hotspot"}
        </a>
        <span aria-hidden="true" className="shrink-0 text-xl leading-5 text-wd-ink-3">
          ›
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-wd-cap text-wd-ink-2">
        {sub.dots && <NetDot net={sub.dots[0]} second={sub.dots[1]} />}
        <span className="shrink-0 whitespace-nowrap">{sub.device} ·</span>
        <span className="min-w-0 truncate">{sub.place}</span>
      </div>
      <p className="m-0 text-wd-sm text-wd-ink-2">
        <StatusMark tier={top.tier} mark={markOf(top.key)} className="mr-1.5 inline-block align-[-1px]" />
        <span className={`font-semibold ${tier.textClass}`}>
          <StateLabel state={top} />
        </span>
        {win && <span> · {win}</span>}
        {row.states.length > 1 && <span> · +{row.states.length - 1} more</span>}
      </p>
      {noLonger && (
        <span className="self-start rounded-full border border-wd-control px-1.5 text-[11px] font-medium leading-4 text-wd-ink-2">
          No longer matches
        </span>
      )}
      <dl className="m-0 mt-1.5 grid grid-cols-3 gap-2">
        {strip.map((s) => (
          <div key={s.k} className="min-w-0">
            <dt className="text-[11px] leading-4 text-wd-ink-3">{s.k}</dt>
            <dd className="m-0 flex flex-wrap items-end gap-1.5 font-display text-[15px] font-semibold leading-5 tabular-nums text-wd-ink">
              <StripValue m={s.m} unit={s.unit} />
              {s.spark && s.m.spark && (
                <Sparkline days={row.week.days} scaleMax={scaleMax} size={14} className="max-[359px]:hidden" />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
});

function SkeletonItem() {
  return (
    <li className={LI}>
      <Skeleton w={180} h={14} className="mb-1 mt-[3px] max-w-full" />
      <Skeleton w={132} h={10} className="max-w-full" />
      <span className="sr-only">Loading Hotspot</span>
      <p className="m-0 flex items-center gap-1.5 text-wd-sm font-semibold text-wd-ink-2">
        <StatusMark tier="checking" />
        Checking…
      </p>
      <dl className="m-0 mt-1.5 grid grid-cols-3 gap-2">
        {["Unclaimed", "7 days", "Lifetime"].map((k) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] leading-4 text-wd-ink-3">{k}</dt>
            <dd className="m-0 font-display text-[15px] font-semibold leading-5 text-wd-ink-2">
              <Pending />
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/**
 * The phone Hotspot list (below 768 px; the section picks one renderer, never
 * both): labelled groups of rows, the "Show 50 more" pager, the totals strip,
 * and the empty state. `iot`: the Messages column set (IoT network filter, or
 * a wallet with no Mobile Hotspot). `total`: { lead, body, sub, notes } (notes
 * are the table footer's Unclaimed lines, a paragraph each).
 */
export default function HotspotListPhone({
  groups,
  skeleton = 0,
  iot,
  sortKey,
  dayLabel,
  busy,
  rowProps,
  pager,
  total,
  empty,
}) {
  return (
    <Card pad={false} className="mt-3">
      {empty ? (
        <Empty action={<Btn2 onClick={empty.onClear}>Clear filters</Btn2>}>{empty.text}</Empty>
      ) : (
        <>
          {skeleton > 0 ? (
            <ul aria-busy="true" className="m-0 list-none p-0 [&>li:first-child]:border-t-0">
              {Array.from({ length: skeleton }, (_, i) => (
                <SkeletonItem key={i} />
              ))}
            </ul>
          ) : (
            groups.map((g, gi) => (
              <div key={g.kind ?? `g${gi}`}>
                {g.label && (
                  <h3 className="m-0 bg-wd-well px-4 py-2 font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-wd-ink-2">
                    {g.label}
                  </h3>
                )}
                <ul aria-busy={busy || undefined} className={`m-0 list-none p-0 ${gi === 0 && !g.label ? "[&>li:first-child]:border-t-0" : ""}`}>
                  {g.rows.map((r) => (
                    <PhoneRow
                      key={r.key}
                      row={r}
                      iot={iot}
                      sortKey={sortKey}
                      dayLabel={dayLabel}
                      selected={r.key === rowProps.selectedKey}
                      noLonger={rowProps.noLongerMatches.has(r.key)}
                      scaleMax={rowProps.scaleMax}
                      wallet={rowProps.wallet}
                      href={rowProps.hrefFor(r.param)}
                      onOpen={rowProps.onOpen}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
          {pager && <Pager phone {...pager} />}
          {total && (
            // The totals and each note are paragraphs of their own, so a
            // screen reader reads them as separate sentences (an sr-only "."
            // between them is absolutely positioned, a block, and read with
            // a space before it).
            <div className="rounded-b-2xl border-t border-wd-line bg-wd-well px-4 py-3 text-wd-sm text-wd-ink-2">
              <p className="m-0">
                {total.lead} <b className="font-semibold text-wd-ink">{total.body}</b>
                {total.sub && <span> · {total.sub}</span>}
              </p>
              {total.notes?.map((n) => (
                <p key={n} className="m-0 mt-0.5 text-wd-cap">
                  {n}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
