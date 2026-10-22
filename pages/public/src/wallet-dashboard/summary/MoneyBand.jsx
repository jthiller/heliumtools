import { memo, useRef } from "react";
import { Btn, Btn2, Disclosure, InfoTip, Progress, Skeleton, StatusMark } from "../ui/index.js";
import { IOT_CONNECTIVITY_NOTE, fmtCount, fmtDataDay, fmtHnt, fmtUsd, plural } from "../format.js";
import { CountUp } from "../arrivalMotion.jsx";
import { CLAIM_LABEL, NOTHING_TO_CLAIM, NOT_TRACKED, lowerBoundClause, noDailyNote, rewardsFromScope } from "../copy.js";

const tok = (v) => fmtHnt(v, "stat");
const tok2 = (v) => fmtHnt(v, "list");
const EARNED_TIP = `HNT per UTC day from Mobile data transfer, at that day's price. ${noDailyNote("IoT Hotspots")}`;
const IOT_TIP = `${IOT_CONNECTIVITY_NOTE} Messages are delivered LoRaWAN messages, not a reward amount.`;
const IOT_NO_DAILY = noDailyNote("IoT Hotspots");
const SWATCH = { hnt: "bg-wd-hnt", sol: "bg-wd-sol", dc: "bg-wd-dc", mobile: "bg-wd-ink-4", iot: "bg-wd-ink-4" };
const CLAIM_BTN = "max-md:w-full max-md:whitespace-normal max-md:py-2 max-md:text-center max-md:leading-[18px]";

const claimHref = (wallet) => `/hotspot-claimer?mode=wallet&wallet=${encodeURIComponent(wallet)}`;
const veHref = (wallet) => `/ve-hnt?wallet=${encodeURIComponent(wallet)}`;

// ── Pieces of a column ──────────────────────────────────────────────────────

// One term of the band's `dl`: the eyebrow (with its day and InfoTip) is the
// `dt`, everything under it one `dd`.
function Col({ wdCol, eyebrow, day, tip, tipLabel, busy, children }) {
  return (
    <div
      data-wd-col={wdCol}
      aria-busy={busy ? true : undefined}
      className="flex min-w-0 flex-col gap-1.5 bg-surface-raised p-4 md:gap-2 md:px-6 md:pb-6 md:pt-[22px]"
    >
      <dt className="flex min-h-6 items-center gap-1.5">
        <span className="font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-3">
          {eyebrow}
          {day && <span className="max-md:hidden"> · {day}</span>}
        </span>
        {tip && <InfoTip label={tipLabel}>{tip}</InfoTip>}
      </dt>
      <dd className="m-0 flex min-w-0 flex-1 flex-col gap-1.5 md:gap-2">
        {day && <span className="-mt-1 text-wd-cap text-wd-ink-3 md:hidden">{day}</span>}
        {children}
      </dd>
    </div>
  );
}

/** A figure: the lead (Wallet value, 52 px) or a money column's (32 px, 22 on phones). */
function Value({ lead, unit, sofar, asOf, children }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span
        className={`whitespace-nowrap font-display text-wd-ink ${
          lead ? "text-wd-xl-sm font-bold md:text-wd-xl" : "text-[22px] font-semibold leading-7 tracking-[-0.02em] md:text-wd-l"
        }`}
      >
        {children}
        {unit && <span className="ml-[0.22em] text-[0.5em] font-semibold tracking-normal text-wd-ink-3">{unit}</span>}
      </span>
      {sofar && (
        <span className="whitespace-nowrap rounded border border-dashed border-wd-control px-1.5 font-mono text-[11px] font-medium leading-[18px] tracking-[0.04em] text-wd-ink-2">
          so far
        </span>
      )}
      {asOf && <span className="whitespace-nowrap text-wd-cap text-wd-ink-2">{asOf}</span>}
    </div>
  );
}

/** A figure that couldn't be shown, in words ("Couldn't load", "No data"). */
const Err = ({ children }) => (
  <span className="font-display text-lg font-semibold leading-6 text-wd-ink-2 md:text-[22px] md:leading-[30px]">{children}</span>
);

