import { memo, useId, useState } from "react";
import { fmtCount } from "../format.js";
import { TIERS } from "../statusRegistry.js";
import { ArrivalFlash, Card, InfoTip, NetChip, Progress, Skeleton, StatusMark } from "../ui/index.js";
import StatusBar from "./StatusBar.jsx";

// "View in list ›": a 3:1 control border, accent text; 44 px on phones.
const VIEW_BTN =
  "inline-flex h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-wd-control bg-surface-raised px-3 text-wd-cap font-medium text-accent-text transition-colors hover:border-wd-accent-line hover:bg-accent-surface md:h-8";
// Retry / Details inside a failure note: 24 px tall on desktop (WCAG 2.2
// target size), 44 x 44 px on phones.
const NOTE_BTN =
  "inline-flex min-h-6 items-center rounded-md border-0 bg-transparent px-1 text-wd-sm font-semibold text-wd-critical-text underline underline-offset-2 max-md:min-h-11 max-md:min-w-11";

function ModuleHead({ id, net, title, window, chip }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {net && <NetChip net={net} />}
          {title ? (
            <h3 id={id} className="m-0 font-display text-wd-title font-semibold text-wd-ink">
              {title}
            </h3>
          ) : (
            <Skeleton w={140} h={20} />
          )}
        </div>
        {window ? <span className="text-wd-cap text-wd-ink-2">{window}</span> : <Skeleton w={220} h={14} />}
      </div>
      {chip}
    </header>
  );
}

/** The skeleton at the module's final shape: headline, window, the messages
 * well (IoT), the dashed bar and the rows. */
function ModuleSkeleton({ skel, sr }) {
  return (
    <>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton w="min(260px, 70%)" h={34} />
        <Skeleton w={150} h={14} />
        {skel.sub && <Skeleton h={72} className="w-full rounded-lg" />}
        <StatusBar pending />
        {Array.from({ length: skel.rows }, (_, i) => (
          <Skeleton key={i} h={40} className="w-full" />
        ))}
      </div>
      <span className="sr-only">{sr}</span>
    </>
  );
}

function ScanProgress({ text, label, now, max }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-wd-sm text-wd-ink-2">{text}</span>
      <Progress label={label} now={now} max={max} valueText={text} size={4} />
    </div>
  );
}

/** "5 of 8 WiFi Hotspots sent a heartbeat" over its window ("so far" while a
 * Retry runs, "As of 3:42 PM" from the saved paint); `value` replaces the
 * first figure (a CountUp), `flashKey` washes it on a live arrival. */
function Headline({ h, value, flashKey }) {
  return (
    <div className="relative -mx-2 flex flex-col gap-0.5 rounded-lg px-2">
      <ArrivalFlash flashKey={flashKey} />
      <p className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="whitespace-nowrap font-display text-[26px] font-semibold leading-8 tracking-[-0.02em] text-wd-ink md:text-wd-l">
          {value ?? fmtCount(h.a)}
          <span className="whitespace-pre text-lg font-medium tracking-normal text-wd-ink-3"> of </span>
          {fmtCount(h.b)}
        </span>
        {h.rate && <span className="font-display text-wd-s font-medium text-wd-ink-2">{h.rate}</span>}
        <span className="text-[15px] font-medium leading-[22px] text-wd-ink">{h.label}</span>
        {h.tip && (
          <InfoTip label={h.tip.label} className="self-center">
            {h.tip.text}
          </InfoTip>
        )}
        {h.sofar && (
          <span className="self-center whitespace-nowrap rounded border border-dashed border-wd-control px-1.5 font-mono text-[11px] font-medium leading-[18px] tracking-[0.04em] text-wd-ink-2">
            so far
          </span>
        )}
      </p>
      <span className="flex flex-wrap items-baseline gap-x-2.5 text-wd-sm text-wd-ink-2">
        <span>{h.win}</span>
        {h.asOf && <span className="text-wd-cap">{h.asOf}</span>}
      </span>
    </div>
  );
}

/** A failure note: what couldn't be checked, with Retry and, when there is a
 * reason, Details (the reason stays out of the sentence). */
