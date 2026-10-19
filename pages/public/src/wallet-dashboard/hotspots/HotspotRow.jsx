import { memo } from "react";
import { fmtCount, fmtHnt, fmtUtcDate } from "../format.js";
import { InfoTip } from "../ui/InfoTip.jsx";
import { NetDot } from "../ui/NetDot.jsx";
import { Pending } from "../ui/Pending.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { Sparkline } from "../ui/Sparkline.jsx";
import { StatusMark } from "../ui/StatusMark.jsx";
import StatusCell from "./StatusCell.jsx";
import { LOWER_BOUND_NOTE } from "../copy.js";

export { LOWER_BOUND_NOTE };

// ── Cell models, shared by the table row and the phone list ─────────────────
// Each returns { text, num } (a figure in Space Grotesk when `num`, else a
// word), or { pending: true } for "…" (read as "Loading"), plus optional
// `sub` (a second line) and `tip` (an InfoTip). Never a dash, never a false 0.

const NO_DAILY = { iot: "No daily HNT for IoT", cbrs: "No daily HNT for CBRS", none: "No daily HNT" };
const PENDING = Object.freeze({ pending: true });
const num = (text, extra) => ({ text, num: true, ...extra });
const word = (text, extra) => ({ text, num: false, ...extra });

/** Why this row has no daily HNT ("No daily HNT for IoT"), or null for a Mobile row. */
export const noDailyText = (row) => (row.noDaily ? NO_DAILY[row.noDaily] : null);

/** Unclaimed HNT: "14.61", "0", "<0.01"; "Couldn't confirm" (no oracle answer),
 * "Couldn't load" (its batch failed), "Unavailable" (no asset ID). */
export function unclaimedModel(row, wallet) {
  const u = row.unclaimed;
  if (u.state === "loading") return PENDING;
  if (u.state === "failed") return word("Couldn't load");
  if (u.state === "unconfirmed") return word("Couldn't confirm");
  if (u.state !== "ok") return word("Unavailable");
  const sub =
    u.reason === "no_ata" ? "cantClaim" : u.destination && u.destination !== wallet ? "Pays another wallet" : null;
  return num(fmtHnt(u.hnt, "list"), { sub });
}

/** Lifetime HNT: a figure, "Never rewarded", "0 · legacy only", "≥ 137.89"
 * (with its lower-bound InfoTip) when unclaimed couldn't be confirmed. */
export function lifetimeModel(row) {
  const l = row.lifetime;
  if (l.state === "loading") return PENDING;
  if (l.state === "failed") return word("Couldn't load");
  if (l.state !== "ok") return word("Unavailable");
  if (l.never) return word("Never rewarded");
  if (l.lowerBound) return num(`≥ ${fmtHnt(l.hnt, "list")}`, { tip: LOWER_BOUND_NOTE });
  if (l.legacyOnly) return word("0 · legacy only");
  return num(fmtHnt(l.hnt, "list"));
}

/** HNT on the latest UTC day (Mobile rows): a figure, "…" (incl. a saved view
 * that kept only daily totals), "No data" (day not published), "Couldn't load". */
export function dayModel(row) {
  const d = row.day;
  if (d.state === "ok") return num(fmtHnt(d.hnt, "list"));
  if (d.state === "missing") return word("No data");
  if (d.state === "failed") return word("Couldn't load");
  if (d.state === "na") return word(noDailyText(row) ?? "No daily HNT");
  return PENDING;
}

/** HNT over the 7 UTC days (Mobile rows): the sum over the days that loaded,
 * never padded; `sub` "6 of 7 days" when one is missing. */
export function weekModel(row) {
  const w = row.week;
  if (w.state === "ok") return num(fmtHnt(w.hnt, "list"), { spark: true });
  if (w.state === "partial") return num(fmtHnt(w.hnt, "list"), { spark: true, sub: `${w.daysLoaded} of 7 days` });
  if (w.state === "failed") return word("Couldn't load");
  if (w.state === "na") return word(noDailyText(row) ?? "No daily HNT");
  return PENDING;
}

/** Delivered messages, 30 days (IoT): a count ("0" is a real zero), "…",
 * "Unavailable", "Not published", "Not on IoT". */
export function messagesModel(row) {
  const m = row.messages;
  if (m.state === "ok") return num(fmtCount(m.count));
  if (m.state === "pending") return PENDING;
  if (m.state === "unpublished") return word("Not published");
  if (m.state === "unavailable") return word("Unavailable");
  return word("Not on IoT");
}

/** The earliest network's onboard date (UTC): "Nov 22, 2024", "…", "Unknown";
 * a dual-network Hotspot with both dates gets a tip listing them. */