/** The spoken "…" while a scan hasn't answered for this figure yet. */
const Wait = () => (
  <span className="font-display text-[22px] font-semibold leading-7 text-wd-ink-3 md:text-wd-l">
    <span aria-hidden="true">…</span>
    <span className="sr-only">Checking</span>
  </span>
);

const Sub = ({ children }) => <span className="text-[13px] leading-[18px] text-wd-ink-2">{children}</span>;
const Line = ({ children }) => <span className="text-[13px] leading-[18px] text-wd-ink">{children}</span>;
const Prog = ({ children }) => <span className="text-wd-cap text-wd-ink-2">{children}</span>;

function Caps({ items }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((c, i) =>
        typeof c === "string" ? (
          <span key={i} className="text-wd-cap text-wd-ink-3">
            {c}
          </span>
        ) : (
          <span key={i} className={c.strong ? "text-[13px] leading-[18px] text-wd-ink" : "text-wd-cap text-wd-ink-3"}>
            {c.t}
          </span>
        ),
      )}
    </div>
  );
}

function Loading({ lead, bars }) {
  return (
    <>
      <span className="sr-only">Loading</span>
      {lead ? (
        <Skeleton className="h-9 w-[130px] rounded-lg md:h-14 md:w-[210px]" />
      ) : (
        <Skeleton className="h-7 w-[100px] rounded-lg md:h-[38px] md:w-[150px]" />
      )}
      <Skeleton h={12} className="w-[78%]" />
      {bars && <Skeleton h={44} className="w-full rounded-md md:w-[200px]" />}
      <Skeleton h={12} className="w-[46%]" />
    </>
  );
}

const Actions = ({ children }) => <div className="mt-auto flex flex-wrap gap-2 pt-2">{children}</div>;

function Legacy({ text }) {
  return (
    <Disclosure summary="Legacy tokens" className="mt-auto pt-1.5 !text-wd-cap">
      <span className="block pl-[13px] pt-0.5 tabular-nums">{text}</span>
    </Disclosure>
  );
}

const legacyText = (legacy, suffix = "") =>
  [legacy?.iot > 0 ? `${tok2(legacy.iot)} IOT` : null, legacy?.mobile > 0 ? `${tok2(legacy.mobile)} MOBILE` : null]
    .filter(Boolean)
    .join(" · ") + suffix;

// The latest arrival seq that brought new rows to `table` (0: none since the
// baseline); a count-up's trigger. Live arrivals only: the first load and a
// saved paint don't increment `arrivals.seq`. Resets per wallet.
function useTableArrival(arrivals, table, wallet) {
  const ref = useRef(null);
  const seq = arrivals?.seq ?? 0;
  if (ref.current === null || ref.current.wallet !== wallet) ref.current = { wallet, seen: seq, key: 0 };
  if (seq > ref.current.seen && arrivals.byTable?.[table]) ref.current.key = seq;
  ref.current.seen = seq;
  return ref.current.key;
}

// ── Columns ─────────────────────────────────────────────────────────────────