function Note({ note, onRetry, retryLabel }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-wd-critical-surface px-3 py-2.5 text-wd-sm text-wd-critical-text">
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{note.text}</span>
        {note.retry && onRetry && (
          <button type="button" onClick={onRetry} aria-label={retryLabel} className={NOTE_BTN}>
            Retry
          </button>
        )}
        {note.details && (
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={NOTE_BTN}>
            Details
          </button>
        )}
      </p>
      {note.details && (
        <p id={id} hidden={!open} className="m-0 text-wd-cap">
          {note.details}
        </p>
      )}
    </div>
  );
}

/** The IoT "Messages delivered" well. */
function Subs({ subs }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-wd-well px-3.5 py-3">
      <p className="m-0 mb-0.5 font-mono text-wd-eyebrow font-medium uppercase text-wd-ink-2">{subs.title}</p>
      {subs.lines.map((l, i) => (
        <p key={i} className="m-0 text-wd-sm leading-[19px] text-wd-ink-2">
          {l.strong && <span className="font-semibold text-wd-ink">{l.strong}</span>}
          {l.text}
          {l.tip && (
            <InfoTip label={l.tip.label} className="ml-1.5">
              {l.tip.text}
            </InfoTip>
          )}
        </p>
      ))}
    </div>
  );
}

/**
 * One state's row: mark (with its sr-only tier word), label with its InfoTip
 * and window, the count (and share from 200 Hotspots up), a link to the list
 * filtered by the same predicate, and up to 10 names that each open their
 * Hotspot. Below 520 px of module width the link moves under the names.
 */