export function onboardedModel(row) {
  const o = row.onboarded;
  if (o.at === undefined) return PENDING;
  if (!o.at) return word("Unknown");
  const tip = o.iot && o.mobile ? `IoT ${fmtUtcDate(o.iot)} · Mobile ${fmtUtcDate(o.mobile)}` : null;
  return word(fmtUtcDate(o.at), { tip, date: true });
}

/** Line 2 of a row: network dots (both for a dual-network Hotspot, none for
 * CBRS or no network), the device label and the place. */
export function sublineOf(row) {
  const n = row.nets;
  const dots = n.cbrs || n.none ? null : n.dual ? ["iot", "mobile"] : n.iot ? ["iot", null] : ["mobile", null];
  const device = n.dual ? `${row.deviceLabel} · also on Mobile` : row.deviceLabel;
  return { dots, device, place: row.placeText };
}

// ── Rendering ───────────────────────────────────────────────────────────────

const NUM = "whitespace-nowrap font-display font-semibold tabular-nums text-wd-ink";
const PEND = "whitespace-nowrap font-display font-semibold text-wd-ink-2";
const WORD = "whitespace-nowrap text-wd-sm text-wd-ink-2";

/** One cell value from a model (figure, word or "…"), with `srUnit` read after a figure ("HNT"). */
export function CellValue({ model, srUnit, className = "" }) {
  if (model.pending) return <Pending className={`${PEND} ${className}`} />;
  return (
    <span className={`${model.num ? NUM : WORD} ${className}`}>
      {model.text}
      {srUnit && model.num && <span className="sr-only"> {srUnit}</span>}
    </span>
  );
}

function CantClaim() {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusMark tier="check" sr={false} className="!h-2.5 !w-2.5" />
      Can't claim yet
    </span>
  );
}

/** A model's second line ("Can't claim yet", "Pays another wallet", "6 of 7 days"). */
export function CellSub({ sub, className = "" }) {
  if (!sub) return null;
  return <span className={`block text-wd-cap text-wd-ink-2 ${className}`}>{sub === "cantClaim" ? <CantClaim /> : sub}</span>;
}

/** Column widths (border box, as the design sets them); below 1024 px
 * the figure columns size to their content, and Hotspot and Status give a
 * little more than the design's 170 / 180 px floors so the table fits a
 * 768 px window without scrolling sideways. */
export const COL = {
  name: "min-w-[240px] max-lg:min-w-[150px]",
  status: "w-[264px] max-lg:w-[200px] max-lg:min-w-[156px]",
  unc: "w-32 max-lg:w-auto",
  day: "w-[116px] max-lg:w-auto max-lg:min-w-[84px]",
  week: "w-[164px] max-lg:w-auto max-lg:min-w-[104px]",
  life: "w-28 max-lg:w-auto",
  onb: "w-[120px]",
  msg: "w-[150px] max-lg:w-auto",
};

// Cell padding 12 px (10 below 1024), the row ends 24 px in.
export const TD =
  "border-t border-wd-line-2 px-3 py-3 align-top first:pl-6 last:pr-6 max-lg:px-2.5 max-lg:first:pl-6 max-lg:last:pr-6";

function NumCell({ model, children, width = "", tipLabel }) {
  return (
    <td className={`${TD} text-right ${width}`}>
      <div className="flex items-end justify-end gap-2">
        {children}
        <CellValue model={model} />
        {model.tip && (
          <InfoTip label={tipLabel} className="self-center">
            {model.tip}
          </InfoTip>
        )}
      </div>
      <CellSub sub={model.sub} className="text-right" />
    </td>
  );
}

/**
 * One Hotspot as a table row (desktop and tablet): the name link (the row's
 * only tab stop; a click anywhere on the row opens the detail too), its
 * Status cell, and the money and network cells for the column set `mode`:
 * "mixed" (Unclaimed, the Mobile data-transfer band, Lifetime, Onboarded) or
 * "iot" (Messages, Unclaimed, Lifetime, Onboarded); `narrow` (the detail is
 * open beside the list) keeps Hotspot, Status, Unclaimed and 7 days (or
 * Messages). Memoized on primitives and the row object, which the list keeps
 * identical across flushes that don't touch it.
 */