function WalletValueCol({ money }) {
  const v = money.walletValue;
  let body;
  if (v.state === "loading") body = <Loading lead />;
  else if (v.state === "failed") {
    body = (
      <>
        <Err>Couldn&apos;t load</Err>
        <Caps items={["Token balances and today's prices didn't load. Retry above."]} />
      </>
    );
  } else {
    const priced = v.split.filter((t) => t.usd > 0);
    const totalUsd = priced.reduce((s, t) => s + t.usd, 0);
    const unpriced = v.split.filter((t) => t.usd == null).map((t) => t.label);
    body = (
      <>
        <Value lead>{fmtUsd(v.usd ?? 0)}</Value>
        {priced.length > 0 && (
          <div aria-hidden="true" className="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {priced.map((t) => (
              <i
                key={t.token}
                className={`block h-full ${SWATCH[t.token]}`}
                style={{ flex: `${(t.usd / totalUsd) * 100} 1 0px`, minWidth: 3 }}
              />
            ))}
          </div>
        )}
        {v.split.length > 0 && (
          <div className="flex flex-col gap-1">
            {v.split.map((t) => (
              <div
                key={t.token}
                className="grid grid-cols-[10px_minmax(0,1fr)] items-center gap-x-2 text-[13px] leading-[18px] md:flex md:flex-wrap md:gap-y-0.5"
              >
                <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${SWATCH[t.token]}`} />
                <span className="font-semibold tabular-nums text-wd-ink">
                  {t.token === "dc" ? fmtCount(Math.round(t.amount)) : tok(t.amount)} {t.label}
                  {t.legacy && (
                    <span className="ml-1.5 inline-block rounded border border-wd-control px-[5px] align-[1px] font-mono text-[10px] font-medium leading-4 tracking-[0.06em] text-wd-ink-2">
                      Legacy
                    </span>
                  )}
                </span>
                <span className="col-start-2 tabular-nums text-wd-ink-2">{t.usd == null ? "No price" : fmtUsd(t.usd)}</span>
              </div>
            ))}
          </div>
        )}
        <Caps
          items={[
            v.caption,
            unpriced.length
              ? `No price right now for ${unpriced.join(" and ")}, so ${unpriced.length === 1 ? "it isn't" : "they aren't"} in the total.`
              : null,
            ...v.veCaptions.map((t) => ({ t, strong: true })),
          ]}
        />
      </>
    );
  }
  return (
    <Col wdCol="value" eyebrow="Wallet value" busy={v.state === "loading"}>
      {body}
    </Col>
  );
}

function UnclaimedCol({ wallet, money, list, summary, fleetState, hasFleet, onRetryRewards }) {
  const u = money.unclaimed;
  const fleetFailed = fleetState.state === "failed";
  const hs = u.hotspotsState;
  const total = u.total || list.counts.total;
  const veHnt = u.veHnt;
  const failedRows = list.rows.reduce((n, r) => n + (r.unclaimed.state === "failed" ? 1 : 0), 0);
  const legacyOn = u.legacy.iot > 0 || u.legacy.mobile > 0;
  const legacyTokens = [u.legacy.iot > 0 ? "IOT" : null, u.legacy.mobile > 0 ? "MOBILE" : null].filter(Boolean);
  // No price list, no USD: a $0.00 for 0 HNT would still claim a price.
  const usdToday = money.prices ? u.usdToday : null;

  const veCaption =
    u.veState === "loading"
      ? "Checking veHNT rewards…"
      : u.veState === "failed"
        ? "veHNT rewards couldn't be checked. Retry below."
        : veHnt > 0
          ? hasFleet
            ? "veHNT rewards are claimed in veHNT, not the Hotspot claimer."
            : "From veHNT only. Claim them in veHNT."
          : hasFleet
            ? "No veHNT rewards."
            : "From veHNT only. None pending now.";
  const veLine = veHnt > 0 ? <Line>From veHNT: {tok(veHnt)} HNT</Line> : null;
  // `primary`: something is claimable from the Hotspots (the filled button).
  // One label per destination on every surface (copy.CLAIM_LABEL).
  const hotspotsBtn = primary => (primary ? (
    <Btn href={claimHref(wallet)} className={CLAIM_BTN}>
      {CLAIM_LABEL.hotspots}
    </Btn>
  ) : (
    <Btn2 href={claimHref(wallet)} className={CLAIM_BTN}>
      {CLAIM_LABEL.hotspots}
    </Btn2>
  ));
  const claimButtons = (primary) =>
    veHnt > 0 ? (
      <>
        {hotspotsBtn(primary)}
        <Btn2 href={veHref(wallet)} className={CLAIM_BTN}>
          {CLAIM_LABEL.veHnt}
        </Btn2>
      </>
    ) : (
      hotspotsBtn(primary)
    );

  let body;
  let busy = false;
  if (fleetFailed) {
    body = (
      <>
        <Err>Couldn&apos;t load</Err>
        <Sub>Hotspot rewards couldn&apos;t be checked.</Sub>
        {veLine}
        <Actions>{claimButtons(false)}</Actions>
        <Caps items={u.veState === "failed" ? [veCaption] : ["Retry below.", veCaption]} />
      </>
    );
  } else if (fleetState.state === "loading" || (hs === "loading" && total === 0) || (hs === "none" && u.veState === "loading")) {
    busy = true;
    body = <Loading />;
  } else if (hs === "loading") {
    busy = true;
    body = (
      <>
        <Wait />
        <Prog>Checking 0 of {plural(total, "Hotspot")}…</Prog>
      </>
    );
  } else if (hs === "scanning") {
    busy = true;
    const scanText = `Checking ${fmtCount(u.checked)} of ${plural(total, "Hotspot")}…`;
    body = (
      <>
        <Value unit="HNT" sofar>
          {tok(u.hnt ?? 0)}
        </Value>
        {legacyOn && <Line>+ {legacyText(u.legacy)} (legacy) so far</Line>}
        {usdToday != null ? (
          <Sub>{`${fmtUsd(usdToday)} so far at today's ${legacyOn ? `prices, HNT and ${legacyTokens.join(" and ")}` : "price"}`}</Sub>
        ) : summary.error || summary.data ? (
          <Sub>USD at today&apos;s price unavailable</Sub>
        ) : (
          <Skeleton h={12} className="w-[60%]" />
        )}
        {veLine}
        <Progress label="Checking Hotspot rewards" now={u.checked} max={total} valueText={scanText} size={4} className="mt-0.5" />
        <Prog>{scanText}</Prog>
        <Actions>{claimButtons(true)}</Actions>
        <Caps items={[`Held by ${fmtCount(u.withPending)} of the ${fmtCount(u.checked)} Hotspots checked so far.`, veCaption]} />
      </>
    );
  } else if (!hasFleet && u.veState === "failed") {
    // No Hotspots: veHNT is the whole figure, and it didn't answer.
    body = (
      <>
        <Err>Couldn&apos;t load</Err>
        <Caps items={["veHNT rewards couldn't be checked. Retry below."]} />
      </>
    );
  } else if (hs === "failed" || u.hnt == null) {
    body = (
      <>
        <Err>Couldn&apos;t load</Err>
        <Sub>{hs === "failed" ? "Hotspot rewards couldn't be checked." : "veHNT rewards couldn't be checked."}</Sub>
        {hs === "failed" && veLine}
        <Actions>
          <Btn2 onClick={onRetryRewards} aria-label="Retry Hotspot rewards">
            Retry
          </Btn2>
        </Actions>
        <Caps items={[hs === "failed" ? veCaption : null]} />
      </>
    );
  } else {
    // Ready (or no Hotspot rewards to check: veHNT only).
    const hsHnt = u.hotspotsHnt ?? 0;
    const cant = u.cantClaimHnt ?? 0;
    const claimable = u.claimableHnt ?? 0;
    const anything = hsHnt > 0 || legacyOn;
    const usdLine =
      usdToday != null
        ? `${fmtUsd(usdToday)} at today's ${legacyOn ? `prices, HNT and ${legacyTokens.join(" and ")}` : "price"}`
        : summary.error || summary.data
          ? "USD at today's price unavailable"
          : null;
    const hotspotsWord = total === 1 ? "the Hotspot" : "the Hotspots";
    const lines =
      hasFleet && veHnt > 0
        ? [
            cant > 0
              ? `From ${hotspotsWord}: ${tok(hsHnt)} HNT. Claimable now: ${tok(claimable)} HNT`
              : `From ${hotspotsWord}: ${tok(hsHnt)} HNT${hsHnt > 0 ? ", claimable now" : ""}`,
            `From veHNT: ${tok(veHnt)} HNT`,
          ]
        : [];
    const held = !hasFleet
      ? null
      : veHnt > 0
        ? null
        : hsHnt > 0
          ? `Held by ${fmtCount(u.withPending)} of ${failedRows > 0 ? `the ${plural(total - failedRows, "Hotspot")} checked` : plural(total, "Hotspot")}${cant > 0 ? `. Claimable now: ${tok(claimable)} HNT.` : ", all claimable now."}`
          : legacyOn
            ? "Legacy tokens only, claimable now."
            : NOTHING_TO_CLAIM;
    body = (
      <>
        <Value unit="HNT">{tok(u.hnt)}</Value>
        {legacyOn && <Line>+ {legacyText(u.legacy)} (legacy)</Line>}
        {usdLine ? <Sub>{usdLine}</Sub> : <Skeleton h={12} className="w-[60%]" />}
        {lines.map((t) => (
          <Line key={t}>{t}</Line>
        ))}
        {cant > 0 && (
          <p className="m-0 flex items-start gap-2 rounded-lg bg-wd-critical-surface px-2.5 py-2 text-wd-cap text-wd-ink">
            <StatusMark tier="serious" className="mt-0.5" />
            <span>
              <span className="font-semibold text-wd-critical-text">{tok(cant)} HNT can&apos;t be claimed yet.</span> Typically this wallet
              needs an HNT token account first.{" "}
              <a
                href="#wallet"
                className="font-medium text-accent-text hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center"
              >
                See Balances
              </a>
            </span>
          </p>
        )}
        <Actions>
          {hasFleet ? (
            claimButtons(anything)
          ) : veHnt > 0 ? (
            <Btn href={veHref(wallet)} className={CLAIM_BTN}>
              {CLAIM_LABEL.veHnt}
            </Btn>
          ) : (
            <Btn2 href={veHref(wallet)} className={CLAIM_BTN}>
              Open veHNT
            </Btn2>
          )}
          {failedRows > 0 && <Btn2 onClick={onRetryRewards} aria-label="Retry Hotspot rewards">
            Retry
          </Btn2>}
        </Actions>
        <Caps
          items={[
            held,
            failedRows > 0 ? `${plural(failedRows, "Hotspot")} couldn't be checked.` : null,
            u.noOracle > 0 ? `${plural(u.noOracle, "Hotspot")} couldn't be confirmed right now.` : null,
            veCaption,
          ]}
        />
      </>
    );
  }
  return (
    <Col wdCol="unclaimed" eyebrow="Unclaimed" busy={busy}>
      {body}
    </Col>
  );
}