function HealthRow({ row, flashKey, onShowStatus, onOpenHotspot }) {
  const tone = row.tier === "serious" || row.tier === "check" ? TIERS[row.tier].textClass : "text-wd-ink";
  return (
    <li className="wd-hmod-row relative flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 border-t border-wd-line-2 py-2.5 first:border-t-0 first:pt-0.5">
      <ArrivalFlash flashKey={flashKey} />
      <span className="flex h-5 w-4 shrink-0 items-center justify-center self-start">
        <StatusMark tier={row.tier} mark={row.mark ?? undefined} word={row.word} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className={`text-sm font-semibold ${tone}`}>{row.label}</span>
          <InfoTip label={row.label}>{row.hint}</InfoTip>
        </span>
        <span className="text-wd-cap text-wd-ink-2">{row.win}</span>
      </div>
      <span className="flex items-baseline gap-1.5">
        <span className="font-display text-wd-s font-semibold tabular-nums text-wd-ink">{fmtCount(row.n)}</span>
        {row.pct && <span className="text-wd-cap tabular-nums text-wd-ink-2">{row.pct}</span>}
      </span>
      <span className="wd-hmod-btn [@container_wd-hmod_(max-width:520px)]:order-1 [@container_wd-hmod_(max-width:520px)]:mt-1 [@container_wd-hmod_(max-width:520px)]:pl-7">
        <button type="button" aria-label={row.btnAria} onClick={() => onShowStatus(row.filter)} className={VIEW_BTN}>
          {row.btn}
          <span aria-hidden="true">›</span>
        </button>
      </span>
      {row.names.length > 0 && (
        <ul aria-label={row.namesAria} className="m-0 flex basis-full list-none flex-wrap gap-x-4 gap-y-0.5 p-0 pl-7 max-md:gap-y-0">
          {row.names.map((h) => (
            <li key={h.key} className="flex min-h-6 items-center gap-1.5 text-wd-sm">
              <button
                type="button"
                aria-label={`${h.name}, open details`}
                onClick={(e) => onOpenHotspot(h.param, e.currentTarget)}
                className="border-0 bg-transparent p-0 text-left text-[13px] font-medium text-accent-text hover:underline hover:underline-offset-2 max-md:inline-flex max-md:min-h-11 max-md:items-center"
              >
                {h.name}
              </button>
              {h.val && <span className="text-wd-cap tabular-nums text-wd-ink-2">{h.val}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One Health module (WdHealth's IoT or Mobile card) from its view model
 * (health/iotModule.js, health/mobileModule.js): header (network chip,
 * title, window, `chip`), scan progress, skeleton while loading, the
 * headline (`headValue` replaces its first figure, washed by `headFlash`),
 * failure notes (Retry calls `onRetry`), the IoT messages well, the tier bar
 * and legend, the positive line, the rows by state (`rowFlashes[key]` washes
 * a row on a live arrival; their links call `onShowStatus(filter)` and their
 * names `onOpenHotspot(param, el)`), a Check note outside the bar, and the
 * footnotes. From 900 px of module width the body splits 5 / 7.
 */
export const HealthModule = memo(function HealthModule({
  vm,
  chip,
  headValue,
  headFlash,
  rowFlashes,
  onShowStatus,
  onOpenHotspot,
  onRetry,
}) {
  const titleId = `health-${vm.net}-title`;
  const side = Boolean(vm.positive || vm.rows.length || (vm.extra && !vm.loading));
  return (
    <Card as="article" aria-labelledby={titleId} busy={vm.loading} className="wd-hmod flex flex-col gap-4 md:gap-[18px]">
      <ModuleHead id={titleId} net={vm.net} title={vm.title} window={vm.window} chip={chip} />
      <div className="wd-hmod-body flex flex-col gap-[18px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {vm.progress && <ScanProgress {...vm.progress} />}
          {vm.loading && <ModuleSkeleton skel={vm.skel} sr={vm.loadingSr} />}
          {vm.headline && <Headline h={vm.headline} value={headValue} flashKey={headFlash} />}
          {vm.notes.map((note, i) => (
            // By position: a note whose time changes keeps its Details open.
            <Note key={i} note={note} onRetry={onRetry} retryLabel={vm.net === "iot" ? "Retry IoT status" : "Retry Mobile data"} />
          ))}
          {vm.subs && <Subs subs={vm.subs} />}
          {vm.bar && <StatusBar bar={vm.bar} />}
        </div>
        {side && (
          <div className="flex min-w-0 flex-col gap-2.5">
            {vm.positive && (
              <p className="m-0 flex items-center gap-2.5 rounded-lg bg-wd-well px-3 py-2.5 text-wd-sm text-wd-ink">
                <StatusMark tier="ok" sr={false} />
                {vm.positive}
              </p>
            )}
            {vm.rows.length > 0 && (
              <ul aria-label={vm.rowsAria} className="m-0 flex list-none flex-col p-0">
                {vm.rows.map((row) => (
                  <HealthRow
                    key={row.key}
                    row={row}
                    flashKey={rowFlashes?.[row.key]}
                    onShowStatus={onShowStatus}
                    onOpenHotspot={onOpenHotspot}
                  />
                ))}
              </ul>
            )}
            {vm.extra && !vm.loading && (
              <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg bg-wd-well px-3 py-2.5 text-wd-sm text-wd-ink">
                <StatusMark tier="check" />
                {/* At ≤ 520 px of module width the button goes under the text, as in the rows. */}
                <span className="min-w-0 flex-1 [@container_wd-hmod_(max-width:520px)]:basis-[calc(100%-22px)]">{vm.extra.text}</span>
                <span className="[@container_wd-hmod_(max-width:520px)]:pl-[22px]">
                  <button type="button" aria-label={vm.extra.btnAria} onClick={() => onShowStatus(vm.extra.filter)} className={VIEW_BTN}>
                    View in list
                    <span aria-hidden="true">›</span>
                  </button>
                </span>
              </p>
            )}
          </div>
        )}
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t border-wd-line-2 pt-3.5">
        {vm.foot.map((t) => (
          <p key={t} className="m-0 text-wd-cap leading-[17px] text-wd-ink-2">
            {t}
          </p>
        ))}
      </div>
    </Card>
  );
});

const RESERVED_NAME = { iot: "IoT health", mobile: "Mobile health" };

/** A module's place while the Hotspot list loads (from the summary's network
 * counts), at its final size; without `net`, the one module-wide skeleton
 * before either network is known. */
export function ReservedModule({ net = null }) {
  return (
    <Card as="article" busy aria-label={RESERVED_NAME[net] ?? "Hotspot health"} className="wd-hmod flex flex-col gap-4 md:gap-[18px]">
      <ModuleHead net={net} />
      <div className="flex flex-col gap-3.5">
        <ModuleSkeleton skel={{ sub: net !== "mobile", rows: net === "iot" ? 2 : 3 }} sr="Loading Hotspot health" />
      </div>
      {/* The footnotes' place, so the module doesn't grow when they arrive. */}
      <div aria-hidden="true" className="mt-auto flex flex-col gap-1 border-t border-wd-line-2 pt-3.5">
        <Skeleton h={14} className="w-4/5" />
      </div>
    </Card>
  );
}

export default HealthModule;
