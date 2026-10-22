import { memo, useMemo } from "react";
import { CLAIM_LABEL, DAY_MISSING_NOTE, LOWER_BOUND_NOTE, UNCLAIMED_NOTE, USERS_NOTE, noDailyNote } from "../copy.js";
import { fmtBytes, fmtCount, fmtDataDay, fmtHnt, fmtToken, fmtUsd, shortAddress } from "../format.js";
import { DayBars } from "../ui/DayBars.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";
import { InfoTip } from "../ui/InfoTip.jsx";
import { Pending } from "../ui/Pending.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { DSection, DSub, Foot, LINK_H, RetryBtn, SUMMARY, TIP, Well } from "./parts.jsx";

const dayHnt = (v) => fmtHnt(v, "day");
const NO_DAILY = { iot: noDailyNote("This Hotspot"), cbrs: noDailyNote("This Hotspot"), none: noDailyNote("This Hotspot") };

/** "<1%", ">99%", "12%": this Hotspot's part of the wallet's 7-day HNT. */
function fmtPct(v) {
  if (v === 0) return "0%";
  if (v < 1) return "<1%";
  if (v > 99 && v < 100) return ">99%";
  return `${Math.round(v)}%`;
}

/** A stat: mono eyebrow (with an optional InfoTip), the figure, lines under it. */
function Figure({ label, tip, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-3">{label}</span>
        {tip}
      </div>
      {children}
    </div>
  );
}

function Hnt({ text }) {
  return (
    <div className="font-display text-wd-m font-semibold text-wd-ink">
      {text}
      <span className="ml-[0.22em] text-[0.5em] font-semibold tracking-normal text-wd-ink-3">HNT</span>
    </div>
  );
}

function Loading({ w1, w2 }) {
  return (
    <>
      <Skeleton w={w1} h={24} className="my-[3px]" />
      <span className="sr-only">Loading</span>
      <Skeleton w={w2} h={12} />
    </>
  );
}

const Sm = ({ strong, children }) => (
  <span className={`text-wd-sm ${strong ? "font-semibold text-wd-ink" : "text-wd-ink-2"}`}>{children}</span>
);

/** Unclaimed: the HNT pending for this Hotspot, its USD at today's price and
 * whether it can be claimed (the claimer stays the authority). */
function Unclaimed({ u, price, onRetry }) {
  if (u.state === "loading") return <Loading w1={92} w2={120} />;
  if (u.state === "failed") {
    return (
      <>
        <Sm>Couldn&apos;t load</Sm>
        {onRetry && (
          <div className="mt-1">
            <RetryBtn onClick={onRetry} label="Retry rewards" />
          </div>
        )}
      </>
    );
  }
  if (u.state === "unavailable") return <Sm>Unavailable</Sm>;
  if (u.state === "unconfirmed") return <Sm strong>Couldn&apos;t confirm right now.</Sm>;
  const nothing = !(u.hnt > 0) || u.reason === "no_pending";
  const claim = nothing
    ? "Nothing to claim"
    : u.reason === "no_ata"
      ? "Can't claim yet. This wallet needs an HNT token account."
      : u.claimable
        ? "Claimable now"
        : "Not claimable right now.";
  return (
    <>
      <Hnt text={fmtHnt(u.hnt, "stat")} />
      {!nothing && price != null && <Sm>{fmtUsd(u.hnt * price)} at today&apos;s price</Sm>}
      <Sm strong={!nothing}>{claim}</Sm>
    </>
  );
}

/** Lifetime earned, with what's been claimed; a lower bound when the
 * unclaimed part couldn't be confirmed. */
function Lifetime({ l }) {
  if (l.state === "loading") return <Loading w1={110} w2={140} />;
  if (l.state === "failed") return <Sm>Couldn&apos;t load</Sm>;
  if (l.state === "unavailable") return <Sm>Unavailable</Sm>;
  if (l.lowerBound) {
    return (
      <>
        <Hnt text={`≥ ${fmtHnt(l.claimed, "stat")}`} />
        <Sm>Claimed so far, a lower bound</Sm>
      </>
    );
  }
  return (
    <>
      <Hnt text={fmtHnt(l.hnt, "stat")} />
      <Sm>{l.never ? "Never rewarded" : `Claimed ${fmtHnt(l.claimed, "stat")} HNT`}</Sm>
    </>
  );
}

/** "127,408.27 MOBILE lifetime, all claimed." per legacy token with any lifetime. */
function legacyText(lifetime, unclaimed) {
  const parts = [];
  for (const [t, label] of [
    ["mobile", "MOBILE"],
    ["iot", "IOT"],
  ]) {
    const life = lifetime.legacy?.[t] ?? 0;
    if (!(life > 0)) continue;
    const pending = unclaimed.legacy?.[t] ?? 0;
    parts.push(
      `${fmtToken(life, { max: 2 })} ${label} lifetime, ${pending > 0 ? `${fmtToken(pending, { max: 2 })} unclaimed` : "all claimed"}.`,
    );
  }
  return parts.length ? parts.join(" ") : "None on record.";
}