/** Earned's static 7-day mini chart: aria-hidden bars, the days as an sr-only list. */
function MiniBars({ days }) {
  const ok = days.filter((d) => d.state === "ok");
  const max = Math.max(0, ...ok.map((d) => d.hnt));
  const last = days.length - 1;
  let maxI = -1;
  days.forEach((d, i) => {
    if (d.state === "ok" && d.hnt > 0 && (maxI < 0 || d.hnt > days[maxI].hnt)) maxI = i;
  });
  const dayLabel = (d) => fmtDataDay(d.day);
  const srText = (d, i) => {
    const day = `${dayLabel(d)} (UTC): `;
    if (d.state === "ok") return `${day}${tok(d.hnt)} HNT${i === maxI && i !== last ? ", the most in these 7 days" : ""}`;
    return day + (d.state === "missing" ? "no data" : d.state === "failed" ? "couldn't load" : "loading");
  };
  return (
    <div className="mt-1 flex flex-col gap-1 md:max-w-[260px]">
      <div aria-hidden="true" className="flex h-[60px] items-end gap-[3px]">
        {days.map((d, i) => {
          let bar;
          let height;
          if (d.state === "ok" && d.hnt > 0) {
            bar = "rounded-t-[3px] bg-wd-mobile";
            height = Math.max(2, Math.round((d.hnt / max) * 44));
          } else if (d.state === "ok") {
            bar = "bg-wd-control";
            height = 2;
          } else {
            height = 15;
            bar =
              d.state === "missing"
                ? "wd-hatch rounded-t-sm"
                : d.state === "failed"
                  ? "rounded-t-sm border-[1.5px] border-b-0 border-wd-control bg-wd-well"
                  : "rounded-t-sm bg-wd-line motion-safe:animate-pulse";
          }
          const labelled = d.state === "ok" && (i === last || i === maxI);
          return (
            <span key={d.day ?? i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-0.5">
              {labelled && (
                <span className="whitespace-nowrap font-display text-[11px] font-semibold leading-[14px] tabular-nums text-wd-ink">
                  {tok(d.hnt)}
                </span>
              )}
              <i
                className={`block w-full ${bar} ${i === last ? "ring-[1.5px] ring-wd-ink ring-offset-2 ring-offset-surface-raised" : ""}`}
                style={{ height }}
              />
            </span>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex justify-between text-[11px] leading-[14px] text-wd-ink-3">
        <span>{dayLabel(days[0])}</span>
        <span>{dayLabel(days[last])}</span>
      </div>
      <ul className="sr-only">
        {days.map((d, i) => (
          <li key={d.day ?? i}>{srText(d, i)}</li>
        ))}
      </ul>
    </div>
  );
}

function EarnedCol({ wallet, money, fleetState, freshness, activity, onRetryMobile }) {
  const e = money.earned;
  const latest = e.latest;
  const day = latest.day ? `${fmtDataDay(latest.day)} (UTC)` : null;
  const trigger = useTableArrival(activity?.arrivals, "rewards", wallet);
  const fleetFailed = fleetState.state === "failed";
  const failed = latest.state === "failed" || (freshness.state === "error" && latest.state !== "ok" && latest.state !== "missing");
  let body;
  let busy = false;
  if (fleetFailed) {
    body = (
      <>
        <Err>Couldn&apos;t load</Err>
        <Caps items={["Retry below."]} />
      </>
    );
  } else if (failed) {
    body = (
      <>
        <Err>Couldn&apos;t load</Err>
        <Sub>Couldn&apos;t load earnings.</Sub>
        <Actions>
          <Btn2 onClick={onRetryMobile} aria-label="Retry earnings">
            Retry
          </Btn2>
        </Actions>
      </>
    );
  } else if (fleetState.state === "loading" || !e.days.length || (latest.state !== "ok" && latest.state !== "missing")) {
    busy = true;
    body = <Loading bars />;
  } else {
    const lastDay = fmtDataDay(e.days[e.days.length - 1].day);
    const loadingDays = e.days.some((d) => d.state === "loading");
    const week = loadingDays
      ? "Loading earlier days…"
      : e.daysLoaded === e.days.length
        ? `${tok(e.weekHnt)} HNT in the ${e.days.length} days to ${lastDay} (UTC)`
        : `${tok(e.weekHnt ?? 0)} HNT over ${e.daysLoaded} of ${e.days.length} days with data, to ${lastDay} (UTC)`;
    const scope =
      latest.state === "ok"
        ? `Mobile data transfer. ${fmtCount(latest.rewarded ?? 0)} of ${plural(latest.of, "Mobile Hotspot")} rewarded on ${day}.`
        : "Mobile data transfer.";
    body = (
      <>
        {latest.state === "ok" ? (
          <Value unit="HNT" asOf={freshness.asOf}>
            <span className="tabular-nums">
              <CountUp key={wallet} value={latest.hnt} trigger={trigger} format={tok} />
            </span>
          </Value>
        ) : (
          <Err>No data</Err>
        )}
        {latest.state === "ok" ? (
          latest.usd != null && <Sub>{fmtUsd(latest.usd)} at that day&apos;s price</Sub>
        ) : (
          <Sub>No earnings data published for {day}.</Sub>
        )}
        <MiniBars days={e.days} />
        <Caps items={[{ t: week, strong: true }, scope, freshness.earningsNote]} />
        {freshness.earningsNote && (
          <Actions>
            <Btn2 onClick={onRetryMobile} aria-label="Retry earnings">
              Retry
            </Btn2>
          </Actions>
        )}
      </>
    );
  }
  return (
    <Col wdCol="earned" eyebrow="Earned" day={fleetFailed || busy ? null : day} tip={EARNED_TIP} tipLabel="Earned" busy={busy}>
      {body}
    </Col>
  );
}

/** Earned for a fleet on neither IoT nor Mobile: no daily HNT exists for it. */
function NoDailyCol() {
  return (
    <Col wdCol="earned" eyebrow="Earned" tip={EARNED_TIP} tipLabel="Earned">
      <Err>{NOT_TRACKED}</Err>
      <Caps items={[noDailyNote("These Hotspots")]} />
    </Col>
  );
}

function IotActivityCol({ money, fleetState, iotStatus, iotDone, list, onRetryIot }) {
  const iot = money.earned.iot;
  const fleetFailed = fleetState.state === "failed";
  const total = iotStatus.iotTotal;
  const day = iot.day ? `${fmtDataDay(iot.day)} (UTC)` : null;
  const allFailed = iotDone && total > 0 && iotStatus.failed >= total;
  let body;
  let busy = false;
  if (fleetFailed) {
    body = (
      <>
        <Err>Couldn&apos;t load</Err>
        <Caps items={["Retry below."]} />
      </>
    );
  } else if (fleetState.state === "loading" || total === 0) {
    busy = true;
    body = <Loading />;
  } else if (!iotDone) {
    busy = true;
    body = (
      <>
        <Wait />
        <Prog>
          Checking {fmtCount(iotStatus.counted)} of {plural(total, "IoT Hotspot")}…
        </Prog>
      </>
    );
  } else if (allFailed) {
    body = (
      <>
        <Err>Couldn&apos;t check</Err>
        <Actions>
          <Btn2 onClick={onRetryIot} aria-label="Retry IoT status">
            Retry
          </Btn2>
        </Actions>
        <Caps items={["IoT status and messages couldn't be checked right now."]} />
      </>
    );
  } else {
    const t = iotStatus.traffic;
    const through = iotStatus.trafficRange?.max;
    const msgs =
      t?.known > 0 && through
        ? `${plural(t.messages30d, "message")} delivered in the 30 days to ${fmtDataDay(through)} (UTC).`
        : t?.unpublished > 0
          ? "Messages aren't published right now."
          : "Messages unavailable right now.";
    let value;
    let unit = null;
    let sub;
    if (total === 1) {
      const row = list.rows.find((r) => r.nets.iot);
      const status = row?.iot?.status;
      value = status === "active" ? "Active" : status === "inactive" ? "Inactive" : status === "settingUp" ? "Setting up" : "Unknown";
      sub =
        status === "active"
          ? "Connected on the latest reported day"
          : status === "inactive"
            ? "Not connected on the latest reported day"
            : status === "settingUp"
              ? "Onboarded after the latest reported day"
              : "No status for this Hotspot";
    } else {
      value = fmtCount(iot.active);
      unit = `of ${fmtCount(iot.reported)}`;
      sub = "IoT Hotspots active";
    }
    const notReported = total > 1 ? total - iot.reported - iotStatus.failed : 0;
    body = (
      <>
        <Value unit={unit}>{value}</Value>
        <Sub>{sub}</Sub>
        <Line>{msgs}</Line>
        {iotStatus.failed > 0 && (
          <Actions>
            <Btn2 onClick={onRetryIot} aria-label="Retry IoT status">
            Retry
          </Btn2>
          </Actions>
        )}
        <Caps
          items={[
            iotStatus.failed > 0 ? `Couldn't check ${plural(iotStatus.failed, "IoT Hotspot")}.` : null,
            notReported > 0 ? `${fmtCount(notReported)} not reported on that day.` : null,
            IOT_NO_DAILY,
          ]}
        />
      </>
    );
  }
  return (
    <Col
      wdCol="earned"
      eyebrow="IoT activity"
      day={fleetFailed || busy || allFailed ? null : day}
      tip={IOT_TIP}
      tipLabel="IoT activity"
      busy={busy}
    >
      {body}
    </Col>
  );
}

function LifetimeCol({ money, list, fleetState }) {
  const l = money.lifetime;
  const u = money.unclaimed;
  const hs = u.hotspotsState;
  const fleetFailed = fleetState.state === "failed";
  const total = u.total || list.counts.total;
  const failedRows = list.rows.reduce((n, r) => n + (r.lifetime.state === "failed" ? 1 : 0), 0);
  const legacy = l.legacy.iot > 0 || l.legacy.mobile > 0;
  let body;
  let busy = false;
  if (fleetFailed) {
    body = (
      <>
        <Err>Couldn&apos;t load</Err>
        <Caps items={["Retry below."]} />
      </>
    );
  } else if (fleetState.state === "loading" || (hs === "loading" && total === 0)) {
    busy = true;
    body = <Loading />;
  } else if (hs === "loading") {
    busy = true;
    body = (
      <>
        <Wait />
        <Prog>Checking 0 of {plural(total, "Hotspot")}…</Prog>
      </>
    );
  } else if (hs === "scanning") {
    busy = true;
    body = (
      <>
        <Value unit="HNT" sofar>
          {tok(l.hnt ?? 0)}
        </Value>
        <Sub>
          {fmtCount(u.checked)} of {plural(total, "Hotspot")} checked
        </Sub>
        {legacy && <Legacy text={legacyText(l.legacy, " so far")} />}
      </>
    );
  } else if (hs === "failed" || l.hnt == null) {
    body = (
      <>
        <Err>Couldn&apos;t load</Err>
        <Caps items={["Hotspot rewards couldn't be checked."]} />
      </>
    );
  } else {
    const unconfirmed = list.totals.unconfirmed;
    // The scope first (the Hotspots it covers), then the lower bound: the
    // same sentences as Earnings' Lifetime earned card.
    const sub =
      failedRows > 0
        ? [rewardsFromScope(total, failedRows), l.lowerBound ? lowerBoundClause(unconfirmed) : null].filter(Boolean).join(" ")
        : l.lowerBound
          ? `Across all ${plural(total, "Hotspot")}. ${lowerBoundClause(unconfirmed)}`
          : total === 1
            ? "From 1 Hotspot"
            : `Across all ${plural(total, "Hotspot")}`;
    body = (
      <>
        <Value unit="HNT">
          {l.lowerBound && (
            <>
              <span aria-hidden="true">≥ </span>
              <span className="sr-only">At least </span>
            </>
          )}
          {tok(l.hnt)}
        </Value>
        <Sub>{sub}</Sub>
        {legacy && <Legacy text={legacyText(l.legacy)} />}
      </>
    );
  }
  return (
    <Col wdCol="lifetime" eyebrow="Lifetime earned" busy={busy}>
      {body}
    </Col>
  );
}

/**
 * The money band (WdSummary): Wallet value (token balances at current prices,
 * HNT first, with its split bar), Unclaimed (Hotspots + veHNT, at today's
 * price, with the claim actions), Earned on the latest UTC day from Mobile
 * data transfer (at that day's price, with a static 7-day mini chart) or IoT
 * activity for an IoT-only wallet, and Lifetime earned. A wallet with no
 * Hotspots shows the first two. Every figure has a loading, partial ("so
 * far"), failed and unavailable look; none is ever a false 0. Four columns
 * from 1280 px, 2 × 2 below, one column under 372 px.
 */
export default memo(function MoneyBand({
  wallet,
  summary,
  money,
  list,
  fleetState,
  freshness,
  activity,
  iotStatus,
  iotDone,
  onRetryRewards,
  onRetryIot,
  onRetryMobile,
}) {
  // While the fleet loads, /summary says whether it has Hotspots and which
  // networks, so the columns are reserved at their final count.
  const fleetLoaded = fleetState.state === "ready";
  const summaryCount = summary.data?.fleet?.count;
  const hasFleet = fleetLoaded ? list.counts.total > 0 : summaryCount !== 0;
  // Networks not known yet: Earned is reserved (the usual column). A loaded
  // fleet on neither network has no daily HNT to show, never an endless wait.
  const kind = money.earned.kind === "none" && hasFleet ? (fleetLoaded ? "nodaily" : "mobile") : money.earned.kind;
  const cols = hasFleet ? 4 : 2;
  return (
    <dl
      className={`m-0 grid gap-px overflow-hidden rounded-t-2xl bg-wd-line-2 max-[371px]:grid-cols-1 min-[372px]:grid-cols-2 ${
        cols === 4 ? "xl:grid-cols-[1.25fr_1fr_1.15fr_1fr]" : "xl:grid-cols-[1.3fr_1fr]"
      }`}
    >
      <WalletValueCol money={money} />
      <UnclaimedCol
        wallet={wallet}
        money={money}
        list={list}
        summary={summary}
        fleetState={fleetState}
        hasFleet={hasFleet}
        onRetryRewards={onRetryRewards}
      />
      {hasFleet &&
        (kind === "nodaily" ? (
          <NoDailyCol />
        ) : kind === "iot" ? (
          <IotActivityCol
            money={money}
            fleetState={fleetState}
            iotStatus={iotStatus}
            iotDone={iotDone}
            list={list}
            onRetryIot={onRetryIot}
          />
        ) : (
          <EarnedCol
            wallet={wallet}
            money={money}
            fleetState={fleetState}
            freshness={freshness}
            activity={activity}
            onRetryMobile={onRetryMobile}
          />
        ))}
      {hasFleet && <LifetimeCol money={money} list={list} fleetState={fleetState} />}
    </dl>
  );
});
