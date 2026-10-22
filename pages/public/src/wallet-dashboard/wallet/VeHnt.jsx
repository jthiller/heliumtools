import { memo } from "react";
import { Btn2, Card, NetChip, Skeleton, StatusMark } from "../ui/index.js";
import { fmtDate, fmtHnt, fmtToken, fmtUsd } from "../format.js";

const DAY_MS = 86_400_000;
// A delegation ending within this many days gets the caution.
const EXPIRY_WARN_DAYS = 30;
const SUBDAO = { MOBILE: { net: "mobile", label: "Mobile" }, IOT: { net: "iot", label: "IoT" } };
const PILL = "inline-flex h-5 items-center whitespace-nowrap rounded-full border border-wd-control px-2 text-[11px] font-semibold leading-[18px] text-wd-ink-2";
const LINK = "font-medium text-accent-text hover:underline max-md:-my-3 max-md:inline-block max-md:py-3";

const dateWithYear = (sec) => fmtDate(sec * 1000);

/** veHNT pending: "0", "<0.0001", 4 decimals below 0.1, else 2 (Summary's figures). */
const pendingText = (v) => fmtHnt(v || 0, "stat");

function Row({ term, children }) {
  return (
    <div className="grid grid-cols-1 items-baseline gap-y-0.5 border-t border-wd-line-2 py-2.5 md:grid-cols-[100px_minmax(0,1fr)] md:gap-x-4 xl:grid-cols-[112px_minmax(0,1fr)]">
      <dt className="text-wd-sm leading-5 text-wd-ink-2">{term}</dt>
      <dd className="m-0 flex min-w-0 flex-col gap-0.5">{children}</dd>
    </div>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-3">{label}</dt>
      <dd className="m-0 whitespace-nowrap font-display text-wd-s font-semibold tracking-[-0.02em] text-wd-ink md:text-wd-m">
        {value}
        {unit && <span className="ml-[0.22em] text-[0.5em] font-semibold tracking-normal text-wd-ink-3">{unit}</span>}
      </dd>
    </div>
  );
}

/**
 * Wallet: veHNT. Positions, HNT locked and voting power; which network each
 * delegated position backs; unclaimed delegation rewards (claimed in the
 * veHNT tool, prefilled with this wallet); when the next lockup ends; and the
 * soonest delegation expiry, with a caution inside 30 days (an expired
 * delegation stops earning). `governance` is the /ve-hnt/positions state.
 */