/** The readout over the 7 bars: the day, its HNT and what it was paid for
 * ("Checking 7 days…" while none has loaded). */
function dayReadout(d, checking) {
  const label = d.day ? `${fmtDataDay(d.day)} (UTC)` : "This day";
  if (d.state === "missing") {
    return [<span key="d" className="text-wd-sm font-semibold text-wd-ink">No data for {label}</span>, <span key="s" className="text-wd-sm text-wd-ink-2">{DAY_MISSING_NOTE}</span>];
  }
  if (d.state === "failed") {
    return [<span key="d" className="text-wd-sm font-semibold text-wd-ink">Couldn&apos;t load {label}</span>, <span key="s" className="text-wd-sm text-wd-ink-2">Left out of the total until it loads.</span>];
  }
  if (d.state !== "ok") {
    const all = checking || !d.day;
    return [<span key="d" className="text-wd-sm font-semibold text-wd-ink">{all ? "Checking 7 days…" : label}</span>, all ? null : <span key="s" className="text-wd-sm text-wd-ink-2">Loading…</span>];
  }
  return [
    <span key="d" className="text-wd-sm font-semibold text-wd-ink">{label}</span>,
    <span key="v" className="font-display text-wd-s font-semibold text-wd-ink">{dayHnt(d.hnt)} HNT</span>,
    <span key="s" className="text-wd-sm text-wd-ink-2">
      {d.hnt > 0
        ? `${d.usd != null ? `${fmtUsd(d.usd)} at that day's price · ` : ""}${fmtBytes(d.bytes)} rewarded`
        : "No rewarded data"}
    </span>,
  ];
}

/** The Mobile part: this Hotspot's HNT from data transfer per UTC day for 7
 * days (bars with a readout), its week total and share of the wallet's, and
 * users served on the usage day. */
function MobileWeek({ row, ctx, mobile, freshness, walletWeekHnt, onRetryMobile }) {
  const m = row.mobile;
  const week = row.week;
  const span = ctx.rewardsWindow ?? "7 days";
  const priceByDay = useMemo(
    () => Object.fromEntries((mobile?.rewards?.days ?? []).map((d) => [d.day, d.priceUsd ?? null])),
    [mobile?.rewards?.days],
  );
  const days = useMemo(
    () =>
      m.days7.map((d) => ({
        day: d.day,
        hnt: d.hnt ?? 0,
        value: d.hnt ?? 0,
        bytes: d.bytes,
        state: d.state,
        usd: d.state === "ok" && priceByDay[d.day] != null ? d.hnt * priceByDay[d.day] : null,
      })),
    [m.days7, priceByDay],
  );
  const weekText =
    week.state === "loading" ? null : week.state === "failed" || week.hnt == null ? null : `${fmtHnt(week.hnt, "stat")} HNT`;
  const first = days[0]?.day;
  const last = days[days.length - 1]?.day;
  const label =
    first && last
      ? `HNT earned per day from Mobile data transfer, ${fmtDataDay(first)} to ${fmtDataDay(last)} (UTC)${weekText ? `: ${weekText} total` : ""}`
      : "HNT earned per day from Mobile data transfer, 7 days";
  const srTable = {
    caption: `HNT earned per day from Mobile data transfer, ${span}`,
    columns: ["Day", "HNT", "Rewarded data", "USD at that day's price"],
    rows: days.map((d) => {
      const day = d.day ? `${fmtDataDay(d.day)} (UTC)` : "Day";
      if (d.state === "ok") return [day, dayHnt(d.hnt), d.hnt > 0 ? fmtBytes(d.bytes) : "None", fmtUsd(d.usd)];
      const word = d.state === "missing" ? "No data" : d.state === "failed" ? "Couldn't load" : "Loading";
      return [day, word, word, word];
    }),
  };
  const announce = (d) => {
    const date = d.day ? `${fmtDataDay(d.day, { year: true })} (UTC)` : "This day";
    if (d.state === "missing") return `${date}: no data.`;
    if (d.state === "failed") return `${date}: couldn't load.`;
    if (d.state !== "ok") return `${date}: loading.`;
    return d.hnt > 0
      ? `${date}: ${dayHnt(d.hnt)} HNT, ${d.usd != null ? `${fmtUsd(d.usd)}, ` : ""}${fmtBytes(d.bytes)} rewarded.`
      : `${date}: 0 HNT, no rewarded data.`;
  };
  const partial = week.state === "partial";
  const daysFailed = days.some((d) => d.state === "failed");
  const checking = days.every((d) => d.state === "loading");
  const share = weekText && walletWeekHnt > 0 ? `${fmtPct((week.hnt / walletWeekHnt) * 100)} of this wallet's data-transfer HNT` : null;

  const usageFailed = Boolean(mobile?.failed?.usage);
  const usageDay = mobile?.usage?.day;
  let users;
  if (m.usageReported == null) {
    users = usageFailed ? <Sm>Couldn&apos;t load usage.</Sm> : <span className="text-wd-sm text-wd-ink-3"><Pending /></span>;
  } else if (m.users == null) users = <Sm>Not reported</Sm>;
  else users = <span className="font-display text-wd-s font-semibold text-wd-ink">{fmtCount(m.users)}</span>;

  return (
    <DSub title="HNT from Mobile data transfer" right={freshness?.asOf ? `${span} · ${freshness.asOf}` : span}>
      <DayBars
        key={row.key}
        days={days}
        size="m"
        label={label}
        formatLabel={dayHnt}
        readout={(d) => dayReadout(d, checking)}
        srTable={srTable}
        announce={announce}
      />
      <div className="flex flex-col gap-0.5 text-wd-sm text-wd-ink-2">
        <span>
          {weekText ? (
            <>
              <b className="font-semibold text-wd-ink">{weekText}</b>{" "}
              {partial ? `in ${week.daysLoaded} of the ${span}` : `in the ${span}`}
            </>
          ) : week.state === "loading" ? (
            <>
              <Pending /> in the {span}
            </>
          ) : (
            `Couldn't load the ${span}.`
          )}
        </span>
        {share && <span>{share}</span>}
      </div>
      {daysFailed && onRetryMobile && (
        <div>
          <RetryBtn onClick={onRetryMobile} label="Retry daily HNT" />
        </div>
      )}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 border-t border-wd-line-2 pt-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-wd-sm text-wd-ink-2">Users served{usageDay ? `, ${fmtDataDay(usageDay)} (UTC)` : ""}</span>
          <InfoTip label="users served" className={TIP}>
            {USERS_NOTE}
          </InfoTip>
        </div>
        {users}
      </div>
      {m.usageReported == null && usageFailed && onRetryMobile && (
        <div>
          <RetryBtn onClick={onRetryMobile} label="Retry usage" />
        </div>
      )}
    </DSub>
  );
}

