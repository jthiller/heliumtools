import { memo } from "react";
import { CheckIcon } from "@heroicons/react/16/solid";
import { Btn2, Card, CardHead, InfoTip, Skeleton, StatusMark, Tag } from "../ui/index.js";
import { fmtToken, fmtUsd } from "../format.js";
import { fmtClock } from "../mobileFormat.js";
import { joinAnd } from "../about/aboutModel.js";

// HNT, SOL and DC, then the legacy reward tokens. Zero balances fold into one line.
const ORDER = ["hnt", "sol", "dc", "mobile", "iot"];
const META = {
  hnt: { label: "HNT", swatch: "bg-wd-hnt" },
  sol: { label: "SOL", swatch: "bg-wd-sol" },
  dc: { label: "DC", swatch: "bg-wd-dc" },
  mobile: { label: "MOBILE", legacy: true },
  iot: { label: "IOT", legacy: true },
};

/** "$0.4235 per HNT": 2 decimals from $1, 4 from a cent, else 3 significant digits; DC at its fixed price. */
function priceText(token, price) {
  if (token === "dc") return "$1 per 100,000 DC";
  if (price == null) return "No price right now";
  const s =
    price >= 1
      ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : price >= 0.01
        ? price.toFixed(4)
        : String(Number(price.toPrecision(3)));
  return `$${s} per ${META[token].label}`;
}

function AccountOpen({ children }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <CheckIcon aria-hidden="true" className="h-3 w-3 text-wd-ink-3" />
      {children}
    </span>
  );
}

const ROW = "grid grid-cols-[12px_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-t border-wd-line-2 py-3 first:border-t-0";
const AMOUNT = "whitespace-nowrap text-right font-display text-base font-semibold tabular-nums tracking-[-0.01em] text-wd-ink";

/**
 * Wallet: Balances. Each nonzero token with its price per token and its
 * token account; zero balances on one line, with the caution and the
 * unclaimed amounts it blocks when a token account is missing; the wallet
 * value at the prices shown and what it leaves out (veHNT). `summary` is the
 * /summary state, `money` deriveMoney's (blocked Hotspot rewards), `governance`
 * the /ve-hnt/positions state (the "Not counted" line).
 */
