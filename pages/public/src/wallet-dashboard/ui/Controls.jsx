import { forwardRef, useId, useRef } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { fmtCount } from "../format.js";
import { NetDot } from "./NetDot.jsx";

// Phones get 44 px targets; from md up the design's 36 / 32 px.
const BTN =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-white transition hover:bg-accent/90 hover:no-underline disabled:cursor-not-allowed disabled:opacity-55 md:min-h-9";
const BTN2 =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-wd-control bg-surface-raised px-3 text-xs font-medium text-wd-ink transition hover:bg-wd-well hover:no-underline disabled:cursor-not-allowed disabled:opacity-55 md:min-h-8";
const ICON_BTN =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-wd-ink-2 transition hover:bg-wd-well hover:text-wd-ink disabled:cursor-default disabled:text-wd-ink-4 disabled:hover:bg-transparent md:h-8 md:w-8";

// A button, or a link styled as one when `href` is given (internal links
// stay in the tab; external ones go through ExtLink).
const Action = forwardRef(function Action({ base, href, className = "", type = "button", ...rest }, ref) {
  const cls = `${base} ${className}`;
  if (href != null) return <a ref={ref} href={href} className={cls} {...rest} />;
  return <button ref={ref} type={type} className={cls} {...rest} />;
});

/** Primary action (accent fill, white text): "Claim rewards". `href` renders a link. */
export const Btn = forwardRef(function Btn(props, ref) {
  return <Action ref={ref} base={BTN} {...props} />;
});

/** Secondary action (3:1 control border on the card color): Retry, Copy names, Download CSV. `href` renders a link. */
export const Btn2 = forwardRef(function Btn2(props, ref) {
  return <Action ref={ref} base={BTN2} {...props} />;
});

/** Icon-only button; give it an `aria-label`. 32 px, 44 px on phones. */
export const IconBtn = forwardRef(function IconBtn({ className = "", type = "button", ...rest }, ref) {
  return <button ref={ref} type={type} className={`${ICON_BTN} ${className}`} {...rest} />;
});

/**
 * Segmented control as an ARIA radio group: one tab stop (the checked
 * option), Left/Right/Up/Down move and select, Home/End jump to the ends.
 * `options` are `{ value, label, count?, net?, disabled? }` (a number count
 * gets thousands separators); `onChange(value)`. `label` names the group.
 * 30 px segments, 44 px on phones.
 */
export function Seg({ label, options, value, onChange, className = "" }) {
  const refs = useRef([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const current = options.findIndex((o) => o.value === value);
  // The tab stop: the checked option, else the first enabled one.
  const stop = current >= 0 && !options[current].disabled ? current : enabled[0];

  const pick = (i) => {
    refs.current[i]?.focus();
    if (options[i].value !== value) onChange(options[i].value);
  };
  const onKeyDown = (e) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(stop);
    let next;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(at + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    else return;
    e.preventDefault();
    pick(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`inline-flex shrink-0 gap-0.5 rounded-[9px] bg-wd-well p-[3px] ${className}`}
    >
      {options.map((o, i) => {
        const on = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === stop ? 0 : -1}
            disabled={o.disabled}
            onClick={() => pick(i)}
            className={`inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-xs font-medium transition md:h-[30px] ${
              on
                ? "bg-surface-raised text-wd-ink ring-1 ring-wd-control"
                : "text-wd-ink-2 hover:text-wd-ink disabled:cursor-not-allowed disabled:opacity-55"
            }`}
          >
            {o.net && <NetDot net={o.net} />}
            {o.label}
            {o.count != null && (
              <b className="font-normal tabular-nums text-wd-ink-2">{typeof o.count === "number" ? fmtCount(o.count) : o.count}</b>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Native select with a label (visible, or `hideLabel` for screen readers
 * only) and the design's chevron. `options` are `{ value, label }`;
 * `onChange(value)`. 36 px, 44 px on phones.
 */
export function Select({ label, options, value, onChange, hideLabel = false, id, className = "", selectClassName = "" }) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 text-wd-sm text-wd-ink-2 ${className}`}>
      <label htmlFor={selectId} className={hideLabel ? "sr-only" : "shrink-0"}>
        {label}
      </label>
      <span className="relative inline-flex min-w-0 flex-1">
        <select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-11 w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-wd-control bg-surface-raised py-0 pl-3 pr-8 text-base font-medium text-wd-ink md:text-wd-sm focus:border-wd-control focus:ring-0 md:h-9 ${selectClassName}`}
          style={{ backgroundImage: "none" }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[13px] top-1/2 -mt-[5px] h-1.5 w-1.5 rotate-45 border-b-[1.5px] border-r-[1.5px] border-wd-ink-2"
        />
      </span>
    </span>
  );
}

/**
 * Search input with a visually hidden label and a magnifier. `onChange(text)`
 * on every keystroke (debounce in the caller). 36 px, 44 px on phones.
 */
export const SearchField = forwardRef(function SearchField(
  { label, value, onChange, placeholder, id, className = "", ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div
      className={`flex h-11 min-w-0 items-center gap-2 rounded-lg border border-wd-control bg-surface-raised px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-text md:h-9 ${className}`}
    >
      <MagnifyingGlassIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-wd-ink-3" />
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-full w-full min-w-0 self-stretch border-0 bg-transparent p-0 text-base text-wd-ink placeholder:text-wd-ink-3 !outline-none focus:ring-0 md:text-[13px]"
        {...rest}
      />
    </div>
  );
});