/**
 * The detail's Earnings: Unclaimed (with USD at today's price and whether it
 * can be claimed) and Lifetime earned (with Claimed), then for Mobile
 * Hotspots the 7 days of HNT from data transfer, for IoT the note that daily
 * HNT isn't available, the legacy tokens, and the wallet-level claim link.
 */
export default memo(function DetailEarnings({
  row,
  ctx,
  mobile,
  freshness,
  prices,
  wallet,
  walletWeekHnt,
  veHntPending,
  single,
  onRetry,
}) {
  const u = row.unclaimed;
  const l = row.lifetime;
  const destination = u.destination && u.destination !== wallet ? u.destination : null;
  return (
    <DSection id="earnings" title="Earnings" right="HNT">
      <div className="grid grid-cols-2 gap-4">
        <Figure
          label="Unclaimed"
          tip={
            <InfoTip label="Unclaimed" className={TIP}>
              {UNCLAIMED_NOTE}
            </InfoTip>
          }
        >
          <Unclaimed u={u} price={prices?.hnt ?? null} onRetry={onRetry?.rewards} />
        </Figure>
        <Figure
          label="Lifetime earned"
          tip={
            l.lowerBound ? (
              <InfoTip label="Lifetime earned" className={TIP}>
                {LOWER_BOUND_NOTE}
              </InfoTip>
            ) : null
          }
        >
          <Lifetime l={l} />
        </Figure>
      </div>
      {destination && (
        <Foot>
          Rewards go to <span className="font-mono" aria-hidden="true">{shortAddress(destination, 4, 4)}</span>
          <span className="sr-only">{destination}</span>.
        </Foot>
      )}
      {single && veHntPending > 0 && (
        <Foot>
          This Hotspot only. Unclaimed at the top of the page also includes {fmtHnt(veHntPending, "stat")} HNT from veHNT.
        </Foot>
      )}

      {row.mobile && (
        <MobileWeek
          row={row}
          ctx={ctx}
          mobile={mobile}
          freshness={freshness}
          walletWeekHnt={walletWeekHnt}
          onRetryMobile={onRetry?.mobile}
        />
      )}
      {row.noDaily && <Well>{NO_DAILY[row.noDaily] ?? NO_DAILY.none}</Well>}

      {l.state === "ok" && (
        <Disclosure key={row.key} summary="Legacy tokens" summaryClassName={SUMMARY}>
          <p className="m-0 ml-[18px] mt-1 text-wd-sm text-wd-ink">{legacyText(l, u)}</p>
        </Disclosure>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href={`/hotspot-claimer?mode=wallet&wallet=${encodeURIComponent(wallet)}`}
          className={`inline-flex ${LINK_H} items-center whitespace-nowrap text-[13px] font-medium text-accent-text hover:underline`}
        >
          {CLAIM_LABEL.hotspots}
        </a>
        <span className="text-wd-cap text-wd-ink-3">Claims for every Hotspot in this wallet.</span>
      </div>
    </DSection>
  );
});