export default memo(function Balances({ summary, money, governance }) {
  const data = summary.data;
  const loading = !data && !summary.error;
  const tokens = data?.tokens || {};
  const all = ORDER.map((k) => ({ k, ...META[k], ...(tokens[k] || {}), amount: Number(tokens[k]?.uiAmount) || 0 }));
  const rows = all.filter((t) => t.amount > 0);
  const zero = all.filter((t) => !(t.amount > 0));
  const missing = zero.filter((t) => t.ataEstablished === false);
  const open = zero.filter((t) => t.ataEstablished === true);
  // Hotspot rewards a missing token account blocks (shown once the rewards check settles).
  const u = money.unclaimed;
  const pending = u.state === "ready" ? { hnt: u.hotspotsHnt ?? 0, mobile: u.legacy?.mobile ?? 0, iot: u.legacy?.iot ?? 0 } : {};
  const blocked = missing.filter((t) => pending[t.k] > 0);
  const missingNames = joinAnd(missing.map((t) => t.label));
  const tipText =
    (missing.length === 1
      ? `No token account yet. This wallet needs one before it can receive ${missingNames}.`
      : `No token accounts yet for ${missingNames}. This wallet needs one for each before it can receive them.`) +
    blocked.map((t) => ` ${fmtToken(pending[t.k], { max: 4 })} ${t.label} unclaimed can't be claimed until it exists.`).join("");
  const unpriced = rows.filter((t) => t.k !== "dc" && t.priceUsd == null).map((t) => t.label);

  // veHNT isn't in the wallet value: locked, or in positions whose lockup ended.
  let locked = 0;
  let expired = 0;
  for (const p of governance.data?.positions || []) {
    const n = Number(p.amountLockedHnt) || 0;
    if (p.lockup?.isExpired) expired += n;
    else locked += n;
  }
  const notCounted = [
    locked > 0 ? `${fmtToken(locked, { max: 2 })} HNT locked in veHNT` : null,
    expired > 0 ? `${fmtToken(expired, { max: 2 })} HNT in expired veHNT positions` : null,
  ].filter(Boolean);

  return (
    <Card as="article" aria-labelledby="wallet-bal-title" busy={loading} className="flex flex-col">
      <CardHead
        id="wallet-bal-title"
        title="Balances"
        className="mb-2"
        right={loading ? "Loading" : data?.pricesFetchedAt ? `Prices as of ${fmtClock(data.pricesFetchedAt)}` : null}
      />
      {loading && (
        <>
          <span className="sr-only">Loading balances</span>
          <div aria-hidden="true">
            {[
              [48, 140],
              [40, 120],
              [120, 90],
            ].map(([a, b], i) => (
              <div key={i} className="flex items-center gap-3 border-t border-wd-line-2 py-[13px] first:border-t-0">
                <Skeleton w={12} h={12} />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton w={a} h={14} />
                  <Skeleton w={b} h={10} />
                </span>
                <span className="flex flex-col items-end gap-1.5">
                  <Skeleton w={110} h={14} />
                  <Skeleton w={56} h={10} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {/* The same failure as Summary's "Couldn't load this wallet.", which is its one alert. */}
      {!data && summary.error && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-wd-critical-surface px-3 py-2.5">
          <span className="inline-flex min-w-[180px] flex-1 items-center gap-2 text-wd-sm font-medium text-wd-critical-text">
            <StatusMark tier="serious" sr={false} />
            Couldn&apos;t load balances.
          </span>
          <Btn2 onClick={summary.retry} aria-label="Retry loading balances">
            Retry
          </Btn2>
        </div>
      )}
      {data && (
        <>
          <ul aria-label="Token balances" className="m-0 list-none p-0">
            {rows.map((t) => (
              <li key={t.k} className={ROW}>
                <span
                  aria-hidden="true"
                  className={`row-span-2 mt-1 h-3 w-3 self-start rounded-[3px] ${t.legacy ? "border-[1.5px] border-wd-ink-4" : t.swatch}`}
                />
                <span className="flex min-w-0 items-center gap-2 font-semibold text-wd-ink">
                  {t.label}
                  {t.legacy && <Tag>Legacy</Tag>}
                </span>
                <span className={AMOUNT}>
                  <span className="sr-only">Balance </span>
                  {fmtToken(t.amount, { max: t.k === "dc" ? 0 : 4 })}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-wd-cap leading-[18px] text-wd-ink-3">
                  <span>{priceText(t.k, t.priceUsd)}</span>
                  {t.ataEstablished === true && <AccountOpen>Token account open</AccountOpen>}
                </span>
                <span className="whitespace-nowrap text-right text-wd-cap leading-[18px] tabular-nums text-wd-ink-2">
                  {fmtUsd(t.valueUsd, { empty: "Not valued" })}
                </span>
              </li>
            ))}
            {zero.length > 0 && (
              <li className={ROW}>
                <span aria-hidden="true" className="row-span-2 mt-1 h-3 w-3 self-start" />
                <span className="min-w-0 font-medium text-wd-ink-2">{joinAnd(zero.map((t) => t.label))}</span>
                <span className={AMOUNT}>0</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-wd-cap leading-[18px] text-wd-ink-3">
                  {missing.length > 0 ? (
                    <span className="flex min-w-0 items-start gap-1.5 font-medium text-wd-caution-text">
                      <StatusMark tier="check" className="mt-[3px]" />
                      <span>
                        {`No token account for ${missingNames}`}
                        <InfoTip label={`no token account for ${missingNames}`} className="ml-1">
                          {tipText}
                        </InfoTip>
                      </span>
                    </span>
                  ) : open.length > 0 ? (
                    <AccountOpen>{open.length > 1 ? "Token accounts open" : "Token account open"}</AccountOpen>
                  ) : null}
                </span>
                <span className="whitespace-nowrap text-right text-wd-cap leading-[18px] tabular-nums text-wd-ink-2">$0.00</span>
              </li>
            )}
          </ul>
          <div className="mt-auto grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-t border-wd-line pt-3.5">
            <span className="font-semibold text-wd-ink">Wallet value</span>
            <span className="whitespace-nowrap text-right font-display text-xl font-semibold leading-[26px] tabular-nums tracking-[-0.01em] text-wd-ink">
              {fmtUsd(data.totalUsd)}
            </span>
            <span className="col-span-2 text-wd-cap text-wd-ink-3">
              {unpriced.length
                ? `Token balances at the prices shown. ${joinAnd(unpriced)} ${unpriced.length === 1 ? "has" : "have"} no price right now and ${unpriced.length === 1 ? "isn't" : "aren't"} counted.`
                : "Token balances at the prices shown"}
            </span>
            {notCounted.length > 0 && (
              <span className="col-span-2 mt-1.5 text-wd-cap text-wd-ink-2">{`Not counted: ${joinAnd(notCounted)}.`}</span>
            )}
          </div>
        </>
      )}
    </Card>
  );
});
