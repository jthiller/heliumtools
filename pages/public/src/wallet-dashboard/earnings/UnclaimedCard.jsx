import { memo } from "react";
import { Btn, Btn2, Card, CardHead, Disclosure, InfoTip, Progress, Skeleton, StatusMark, Tag } from "../ui/index.js";
import { fmtCount, fmtHnt, fmtUsd, plural } from "../format.js";
import { CLAIM_LABEL, NOTHING_TO_CLAIM } from "../copy.js";

const tok = (v) => fmtHnt(v, "stat");
const CANT_NOTE =
  "Some rewards can't be claimed yet, typically because the receiving wallet needs a token account for them. They stay in Unclaimed until then. See Balances.";
const LEGACY = [
  ["iot", "IOT"],
  ["mobile", "MOBILE"],
];
const ACTION = "max-md:w-full";

/** The source rows' label (Hotspots, Legacy tokens, veHNT). */
const Lab = ({ children }) => <dt className="col-span-full flex items-center gap-1.5 text-xs font-semibold text-wd-ink-2">{children}</dt>;
const Row = ({ children }) => (
  <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1 border-t border-wd-line-2 pt-3.5 md:grid-cols-[minmax(0,1fr)_auto]">
    {children}
  </div>
);

/** veHNT positions with unclaimed delegation rewards (the API's per-position amount, else unclaimed epochs). */
function positionsWithPending(governance) {
  return (governance?.data?.positions || []).filter(
    (p) => Number(p.pendingRewardsHnt) > 0 || (p.pendingRewardsHnt == null && p.delegation?.unclaimedEpochs > 0),
  ).length;
}

/**
 * Earnings' Unclaimed card (WdEarnings): the total (Hotspots + veHNT, HNT
 * first, USD at today's price), then where it comes from: the Hotspots
 * ("Claimable now" vs "Can't claim yet"), legacy IOT and MOBILE, and veHNT,
 * each with its own claim exit. Hotspot rewards are claimed in the Hotspot
 * claimer and veHNT rewards in veHNT (both tools on this site, same tab).
 * While the rewards scan runs the figures read "so far" with a progress bar;
 * a failed scan shows Retry (`onRetry`: the failed batches only, or the
 * Hotspot list when that is what failed; none when it can't be retried here).
 */
