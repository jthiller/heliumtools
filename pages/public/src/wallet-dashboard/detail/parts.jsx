// Small building blocks the Hotspot detail's sections share (the design's
// dt-* classes): the section frame, a definition row, a status line, the
// 44 px secondary button, notes and wells. Detail-only, so they live here
// rather than in ui/.
import { StatusMark } from "../ui/StatusMark.jsx";
import { TIERS } from "../statusRegistry.js";

/** The detail's h2 id (one detail at a time: aside, drawer or full screen). */
export const DETAIL_TITLE_ID = "wd-detail-title";

// Control sizes come from custom properties: touch sizes by default (44 px
// controls; the aside and drawer are 440 px wide and the full-screen sheet is
// a phone), and the design's desktop sizes where FINE is set, on the inline
// detail of a one-Hotspot wallet, which sits in the wide Hotspots section.
const BTN_SIZE = "min-h-[var(--wd-dt-btn,2.75rem)] px-[var(--wd-dt-btnx,14px)] text-[length:var(--wd-dt-fs,13px)]";

/** The desktop control sizes (32 px buttons, 28 px small ones, the InfoTips'
 * own hit area), for the inline detail from 768 px up. */
export const FINE =
  "md:[--wd-dt-btn:2rem] md:[--wd-dt-btnx:11px] md:[--wd-dt-fs:12px] md:[--wd-dt-sm:1.75rem] md:[--wd-dt-tip:-4px] md:[--wd-dt-sum:1.5rem] md:[--wd-dt-link:0px]";

/** The detail's secondary button (a link with `href`). */
export const DBTN = `inline-flex ${BTN_SIZE} shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-wd-control bg-surface-raised font-medium text-wd-ink transition hover:bg-wd-well hover:no-underline`;

/** The small variant (Retry, Copy asset ID): 28 px on desktop, 44 on touch. */
export const DBTN_SM = `inline-flex min-h-[var(--wd-dt-sm,2.75rem)] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-wd-control bg-surface-raised px-2.5 text-[length:var(--wd-dt-fs,13px)] font-medium text-wd-ink transition hover:bg-wd-well`;

/** DBTN for a link (Solscan, Update location): accent text, like every link. */
export const DLINK = DBTN.replace("text-wd-ink", "text-accent-text");

/** CopyIconButton's text variant sized like DBTN, and like DBTN_SM. */
export const COPY_BTN = "!min-h-[var(--wd-dt-btn,2.75rem)] !px-[var(--wd-dt-btnx,14px)] !text-[length:var(--wd-dt-fs,13px)]";
export const COPY_SM = "!min-h-[var(--wd-dt-sm,2.75rem)] !px-2.5 !text-[length:var(--wd-dt-fs,13px)]";

/** CoverageToggle sized like DBTN. */
export const TOGGLE_BTN = COPY_BTN;

/** The Disclosure summary ("Legacy tokens"): 44 px on touch, 24 on desktop. */
export const SUMMARY = "!min-h-[var(--wd-dt-sum,2.75rem)]";

/** A text link's touch height (Claim rewards): 44 px on touch, its line on desktop. */
export const LINK_H = "min-h-[var(--wd-dt-link,2.75rem)]";

/** The 44 px hit area the detail gives its InfoTips (their own on desktop inline). */
export const TIP = "before:![inset:var(--wd-dt-tip,-14px)]";

/** A label's tone by tier: Serious and Check are colored, the rest ink. */
export function tierText(tier) {
  if (tier === "serious" || tier === "check") return TIERS[tier].textClass;
  if (tier === "checking") return "text-wd-ink-2";
  return "text-wd-ink";
}

/**
 * One section of the detail: a top divider, an h3 with an optional window or
 * chip on the right (`right`), then its content in a 12 px column.
 */
