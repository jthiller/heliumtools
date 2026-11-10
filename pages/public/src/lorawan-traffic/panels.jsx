// The LoRaWAN Traffic Map's panels: filters, the operator picker, the notes, and
// the list of Hotspots at a clicked spot. Presentational: state lives in
// LorawanTrafficMap.jsx.
import { useEffect, useState } from "react";
import animalHash from "angry-purple-tiger";
import { ArrowTopRightOnSquareIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import CopyButton from "../components/CopyButton.jsx";
import Tooltip from "../components/Tooltip.jsx";
import { numberFormatter, truncateString } from "../lib/utils.js";
import { WELL_KNOWN_REPO_URL } from "../lib/wellKnownOuis.js";
import { SLIDER_MAX, WINDOWS, fmtDay, fmtWindow, ouiLabel, rangeLabel, sliderToThreshold, thresholdToSlider } from "./data.js";

const fmt = (n) => numberFormatter.format(n);
const EXPLORER_BASE = "https://world.helium.com/en/network/iot/hotspot/";
/** What an OUI is, in one breath: the page leads with "operator" and keeps the number. */
const OUI_HELP =
  "An OUI is the ID a LoRaWAN network operator registers on Helium. Packets from its devices are routed to it, and it pays for them in Data Credits.";
const HELP_TRIGGER = "cursor-help text-[10px] text-content-tertiary underline decoration-dotted underline-offset-2 hover:text-content-secondary";
/** Hotspots listed for one clicked spot; the rest are counted. */
const LOCATION_ROW_LIMIT = 60;

const INPUT_CLASS =
  "block w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
const SMALL_BUTTON =
  "rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-content-secondary transition hover:bg-surface-inset hover:text-content";

export function Spinner({ className = "h-4 w-4" }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function SectionLabel({ children, id }) {
  return (
    <h2 id={id} className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-content-tertiary">
      {children}
    </h2>
  );
}

// ---- time range ----

export function WindowPicker({ index, win, onChange }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel id="lt-window">Time range</SectionLabel>
        <span className="text-[10px] text-content-tertiary">Data through {fmtDay(index.dataThrough, { year: true })}</span>
      </div>
      <div role="radiogroup" aria-labelledby="lt-window" className="grid grid-cols-3 overflow-hidden rounded-lg border border-border">
        {WINDOWS.map((w, i) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={w === win}
            onClick={() => onChange(w)}
            className={`px-1 py-1.5 text-center transition ${i > 0 ? "border-l border-border" : ""} ${
              w === win ? "bg-accent-surface" : "hover:bg-surface-inset"
            }`}
          >
            <span className={`block text-sm ${w === win ? "font-semibold text-accent-text" : "text-content"}`}>{w}</span>
            <span className="block text-[10.5px] leading-tight text-content-tertiary">{fmtWindow(index.windows[w])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- packet range ----

/** A whole-number field that commits on blur or Enter, so typing isn't clamped mid-number. */
function BoundField({ label, value, max, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.floor(Number(draft));
    if (Number.isFinite(n) && n >= 1) onCommit(n);
    else setDraft(String(value));
  };
  return (
    <label className="flex flex-1 items-center gap-1.5 text-xs text-content-secondary">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={`${INPUT_CLASS} min-w-0 font-mono text-xs tabular-nums`}
      />
    </label>
  );
}

/**
 * The packet range: a two-handle log-scale slider plus exact bounds. `range`
 * is { lo, hi, open } already clamped to `max`; `open` means the upper handle
 * sits at the end of the track (no upper bound).
 */
export function PacketRange({ range, max, win, onChange }) {
  const loPos = thresholdToSlider(range.lo, max);
  const hiPos = range.open ? SLIDER_MAX : thresholdToSlider(range.hi, max);

  const setLo = (lo) => {
    const hi = Math.max(range.hi, lo);
    onChange({ lo, hi, open: range.open || hi >= max });
  };
  const setHi = (hi, open) => onChange({ lo: Math.min(range.lo, hi), hi, open });

  return (
    <div>
      <SectionLabel>Packets delivered per Hotspot</SectionLabel>
      <div className="lt-range">
        <div className="lt-range-track" />
        <div className="lt-range-fill" style={{ left: `${(loPos / SLIDER_MAX) * 100}%`, right: `${100 - (hiPos / SLIDER_MAX) * 100}%` }} />
        <input
          type="range"
          min={0}
          max={SLIDER_MAX}
          value={loPos}
          aria-label="Minimum packets"
          aria-valuetext={fmt(range.lo)}
          // Both handles at the far end: keep the lower one on top so it can be dragged back.
          style={{ zIndex: loPos > SLIDER_MAX * 0.9 ? 2 : 1 }}
          onChange={(e) => setLo(sliderToThreshold(Number(e.target.value), max))}
        />
        <input
          type="range"
          min={0}
          max={SLIDER_MAX}
          value={hiPos}
          aria-label="Maximum packets"
          aria-valuetext={range.open ? "no upper limit" : fmt(range.hi)}
          style={{ zIndex: 1 }}
          onChange={(e) => {
            const pos = Number(e.target.value);
            setHi(sliderToThreshold(pos, max), pos >= SLIDER_MAX);
          }}
        />
      </div>
      <div className="mt-0.5 flex gap-2.5">
        <BoundField label="min" value={range.lo} max={max} onCommit={(n) => setLo(Math.min(n, max))} />
        <BoundField
          label="max"
          value={range.hi}
          max={max}
          onCommit={(n) => {
            const hi = Math.min(Math.max(n, range.lo), max);
            setHi(hi, hi >= max);
          }}
        />
      </div>
      <p className="mt-1.5 text-xs leading-snug text-content-secondary">
        Showing Hotspots that delivered {rangeLabel(range)} to an operator in {win}. The busiest delivered {fmt(max)}.
      </p>
    </div>
  );
}

// ---- totals ----

function Stat({ value, label, sub }) {
  return (
    <div className="rounded-lg bg-surface-inset px-3 py-2">
      <p className="font-mono text-lg font-semibold tabular-nums leading-tight text-content">{value}</p>
      <p className="mt-0.5 text-xs text-content-secondary">{label}</p>
      <p className="text-[11px] text-content-tertiary">{sub}</p>
    </div>
  );
}

/** What the map shows now, beside the network-wide totals for the window. */
export function ShownStats({ shown, index, win, loading }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Stat
        value={loading ? "…" : fmt(shown.unique)}
        label="Hotspots shown"
        sub={`of ${fmt(index.totals.hotspots[win])} network-wide`}
      />
      <Stat
        value={loading ? "…" : fmt(shown.packets)}
        label="Packets they delivered"
        sub={`of ${fmt(index.totals.packets[win])} network-wide`}
      />
    </div>
  );
}

// ---- operators ----

/** A color dot for an operator. */
function Swatch({ color, className = "h-3 w-3" }) {
  return <span className={`${className} shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15`} style={{ background: color }} />;
}

/**
 * An operator by name, with its OUI number after it; by OUI number alone when
 * Helium's well-known list has no name for it. The number is never dropped:
 * two OUIs can share a name.
 */
function OperatorName({ row, oui, className = "" }) {
  if (!row?.name) return <span className={className}>OUI {row?.oui ?? oui}</span>;
  return (
    <span className={className}>
      {row.name} <span className="font-normal text-content-tertiary">OUI {row.oui}</span>
    </span>
  );
}

function OperatorRow({ row, counts, win, checked, onToggle }) {
  const total = row.hotspots[win];
  const quiet = total === 0;
  return (
    <label
      className={`flex cursor-pointer items-center gap-2.5 border-b border-border-muted px-3 py-1.5 transition last:border-b-0 hover:bg-surface-inset ${
        quiet ? "opacity-50" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(row.oui, e.target.checked)}
        aria-label={ouiLabel(row)}
        className="h-4 w-4 shrink-0 rounded border-border text-accent focus:ring-accent/30"
      />
      <Swatch color={row.color} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px] font-semibold text-content" title={row.name ?? undefined}>
          {row.name ?? `OUI ${row.oui}`}
        </span>
        {row.name && <span className="block text-[11.5px] text-content-secondary">OUI {row.oui}</span>}
      </span>
      <span className="shrink-0 text-right tabular-nums leading-tight">
        <span className="block text-xs font-medium text-content">
          {quiet ? "0" : `${counts?.loaded ? fmt(counts.pass) : "…"} / ${fmt(total)}`}
        </span>
        <span className="block text-[10.5px] text-content-tertiary">
          {quiet ? `no traffic in ${win}` : counts?.loaded ? `${fmt(counts.passPackets)} packets` : "loading"}
        </span>
      </span>
    </label>
  );
}

/**
 * The operator layers: search, one row per operator (busiest first) with a
 * switch, and the bulk actions. Each row's count is "located Hotspots in the
 * packet range / every Hotspot that delivered for the operator in the window".
 * `listClassName` sizes the list's box: a floor plus `flex-1` where the panel
 * fills a card, a fixed height where it sits in a scrolling sheet.
 */
export function OperatorPicker({ traffic, shown, enabled, win, onToggle, onSetMany, onFit, listClassName = "" }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = q ? traffic.rows.filter((r) => r.search.includes(q)) : traffic.rows;
  const loading = traffic.status === "layers";

  return (
    <div className="flex flex-1 flex-col">
      <div className="px-4 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <SectionLabel>Operators</SectionLabel>
          <span className="flex items-baseline gap-3">
            <Tooltip content={OUI_HELP}>
              <button type="button" aria-label={`What's an OUI? ${OUI_HELP}`} className={HELP_TRIGGER}>
                What's an OUI?
              </button>
            </Tooltip>
            <Tooltip content={"Located Hotspots in the packet range,\nout of all that delivered for the operator in the time range.\nThe gap at full range is Hotspots with no asserted location."}>
              <button type="button" className={HELP_TRIGGER}>
                shown / all
              </button>
            </Tooltip>
          </span>
        </div>
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search operator name or OUI number"
            autoComplete="off"
            aria-label="Search operators"
            className={`${INPUT_CLASS} pl-8 text-xs`}
          />
        </div>
        {loading && (
          <div className="mt-2" role="status">
            <div className="h-1 overflow-hidden rounded-full bg-surface-inset">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${traffic.total ? (traffic.loaded / traffic.total) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-content-tertiary">
              Loading operators, {fmt(traffic.loaded)} of {fmt(traffic.total)}
            </p>
          </div>
        )}
      </div>

      {/* The scroller is out of flow, so the rows never add to this panel's own
          height: the box around it has a floor (listClassName) and takes what is
          left. The panel's minimum is then its header, that floor and its footer,
          and a card holding it can grow by exactly what "About this data" adds
          rather than squeezing the list to nothing under the buttons. */}
      <div className={`relative mt-2 border-y border-border-muted ${listClassName}`}>
        <div className="absolute inset-0 overflow-y-auto">
          {rows.map((row) => (
            <OperatorRow key={row.oui} row={row} counts={shown.perOui.get(row.oui)} win={win} checked={enabled.has(row.oui)} onToggle={onToggle} />
          ))}
          {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-content-tertiary">No operator matches “{query.trim()}”.</p>}
        </div>
      </div>

      <div className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={SMALL_BUTTON} onClick={() => onSetMany(() => true)}>All</button>
          <button type="button" className={SMALL_BUTTON} onClick={() => onSetMany((row) => row.rank < 10)}>Top 10</button>
          <button type="button" className={SMALL_BUTTON} onClick={() => onSetMany(() => false)}>None</button>
          <button type="button" className={`${SMALL_BUTTON} ml-auto`} onClick={onFit}>Fit map</button>
        </div>
        <p className="mt-1.5 text-[11px] text-content-tertiary">
          Showing {fmt(enabled.size)} of {fmt(traffic.rows.length)} operators
        </p>
        {traffic.failed.length > 0 && (
          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-300">
            Could not load {traffic.failed.join(", ")}. {traffic.failed.length === 1 ? "Its" : "Their"} Hotspots are missing from the
            map.{" "}
            <button type="button" onClick={traffic.reload} className="font-semibold underline">
              Reload
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- notes ----

const WellKnownLink = ({ children }) => (
  <a href={WELL_KNOWN_REPO_URL} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

export function AboutData({ index, namesLoaded }) {
  return (
    <details className="group px-4 pb-3 text-xs text-content-secondary">
      <summary className="cursor-pointer select-none text-[11px] font-medium text-content-tertiary hover:text-content-secondary">
        About this data
      </summary>
      <ul className="mt-2 max-h-48 list-disc space-y-1.5 overflow-y-auto pl-4 leading-snug">
        <li>{OUI_HELP}</li>
        <li>
          {namesLoaded ? (
            <>
              Operator names come from Helium's <WellKnownLink>well-known list</WellKnownLink>. An operator that isn't on it shows by
              OUI number only. Operators add their name with a pull request there.
            </>
          ) : (
            <>
              Helium's <WellKnownLink>well-known list</WellKnownLink> of operator names didn't load, so every operator shows by OUI
              number only. Reload to try again.
            </>
          )}
        </li>
        <li>
          Counts are uplinks delivered to each operator per Hotspot, as reported by the Helium Packet Router. Join requests and
          copies dropped by multi-buy are not counted.
        </li>
        <li>Time ranges are full UTC calendar days ending {fmtDay(index.dataThrough, { year: true })}, the latest day in the data.</li>
        <li>
          Source: the Helium IoT utilization API (api-iot.heliumtools.org), rebuilt once a day after the previous UTC day
          completes.
        </li>
        <li>
          Dots sit at each Hotspot's on-chain asserted location. A Hotspot without one is counted in the totals but has no dot.
        </li>
        <li>
          Hotspot names are derived from each public key with the standard Helium name hash, so they match World Explorer.
        </li>
        <li>Several Hotspots can share one coordinate. Clicking a spot lists every Hotspot there.</li>
        {index.missingDays.length > 0 && (
          <li>
            Days missing from the 30-day range (totals are lower bounds): {index.missingDays.map((d) => fmtDay(d)).join(", ")}.
          </li>
        )}
      </ul>
    </details>
  );
}

// ---- a clicked spot ----

export function locationTitle(group) {
  const n = group.rows.length;
  if (n === 1) return "1 Hotspot here";
  return group.sameSpot ? `${fmt(n)} Hotspots at this location` : `${fmt(n)} Hotspots near this point`;
}

function LocationRow({ row, rowsByOui }) {
  const name = animalHash(row.address);
  return (
    <div className="border-t border-border-muted px-4 py-2.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-content">{name}</p>
        <a
          href={`${EXPLORER_BASE}${encodeURIComponent(row.address)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[11px]"
        >
          World Explorer
          <ArrowTopRightOnSquareIcon className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <code className="font-mono text-[11px] text-content-tertiary" title={row.address}>
          {truncateString(row.address, 10, 6)}
        </code>
        <CopyButton text={row.address} size="h-3.5 w-3.5" label="Copy Hotspot key" />
        <a href={`/hotspot-map?keys=${encodeURIComponent(row.address)}`} className="ml-auto text-[11px]">
          On-chain details
        </a>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {row.per.map(({ oui, packets }) => {
          const meta = rowsByOui.get(oui);
          return (
            <span key={oui} className="inline-flex min-w-0 items-center gap-1.5">
              <Swatch color={meta?.color ?? "#888"} className="h-2.5 w-2.5" />
              <OperatorName row={meta} oui={oui} className="text-content-secondary" />
              <span className="font-mono tabular-nums text-content">{fmt(packets)}</span>
            </span>
          );
        })}
        {row.per.length > 1 && (
          <span className="text-content-tertiary">
            total <span className="font-mono tabular-nums">{fmt(row.total)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** The Hotspots at a clicked spot, busiest first, each with its packets per operator. */
export function LocationRows({ group, rowsByOui }) {
  const more = group.rows.length - LOCATION_ROW_LIMIT;
  return (
    <>
      {group.rows.slice(0, LOCATION_ROW_LIMIT).map((row) => (
        <LocationRow key={row.address} row={row} rowsByOui={rowsByOui} />
      ))}
      {more > 0 && <p className="border-t border-border-muted px-4 py-2.5 text-xs text-content-tertiary">and {fmt(more)} more</p>}
    </>
  );
}

export function LocationCard({ group, rowsByOui, win, onClose }) {
  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-xl bg-surface-raised shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-border-muted px-4 py-2.5">
        <div>
          <p className="text-sm font-semibold text-content">{locationTitle(group)}</p>
          <p className="text-[11px] text-content-tertiary">Packets delivered per operator, {win}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-content-tertiary transition hover:bg-surface-inset hover:text-content"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LocationRows group={group} rowsByOui={rowsByOui} />
      </div>
    </div>
  );
}

// ---- hover ----

export function MapTooltip({ hover, win, tooltipRef, initialPos }) {
  const { row, point, packets } = hover;
  return (
    <div
      ref={tooltipRef}
      className="lt-tooltip pointer-events-none absolute z-20 rounded-lg bg-surface-raised px-3 py-2 shadow-soft-lg"
      style={{ left: initialPos.x + 12, top: initialPos.y - 12 }}
    >
      <p className="text-sm font-medium text-content">{animalHash(point.address)}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-content-secondary">
        <Swatch color={row.color} className="h-2.5 w-2.5" />
        <OperatorName row={row} />
      </p>
      <p className="mt-0.5 font-mono text-xs tabular-nums text-content">
        {fmt(packets)} <span className="font-sans text-content-tertiary">packets, {win}</span>
      </p>
    </div>
  );
}