export default memo(function UnclaimedCard({ wallet, money, list, governance, onRetry }) {
  const u = money.unclaimed;
  const hs = u.hotspotsState;
  const total = u.total || list.counts.total;
  const hasHs = list.counts.total > 0 || u.fleetFailed;
  const claimHref = `/hotspot-claimer?mode=wallet&wallet=${encodeURIComponent(wallet)}`;
  const veHref = `/ve-hnt?wallet=${encodeURIComponent(wallet)}`;
  const loading = !u.fleetFailed && (hs === "loading" || (hs === "none" && u.veState === "loading" && !hasHs));
  const failed = hasHs && (hs === "failed" || u.fleetFailed);
  const scanning = hs === "scanning";
  const sofar = scanning ? " so far" : "";
  const failedRows = list.rows.reduce((n, r) => n + (r.unclaimed.state === "failed" ? 1 : 0), 0);

  const legacy = LEGACY.filter(([k]) => u.legacy[k] > 0);
  const hsHnt = u.hotspotsHnt ?? 0;
  const veHnt = u.veHnt ?? 0;
  const totalHnt = (u.hotspotsHnt ?? 0) + veHnt;
  // Today's prices come with the balances: until they answer, the USD line waits.
  const pricesLoading = money.walletValue.state === "loading";
  const usdToday = money.prices ? u.usdToday : null;
  let usdLine;
  if (!scanning && totalHnt === 0 && !legacy.length) usdLine = NOTHING_TO_CLAIM;
  else if (usdToday == null && pricesLoading) usdLine = null;
  else {
    const parts = [
      usdToday == null
        ? "USD at today's price unavailable."
        : `${fmtUsd(usdToday)}${scanning ? " so far, at today's " : " at today's "}${legacy.length ? "prices" : "price"}.`,
    ];
    if (legacy.length) parts.push(`Includes legacy ${legacy.map(([, t]) => t).join(" and ")}.`);
    if (veHnt > 0) parts.push("Includes veHNT rewards.");
    usdLine = parts.join(" ");
  }
  const anything = hsHnt > 0 || legacy.length > 0;
  const cant = u.cantClaimHnt ?? 0;
  const claimable = u.claimableHnt ?? 0;
  const scanText = `Checking ${fmtCount(u.checked)} of ${plural(total, "Hotspot")}…`;

  const positions = Number(governance?.data?.totals?.positionCount) || 0;
  const withPending = positionsWithPending(governance);

  return (
    <Card busy={loading || scanning} className="flex min-w-0 flex-col gap-3.5">
      <CardHead title="Unclaimed" right="since last claim" />

      {loading && (
        <>
          <div className="flex flex-col gap-1.5">
            <Skeleton w={168} h={38} className="max-w-full" />
            <Skeleton w={200} h={14} className="max-w-full" />
            <span className="sr-only">Loading</span>
          </div>
          <span className="text-[13px] leading-[18px] text-wd-ink-2">
            {total > 0
              ? `Checking 0 of ${plural(total, "Hotspot")}…`
              : hs === "loading"
                ? "Checking Hotspot rewards…"
                : "Checking veHNT rewards…"}
          </span>
        </>
      )}

      {failed && (
        // A failed Hotspot list is announced once, by Summary's status line (ui/FleetError).
        <div role={u.fleetFailed ? undefined : "alert"} className="flex flex-col items-start gap-2.5 pb-1 pt-2">
          <p className="m-0 text-sm font-semibold text-wd-ink">Couldn&apos;t check Hotspot rewards.</p>
          <div className="flex w-full flex-col items-stretch gap-2 md:w-auto md:flex-row md:items-center md:gap-3">
            {onRetry && (
              <Btn2 onClick={onRetry} aria-label={u.fleetFailed ? "Retry loading Hotspots" : "Retry Hotspot rewards"}>
                Retry
              </Btn2>
            )}
            {u.fleetFailed && (
              <span className="text-wd-cap text-wd-ink-2">
                {onRetry ? "They load with the Hotspot list." : "They load with the Hotspot list. Retry above."}
              </span>
            )}
            {!u.fleetFailed && u.error && (
              <Disclosure summary="Details" className="text-wd-cap">
                <span className="block pt-1">{String(u.error)}</span>
              </Disclosure>
            )}
          </div>
        </div>
      )}

      {!loading && !failed && (
        <div className="flex flex-col gap-0.5">
          {u.hnt == null || (!hasHs && u.veState === "failed") ? (
            <p className="m-0 font-display text-[22px] font-semibold leading-[30px] text-wd-ink-2">Couldn&apos;t load</p>
          ) : (
            <>
              <div className="font-display text-wd-l font-semibold text-wd-ink">
                {tok(totalHnt)}
                <span className="ml-[0.22em] text-[0.5em] font-semibold tracking-normal text-wd-ink-3">HNT</span>
                {scanning && <span className="ml-[0.45em] font-sans text-sm font-medium tracking-normal text-wd-ink-2">so far</span>}
              </div>
              {usdLine ? (
                <span className="text-[13px] leading-[18px] text-wd-ink-2">{usdLine}</span>
              ) : (
                <Skeleton w={200} h={14} className="mt-1 max-w-full" />
              )}
            </>
          )}
          {scanning && (
            <div className="mt-3 flex flex-col gap-1.5">
              <Progress label="Checking Hotspot rewards" now={u.checked} max={total} valueText={scanText} />
              <span className="text-[13px] leading-[18px] text-wd-ink-2">{scanText}</span>
            </div>
          )}
        </div>
      )}

      <dl className="m-0 flex flex-col gap-3.5">
        {hasHs && !loading && !failed && (
          <Row>
            <Lab>Hotspots</Lab>
            <dd className="m-0 flex min-w-0 flex-col gap-0.5">
              <span className="font-display text-wd-s font-semibold text-wd-ink">
                {hsHnt === 0 ? "0" : tok(hsHnt)} HNT{sofar}
              </span>
              <span className="text-wd-cap text-wd-ink-3">
                {scanning
                  ? `${fmtCount(u.withPending)} of ${fmtCount(u.checked)} Hotspots checked so far have unclaimed HNT.`
                  : u.withPending === 0
                    ? `Nothing to claim from ${plural(total, "Hotspot")} right now.`
                    : `${fmtCount(u.withPending)} of ${failedRows > 0 ? `the ${plural(total - failedRows, "Hotspot")} checked` : plural(total, "Hotspot")} ${u.withPending === 1 ? "has" : "have"} unclaimed HNT. Claim it in the Hotspot claimer.`}
              </span>
            </dd>
            <dd className="m-0 self-stretch md:self-center">
              {anything ? (
                <Btn href={claimHref} className={ACTION}>
                  {CLAIM_LABEL.hotspots}
                </Btn>
              ) : (
                <Btn2 href={claimHref} className={`${ACTION} md:min-h-9 md:text-[13px]`}>
                  {CLAIM_LABEL.hotspots}
                </Btn2>
              )}
            </dd>
            {(scanning || hsHnt > 0) && (
              <dd className="col-span-full m-0 mt-1.5 grid grid-cols-2 gap-3 rounded-lg bg-wd-well px-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-wd-cap text-wd-ink-2">Claimable now</span>
                  <span className="font-display text-[15px] font-semibold leading-5 text-wd-ink">
                    {scanning ? `${tok(claimable)} HNT so far` : claimable > 0 ? `${tok(claimable)} HNT` : "None"}
                  </span>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-wd-cap text-wd-ink-2">
                    Can&apos;t claim yet
                    <InfoTip label="rewards that can't be claimed yet">{CANT_NOTE}</InfoTip>
                  </span>
                  <span className="font-display text-[15px] font-semibold leading-5 text-wd-ink">
                    {scanning ? (cant > 0 ? `${tok(cant)} HNT so far` : "None so far") : cant > 0 ? `${tok(cant)} HNT` : "None"}
                  </span>
                </div>
              </dd>
            )}
            {!scanning && u.noOracle > 0 && (
              <dd className="col-span-full m-0 flex items-start gap-2 pt-1 text-[13px] leading-[18px] text-wd-ink-2">
                <StatusMark tier="unknown" className="mt-[3px]" />
                <span>Couldn&apos;t confirm unclaimed HNT for {plural(u.noOracle, "Hotspot")} right now, so this total may be low.</span>
              </dd>
            )}
            {!scanning && failedRows > 0 && (
              <dd className="col-span-full m-0 flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-[13px] leading-[18px] text-wd-ink-2">
                <StatusMark tier="unknown" />
                <span>{plural(failedRows, "Hotspot")} couldn&apos;t be checked, so this total may be low.</span>
                <Btn2 onClick={onRetry} aria-label="Retry Hotspot rewards">
                  Retry
                </Btn2>
              </dd>
            )}
          </Row>
        )}

        {!loading && !failed && legacy.length > 0 && (
          <Row>
            <Lab>Legacy tokens</Lab>
            {legacy.map(([k, t]) => (
              <dd key={k} className="col-span-full m-0 flex flex-wrap items-baseline gap-x-2 text-[13px] leading-[18px] text-wd-ink-2">
                <span className="font-display text-sm font-medium leading-5 tracking-[-0.01em] text-wd-ink-2">{tok(u.legacy[k])}</span>
                <span>{t}</span>
                <Tag>legacy</Tag>
                <span className="basis-full text-wd-cap text-wd-ink-3">
                  {scanning ? "So far. Claimed with Hotspot rewards." : "Claimable now. Claimed with Hotspot rewards."}
                </span>
              </dd>
            ))}
          </Row>
        )}

        {u.veState === "loading" ? (
          <Row>
            <Lab>veHNT</Lab>
            <dd className="m-0">
              <Skeleton w={96} h={22} />
              <span className="sr-only">Loading</span>
            </dd>
          </Row>
        ) : u.veState === "failed" ? (
          <Row>
            <Lab>veHNT</Lab>
            <dd className="m-0 flex min-w-0 flex-col gap-0.5">
              <span className="font-display text-wd-s font-semibold text-wd-ink-2">Couldn&apos;t load</span>
              <span className="text-wd-cap text-wd-ink-3">veHNT positions couldn&apos;t be checked.</span>
            </dd>
            {governance?.retry && (
              <dd className="m-0">
                <Btn2 onClick={governance.retry} aria-label="Retry veHNT">
                  Retry
                </Btn2>
              </dd>
            )}
            {governance?.error && (
              <dd className="col-span-full m-0">
                <Disclosure summary="Details" className="text-wd-cap">
                  <span className="block pt-1">{String(governance.error)}</span>
                </Disclosure>
              </dd>
            )}
          </Row>
        ) : (
          <Row>
            <Lab>veHNT</Lab>
            <dd className="m-0 flex min-w-0 flex-col gap-0.5">
              <span className="font-display text-wd-s font-semibold text-wd-ink">{veHnt > 0 ? `${tok(veHnt)} HNT` : "None"}</span>
              <span className="text-wd-cap text-wd-ink-3">
                {positions === 0
                  ? "No veHNT positions in this wallet."
                  : veHnt > 0
                    ? `${withPending > 0 ? `From ${fmtCount(withPending)} of ${plural(positions, "position")}.` : `From ${plural(positions, "position")}.`} Claim it in veHNT, not with Hotspot rewards.`
                    : `${plural(positions, "position")}, nothing unclaimed.`}
              </span>
            </dd>
            {veHnt > 0 && (
              <dd className="m-0 self-stretch md:self-center">
                <Btn2 href={veHref} className={`${ACTION} md:min-h-9 md:text-[13px]`}>
                  {CLAIM_LABEL.veHnt}
                </Btn2>
              </dd>
            )}
          </Row>
        )}
      </dl>
    </Card>
  );
});
