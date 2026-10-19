import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { TimeAgo } from "../ui/index.js";

// Marks are decorative: each row's state is said in words beside it.
function SourceMark({ kind, dotClass }) {
  if (kind === "live") return <span aria-hidden="true" className={`wd-live ${dotClass ?? ""}`} />;
  const shape = kind === "ok" ? "ok" : kind === "na" ? "none" : kind === "error" ? "unknown" : "checking";
  return <span aria-hidden="true" className={`wd-st wd-st-${shape}`} />;
}

/** "Live · checked 1m ago" (the time ticks on the shared minute clock), else the words as given. */
function Checked({ word, at }) {
  if (!at) return word;
  return (
    <>
      {word} · checked <TimeAgo at={at} fallback="Unknown" />
    </>
  );
}

const CHIP_DOT = { checking: "checking pulse", error: "error", live: "" };
// The floating popover's width (md up) and the page gutter it keeps clear.
const POP_W = 440;
const GUTTER = 16;

/**
 * The Data status chip and its popover (WdSummary): the chip names the most
 * important thing about the page's sources in one line ("Live · checked 1m
 * ago", "Checking 150 of 1,659", "2 sources couldn't load", "Hotspots
 * couldn't load", "Couldn't check · data from 7:42 PM"); pressing it opens a
 * non-modal dialog listing every source, what it covers and its state. The
 * popover closes on Escape (focus back to the chip), the close button, or a
 * press outside it; it floats under the chip from md up (right-aligned to it,
 * or left-aligned when the actions wrap under the caption and there's no room
 * to its left) and sits in the flow on phones. `status` is
 * `deriveDataStatus()`. Resets (closes) per wallet.
 */
export default memo(function DataStatus({ status, wallet }) {
  const [openFor, setOpenFor] = useState(null);
  // Closed, not just hidden, on a wallet switch: coming back finds it closed.
  if (openFor !== null && openFor !== wallet) setOpenFor(null);
  const open = openFor === wallet;
  const id = useId();
  const popId = `${id}-pop`;
  const titleId = `${id}-title`;
  const chipRef = useRef(null);
  const popRef = useRef(null);
  const wrapRef = useRef(null);
  const [alignLeft, setAlignLeft] = useState(false);

  // Before paint, and on resize while open: right-align under the chip unless
  // that would push the popover past the left edge of the page.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = chipRef.current?.getBoundingClientRect();
      if (r) setAlignLeft(r.right - POP_W < GUTTER);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const close = useCallback((refocus) => {
    setOpenFor(null);
    if (refocus) chipRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    popRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(true);
    };
    const away = (e) => {
      if (!wrapRef.current?.contains(e.target)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", away);
    };
  }, [open, close]);

  const { chip, sources } = status;
  return (
    <div ref={wrapRef} className="relative flex flex-col max-md:col-span-2">
      <button
        ref={chipRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpenFor(open ? null : wallet)}
        className={`inline-flex h-11 w-full items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-[13px] font-medium transition-colors md:h-8 md:w-auto md:rounded-full md:text-xs ${
          open
            ? "border-wd-accent-line bg-accent-surface text-accent-text"
            : "border-wd-control bg-surface-raised text-wd-ink-2 hover:border-wd-ink-2"
        }`}
      >
        {chip.tone === "ok" ? (
          <span aria-hidden="true" className="wd-st wd-st-ok" />
        ) : (
          <span aria-hidden="true" className={`wd-live ${chip.tone === "live" ? (chip.dotClass ?? "") : CHIP_DOT[chip.tone]}`} />
        )}
        <span className="sr-only">Data status: </span>
        <span className="min-w-0 truncate">
          <Checked word={chip.label} at={chip.checkedAt} />
        </span>
        <span
          aria-hidden="true"
          className="ml-auto h-1.5 w-1.5 shrink-0 -translate-y-0.5 rotate-45 border-b-[1.5px] border-r-[1.5px] border-current md:ml-0.5"
        />
      </button>
      {open && (
        <div
          ref={popRef}
          id={popId}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`z-10 mt-2 rounded-xl bg-surface-raised px-3.5 pb-3 pt-2.5 shadow-soft-lg outline-none md:absolute md:top-full md:w-[440px] md:max-w-[calc(100vw-32px)] md:px-4 md:pb-3.5 md:pt-3 ${
            alignLeft ? "md:left-0" : "md:right-0"
          }`}
        >
          <div className="mb-0.5 flex items-center justify-between gap-3">
            <h2 id={titleId} className="m-0 font-display text-wd-title font-semibold text-wd-ink">
              Data status
            </h2>
            <button
              type="button"
              aria-label="Close data status"
              onClick={() => close(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-wd-ink-2 hover:bg-wd-well md:h-8 md:w-8"
            >
              <XMarkIcon aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          <ul className="m-0 list-none p-0">
            {sources.map((s) => (
              <li
                key={s.key}
                className="grid grid-cols-[12px_minmax(0,1fr)] items-start gap-x-2.5 border-t border-wd-line-2 py-[9px] first:border-t-0 md:grid-cols-[12px_minmax(0,1fr)_auto]"
              >
                <span className="flex h-5 items-center justify-center">
                  <SourceMark kind={s.kind} dotClass={s.dotClass} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-semibold leading-5 text-wd-ink">{s.name}</span>
                  <span className="text-wd-cap text-wd-ink-2">{s.anchor}</span>
                </span>
                <span
                  className={`col-start-2 text-left text-xs leading-5 md:col-start-auto md:whitespace-nowrap md:text-right ${
                    s.kind === "error" ? "font-semibold text-wd-critical-text" : "text-wd-ink"
                  }`}
                >
                  <Checked word={s.state} at={s.checkedAt} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mb-0 mt-2 text-wd-cap text-wd-ink-3">Times are in your time zone. Data days are UTC.</p>
        </div>
      )}
    </div>
  );
});