export default memo(function VeHnt({ wallet, governance, hntPrice }) {
  const href = `/ve-hnt?wallet=${encodeURIComponent(wallet)}`;
  const data = governance.data;
  const loading = !data && !governance.error;
  const totals = data?.totals;
  const positions = data?.positions || [];
  const has = Boolean(totals) && Number(totals.positionCount) > 0;

  let body = null;
  if (loading) {
    body = (
      <>
        <span className="sr-only">Loading veHNT positions</span>
        <div aria-hidden="true" className="mb-2.5 mt-1.5 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex flex-col gap-1.5">
              <Skeleton w="70%" h={10} />
              <Skeleton w="55%" h={24} />
            </span>
          ))}
        </div>
        <div aria-hidden="true" className="border-t border-wd-line-2 py-[13px]">
          <Skeleton w="60%" h={14} />
        </div>
      </>
    );
  } else if (!data && governance.error) {
    body = (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-wd-critical-surface px-3 py-2.5">
        <span className="inline-flex min-w-[180px] flex-1 items-center gap-2 text-wd-sm font-medium text-wd-critical-text">
          <StatusMark tier="serious" sr={false} />
          Couldn&apos;t load positions.
        </span>
        <Btn2 onClick={governance.retry} aria-label="Retry loading veHNT positions">
          Retry
        </Btn2>
      </div>
    );
  } else if (!has) {
    body = <p className="m-0 mt-0.5 text-sm text-wd-ink-2">No veHNT positions in this wallet.</p>;
  } else {
    const now = Date.now();
    const bySub = new Map();
    let undelegated = 0;
    for (const p of positions) {
      const sub = p.delegation?.subDao;
      if (!p.delegation) undelegated++;
      else bySub.set(sub ?? "OTHER", (bySub.get(sub ?? "OTHER") ?? 0) + 1);
    }
    const pend = Number(totals.pendingRewardsHnt) || 0;
    // A Constant lockup never ends while it stays Constant (its end_ts is only
    // the unwind period if it's later converted), so it has no "next end".
    const indefinite = positions.filter((p) => p.lockup?.kind === "Constant").length;
    const live = positions
      .filter((p) => p.lockup?.kind !== "Constant" && !p.lockup?.isExpired && p.lockup?.endTs * 1000 > now)
      .sort((a, b) => a.lockup.endTs - b.lockup.endTs);
    const lockedCount = live.length + indefinite;
    const ends = positions.filter((p) => p.lockup?.kind !== "Constant").map((p) => p.lockup?.endTs).filter(Boolean);
    const delegated = positions
      .filter((p) => p.delegation?.expirationTs)
      .sort((a, b) => a.delegation.expirationTs - b.delegation.expirationTs);
    let del = null;
    if (delegated.length) {
      const d = delegated[0].delegation;
      const net = SUBDAO[d.subDao]?.label ?? "Other network";
      const ms = d.expirationTs * 1000;
      const days = Math.round((ms - now) / DAY_MS);
      del =
        ms < now
          ? { text: `${net} delegation expired ${dateWithYear(d.expirationTs)}`, sub: "It no longer earns veHNT rewards.", warn: true }
          : {
              text: `${net} delegation expires ${dateWithYear(d.expirationTs)}`,
              sub:
                days <= EXPIRY_WARN_DAYS
                  ? `In ${days} ${days === 1 ? "day" : "days"}. Extend it in veHNT to keep earning.`
                  : delegated.length > 1
                    ? `Soonest of ${delegated.length}`
                    : null,
              warn: ms < now + EXPIRY_WARN_DAYS * DAY_MS,
            };
    }
    body = (
      <>
        <dl className="mb-2.5 mt-1.5 grid grid-cols-3 gap-3 max-md:grid-cols-[repeat(auto-fit,minmax(100px,1fr))]">
          <Stat label="Positions" value={positions.length || Number(totals.positionCount)} />
          <Stat label="HNT locked" value={fmtToken(Number(totals.hntLocked) || 0, { max: 2 })} unit="HNT" />
          <Stat label="Voting power" value={fmtToken(Number(totals.veHnt) || 0, { max: 0 })} unit="veHNT" />
        </dl>
        <dl className="m-0">
          <Row term="Delegated to">
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm">
              {[...bySub].map(([sub, n]) =>
                SUBDAO[sub] ? (
                  <NetChip key={sub} net={SUBDAO[sub].net}>{`${SUBDAO[sub].label} ${n}`}</NetChip>
                ) : (
                  <span key={sub} className={PILL}>{`Other network ${n}`}</span>
                ),
              )}
              {bySub.size === 0 && <span className={PILL}>None</span>}
              {undelegated > 0 && <span className={PILL}>{`Not delegated ${undelegated}`}</span>}
            </span>
          </Row>
          <Row term="Unclaimed">
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
              <span className="font-display font-semibold text-wd-ink">{`${pendingText(pend)} HNT`}</span>
              <span className="text-wd-cap text-wd-ink-3">
                {pend > 0
                  ? hntPrice != null
                    ? `${fmtUsd(pend * hntPrice)} at today's price`
                    : "USD at today's price unavailable"
                  : "Nothing to claim"}
              </span>
            </span>
            {pend > 0 && (
              <span className="text-wd-sm">
                <a href={href} className={LINK}>
                  Claim veHNT rewards
                </a>
              </span>
            )}
          </Row>
          <Row term="Lockups">
            {lockedCount ? (
              <>
                <span className="text-sm">
                  {live.length
                    ? `Next ends ${dateWithYear(live[0].lockup.endTs)}`
                    : indefinite === 1
                      ? "Indefinite lockup"
                      : `${indefinite} indefinite lockups`}
                </span>
                <span className="text-wd-cap text-wd-ink-3">
                  {`${lockedCount} of ${positions.length} still locked${live.length && indefinite ? `, ${indefinite} indefinite` : ""}`}
                </span>
              </>
            ) : (
              <>
                <span className="text-sm">{positions.length === 1 ? "Ended" : `All ${positions.length} have ended`}</span>
                {ends.length > 0 && (
                  <span className="text-wd-cap text-wd-ink-3">
                    {`Latest ended ${dateWithYear(Math.max(...ends))}.${Number(totals.veHnt) === 0 ? " Voting power is 0." : ""}`}
                  </span>
                )}
              </>
            )}
          </Row>
          <Row term="Delegation">
            {del ? (
              <>
                <span className={`flex flex-wrap items-center gap-x-1.5 text-sm ${del.warn ? "font-semibold text-wd-caution-text" : ""}`}>
                  {del.warn && <StatusMark tier="check" />}
                  {del.text}
                </span>
                {del.sub && <span className="text-wd-cap text-wd-ink-3">{del.sub}</span>}
              </>
            ) : (
              <span className="text-sm">{bySub.size > 0 ? "No expiry on record" : "No position is delegated"}</span>
            )}
          </Row>
        </dl>
      </>
    );
  }

  return (
    <Card as="article" aria-labelledby="wallet-ve-title" busy={loading} className="flex flex-col">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id="wallet-ve-title" className="m-0 font-display text-wd-title font-semibold text-wd-ink">
          veHNT
        </h3>
        <a href={href} aria-label="Open veHNT for this wallet" className={`text-wd-sm ${LINK}`}>
          Open veHNT
        </a>
      </div>
      {body}
    </Card>
  );
});
