import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { fmtCount } from "../format.js";

const UNNAMED = "Unnamed Hotspot";
const ICON_BTN =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-wd-ink-2 transition hover:bg-wd-well hover:text-wd-ink disabled:cursor-default disabled:text-wd-ink-4 disabled:hover:bg-transparent";

/** "6 of 10, by Unclaimed": where the open Hotspot sits in the list's order. */
export function positionText(nav) {
  return nav.total > 0 ? `${fmtCount(nav.index + 1)} of ${fmtCount(nav.total)}, by ${nav.sortLabel}` : null;
}

/**
 * The detail's sticky bar: Close, the Hotspot's name (full screen only,
 * where the heading scrolls away), its position in the list's order, and
 * Previous / Next through the filtered order (disabled at the ends).
 */
export function DetailBar({ name, nav, fullscreen, card, onClose, onNavigate }) {
  const pos = positionText(nav);
  return (
    <div
      className={`sticky top-0 z-[4] flex items-center gap-1 border-b border-wd-line-2 bg-[var(--wd-glass)] backdrop-blur-[8px] ${
        fullscreen ? "min-h-14 px-1 py-1.5" : "px-2.5 py-2"
      } ${card ? "rounded-t-2xl" : ""}`}
    >
      <button type="button" onClick={onClose} aria-label="Close Hotspot details" className={ICON_BTN}>
        <XMarkIcon aria-hidden="true" className="h-5 w-5" />
      </button>
      {fullscreen ? (
        <span
          aria-hidden="true"
          className="min-w-0 flex-1 truncate pl-1 font-display text-[15px] font-semibold leading-5 text-wd-ink"
        >
          {name || UNNAMED}
        </span>
      ) : (
        <span className="ml-auto mr-1 whitespace-nowrap text-wd-cap text-wd-ink-2">{pos}</span>
      )}
      <button
        type="button"
        onClick={() => onNavigate(nav.prev)}
        disabled={!nav.prev}
        aria-label={nav.prev ? `Previous: ${nav.prev.name || UNNAMED}` : "No previous Hotspot"}
        className={ICON_BTN}
      >
        <ChevronLeftIcon aria-hidden="true" className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => onNavigate(nav.next)}
        disabled={!nav.next}
        aria-label={nav.next ? `Next: ${nav.next.name || UNNAMED}` : "No next Hotspot"}
        className={ICON_BTN}
      >
        <ChevronRightIcon aria-hidden="true" className="h-5 w-5" />
      </button>
    </div>
  );
}

const NAV_BTN =
  "flex min-h-11 min-w-0 flex-col justify-center gap-px rounded-[10px] border border-wd-control bg-surface-raised px-3 py-1.5 text-wd-ink transition hover:bg-wd-well";

/** Previous / Next at the end of the detail, naming the Hotspots they open. */
export function DetailBottomNav({ nav, onNavigate }) {
  if (!nav.prev && !nav.next) return null;
  return (
    <nav aria-label="Other Hotspots" className="grid grid-cols-2 gap-2 border-t border-wd-line-2 px-5 pb-[18px] pt-3.5 max-md:px-4 max-md:pb-6">
      {nav.prev && (
        <button type="button" onClick={() => onNavigate(nav.prev)} className={`${NAV_BTN} items-start text-left`}>
          <span className="text-[11px] leading-[14px] text-wd-ink-2">
            <span aria-hidden="true">‹ </span>Previous
          </span>
          <span className="block max-w-full truncate text-wd-sm font-semibold">{nav.prev.name || UNNAMED}</span>
        </button>
      )}
      {nav.next && (
        <button type="button" onClick={() => onNavigate(nav.next)} className={`${NAV_BTN} col-start-2 items-end text-right`}>
          <span className="text-[11px] leading-[14px] text-wd-ink-2">
            Next<span aria-hidden="true"> ›</span>
          </span>
          <span className="block max-w-full truncate text-wd-sm font-semibold">{nav.next.name || UNNAMED}</span>
        </button>
      )}
    </nav>
  );
}