export function DSection({ id, title, right, children }) {
  const headingId = `wd-detail-${id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 border-t border-wd-line-2 px-5 pb-5 pt-[18px] max-md:p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="m-0 font-display text-wd-title font-semibold text-wd-ink">
          {title}
        </h3>
        {right != null && <div className="text-wd-cap text-wd-ink-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** A subsection under a divider (Earnings' Mobile bars, IoT's messages). */
export function DSub({ title, right, children }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-wd-line-2 pt-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1">
        <h4 className="m-0 text-wd-sm font-semibold text-wd-ink">{title}</h4>
        {right != null && <span className="text-wd-cap text-wd-ink-2">{right}</span>}
      </div>
      {children}
    </div>
  );
}

/** A `dl` of label / value rows (132 px labels; stacked on phones). */
export function DList({ children }) {
  return <dl className="m-0 flex flex-col">{children}</dl>;
}

/** One row of a DList: `label` (with an optional `tip` node), the value, an
 * optional `sub` line and `action` (a Retry). */
export function DRow({ label, tip, sub, action, children }) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-x-3.5 border-t border-wd-line-2 py-2.5 first:border-t-0 first:pt-0 max-md:grid-cols-1 max-md:gap-y-0.5">
      <dt className="flex items-start gap-1.5 text-wd-cap leading-[18px] text-wd-ink-2">
        {label}
        {tip}
      </dt>
      <dd className="m-0 min-w-0 text-wd-sm text-wd-ink [overflow-wrap:anywhere]">
        {children}
        {sub != null && sub !== "" && <span className="mt-0.5 block text-wd-cap text-wd-ink-2">{sub}</span>}
        {action && <div className="mt-1.5">{action}</div>}
      </dd>
    </div>
  );
}

/** A value with its status mark before it ("▲ None in the last 60 min"). */
export function MarkedValue({ tier, mark, className = "", children }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <StatusMark tier={tier} mark={mark} className="self-center" />
      <span className={className}>{children}</span>
    </span>
  );
}

/**
 * A status line: the tier mark (with its spoken tier word), the label and
 * its window under it. `mark` overrides the shape ("x" for Couldn't check);
 * `sr={false}` for Checking, whose label already says it.
 */
export function StateLine({ tier, mark, sr = true, label, sub, as: As = "div" }) {
  return (
    <As className="grid grid-cols-[12px_minmax(0,1fr)] gap-x-2.5">
      <span className="mt-1 flex">
        <StatusMark tier={tier} mark={mark} sr={false} />
      </span>
      <div className="min-w-0">
        {sr && tier !== "checking" && <span className="sr-only">{TIERS[tier]?.word ?? "Unknown"}: </span>}
        <span className={`block text-sm font-semibold leading-5 ${tierText(tier)}`}>{label}</span>
        {sub != null && sub !== "" && <span className="mt-px block text-wd-cap text-wd-ink-2">{sub}</span>}
      </div>
    </As>
  );
}

/** A quiet well of explanation ("Daily HNT isn't available for IoT Hotspots."). */
export function Well({ className = "", children }) {
  return <p className={`m-0 rounded-lg bg-wd-well px-3 py-2.5 text-wd-sm text-wd-ink-2 ${className}`}>{children}</p>;
}

/** A footnote line (12/17, ink-2). */
export function Foot({ className = "", children }) {
  return <p className={`m-0 text-xs leading-[17px] text-wd-ink-2 ${className}`}>{children}</p>;
}

/** A plain sentence in the section's flow (13/18, ink-2). */
export function Line({ className = "", children }) {
  return <p className={`m-0 text-wd-sm text-wd-ink-2 ${className}`}>{children}</p>;
}

/** A small Retry button. */
export function RetryBtn({ onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={DBTN_SM}>
      Retry
    </button>
  );
}

/** A failure line in a well, with the "couldn't check" mark and a Retry
 * ("Couldn't load daily detail."). */
export function FailNote({ onRetry, retryLabel, className = "", children }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-wd-well px-3 py-2.5 text-wd-sm text-wd-ink-2 ${className}`}
    >
      <StatusMark tier="unknown" mark="x" word="Unknown" />
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry && <RetryBtn onClick={onRetry} label={retryLabel} />}
    </div>
  );
}