export default memo(function HotspotRow({
  row,
  mode,
  narrow,
  showOnboarded,
  selected,
  flashKey,
  noLonger,
  scaleMax,
  wallet,
  href,
  onOpen,
}) {
  const sub = sublineOf(row);
  const u = unclaimedModel(row, wallet);
  const open = (e) => {
    // A link, a control or a text selection (copying a name) inside the row
    // isn't a click on the row.
    if (e.target.closest?.("a, button") || window.getSelection?.().toString()) return;
    const link = e.currentTarget.querySelector("[data-hotspot-link]");
    onOpen(row.param, link);
  };
  const onLink = (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab / window
    e.preventDefault();
    onOpen(row.param, e.currentTarget);
  };
  const week = weekModel(row);
  const weekCell = (width) => (
    <NumCell model={week} width={width}>
      {week.spark && <Sparkline days={row.week.days} scaleMax={scaleMax} className="max-lg:hidden" />}
    </NumCell>
  );
  const na = noDailyText(row);
  const onb = onboardedModel(row);

  let cells;
  if (mode === "iot") {
    cells = narrow ? (
      <>
        <NumCell model={u} width={COL.unc} />
        <NumCell model={messagesModel(row)} width={COL.msg} />
      </>
    ) : (
      <>
        <NumCell model={messagesModel(row)} width={COL.msg} />
        <NumCell model={u} width={COL.unc} />
        <NumCell model={lifetimeModel(row)} width={COL.life} tipLabel="About this lifetime figure" />
      </>
    );
  } else if (narrow) {
    cells = (
      <>
        <NumCell model={u} width={COL.unc} />
        {na ? (
          // A sentence, not a figure: it wraps like the wide table's spanning cell.
          <td className={`${TD} text-right text-wd-sm text-wd-ink-2 ${COL.week}`}>{na}</td>
        ) : (
          weekCell(COL.week)
        )}
      </>
    );
  } else {
    cells = (
      <>
        <NumCell model={u} width={COL.unc} />
        {na ? (
          <td colSpan={2} className={`${TD} text-center text-wd-sm text-wd-ink-2`}>
            {na}
          </td>
        ) : (
          <>
            <NumCell model={dayModel(row)} width={COL.day} />
            {weekCell(COL.week)}
          </>
        )}
        <NumCell model={lifetimeModel(row)} width={COL.life} tipLabel="About this lifetime figure" />
      </>
    );
  }

  return (
    <tr
      aria-current={selected ? "true" : undefined}
      onClick={open}
      className={`cursor-pointer ${selected ? "[&>*]:bg-accent-surface [&>:first-child]:shadow-[inset_3px_0_0_rgb(var(--color-accent))]" : "[&:hover>*]:bg-wd-well"}`}
    >
      <th scope="row" className={`${TD} text-left font-normal ${COL.name}`}>
        <a
          href={href}
          data-hotspot-link={row.param}
          onClick={onLink}
          className="block text-sm font-semibold leading-5 text-wd-ink hover:text-accent-text hover:opacity-100"
        >
          {row.name || "Unnamed Hotspot"}
        </a>
        <span className="mt-0.5 flex items-start gap-1.5 text-wd-cap text-wd-ink-2">
          {sub.dots && <NetDot net={sub.dots[0]} second={sub.dots[1]} className="mt-1" />}
          <span>
            {sub.device} · {sub.place}
          </span>
        </span>
        {noLonger && (
          <span className="mt-1 inline-block rounded-full border border-wd-control px-1.5 text-[11px] font-medium leading-4 text-wd-ink-2">
            No longer matches
          </span>
        )}
      </th>
      <td className={`${TD} ${COL.status}`}>
        <StatusCell row={row} flashKey={flashKey} />
      </td>
      {cells}
      {showOnboarded && (
        <td className={`${TD} ${COL.onb}`}>
          <div className="flex items-start gap-1.5">
            <CellValue model={onb} />
            {onb.tip && (
              <InfoTip label="About this Hotspot's onboard dates" className="mt-px">
                {onb.tip}
              </InfoTip>
            )}
          </div>
        </td>
      )}
    </tr>
  );
});

/** A placeholder row in the final shape while the list loads (or a small
 * fleet's first paint waits for its rewards): skeleton name, "Checking…",
 * "…" in every figure cell. */
export function SkeletonRow({ cells }) {
  return (
    <tr>
      <th scope="row" className={`${TD} text-left font-normal ${COL.name}`}>
        <Skeleton w={180} h={14} className="mb-[7px] mt-[3px] max-w-full" />
        <Skeleton w={132} h={10} className="max-w-full" />
        <span className="sr-only">Loading Hotspot</span>
      </th>
      <td className={`${TD} ${COL.status}`}>
        <span className="flex items-center gap-1.5 text-wd-sm font-semibold text-wd-ink-2">
          <StatusMark tier="checking" className="ml-px" />
          Checking…
        </span>
      </td>
      {cells.map((align, i) => (
        <td key={i} className={`${TD} ${align === "left" ? "text-left" : "text-right"}`}>
          <Pending className={PEND} />
        </td>
      ))}
    </tr>
  );
}
