import { useEffect, useRef, useState } from "react";
import { CheckIcon, Square2StackIcon } from "@heroicons/react/24/outline";

const FAILED = "Couldn't copy. Select the text and copy it.";
const COPIED_MS = 2000;
const FAILED_MS = 4000;

/**
 * Copies `text` (a string, or a function read at click time, e.g.
 * `() => location.href`). Icon-only by default (32 px, 44 on phones; `label`
 * is its accessible name, "Copy wallet address"); with `children` it is a
 * secondary button whose text reads "Copied" for a moment. Success shows a
 * check and announces `copiedText` politely; a failed clipboard write (denied,
 * or no clipboard in this context) shows and announces "Couldn't copy. Select
 * the text and copy it." for 4 s instead of failing silently.
 */
export function CopyIconButton({ text, label, copiedText = "Copied", children, className = "" }) {
  const [state, setState] = useState("idle"); // idle | copied | failed
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next, ms) => {
    clearTimeout(timer.current);
    setState(next);
    timer.current = setTimeout(() => setState("idle"), ms);
  };
  const copy = async (e) => {
    e.stopPropagation(); // inside a clickable row, copying never opens the row
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      settle("copied", COPIED_MS);
    } catch {
      settle("failed", FAILED_MS);
    }
  };

  const Icon = state === "copied" ? CheckIcon : Square2StackIcon;
  const button = children ? (
    <button
      type="button"
      aria-label={label}
      onClick={copy}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-wd-control bg-surface-raised px-3 text-xs font-medium text-wd-ink transition hover:bg-wd-well md:min-h-8 ${className}`}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-wd-ink-2" />
      {state === "copied" ? "Copied" : children}
    </button>
  ) : (
    <button
      type="button"
      aria-label={label}
      onClick={copy}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-wd-ink-2 transition hover:bg-wd-well hover:text-wd-ink md:h-8 md:w-8 ${className}`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );

  return (
    <>
      {button}
      {/* Always mounted, so the message is announced when it appears. */}
      <span role="status" className={state === "failed" ? "text-wd-cap text-wd-ink-2" : "sr-only"}>
        {state === "copied" ? copiedText : state === "failed" ? FAILED : ""}
      </span>
    </>
  );
}

export default CopyIconButton;
