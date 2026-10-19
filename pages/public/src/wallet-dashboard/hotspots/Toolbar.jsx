import { forwardRef } from "react";
import { plural } from "../format.js";
import { Chip } from "../ui/Chip.jsx";
import { Btn2, SearchField, Seg, Select } from "../ui/Controls.jsx";
import { RemoveChip } from "./StatusChips.jsx";

const SEARCH_LABEL = "Search Hotspots";
const SEARCH_PLACEHOLDER = "Name, city or entity key";
const EXPORT_WHY_ID = "hs-export-why";

/** Copy entity keys, Copy names, Download CSV: the current filter in the
 * order shown. Disabled, with the reason said, while the list loads or is empty. */
export function ExportButtons({ exports }) {
  const { disabled, why, onKeys, onNames, onCsv } = exports;
  const describe = disabled && why ? EXPORT_WHY_ID : undefined;
  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
      <Btn2 disabled={disabled} aria-describedby={describe} onClick={onKeys} className="text-sm">
        Copy entity keys
      </Btn2>
      <Btn2 disabled={disabled} aria-describedby={describe} onClick={onNames} className="text-sm">
        Copy names
      </Btn2>
      <Btn2 disabled={disabled} aria-describedby={describe} onClick={onCsv} className="text-sm">
        Download CSV
      </Btn2>
      {disabled && why && (
        <span id={EXPORT_WHY_ID} className="text-wd-cap text-wd-ink-2">
          {why}
        </span>
      )}
    </div>
  );
}

/**
 * The list's toolbar on desktop and tablet (JUDGE 7): search (name, entity
 * key, asset ID, city, state), the Network segmented control (only when the
 * wallet has both networks), the Device select (two or more device types),
 * the Sort select (kept in sync with the header buttons) and the exports.
 * Every control is optional: the default is the whole list.
 */
export default function Toolbar({ q, onQ, net, device, sort, exports }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <SearchField
        label={SEARCH_LABEL}
        placeholder={SEARCH_PLACEHOLDER}
        value={q}
        onChange={onQ}
        className="min-w-[200px] flex-[1_1_220px] lg:max-w-[300px]"
      />
      {net && <Seg label="Network" options={net.options} value={net.value} onChange={net.onChange} />}
      {device && (
        <Select label="Device" hideLabel options={device.options} value={device.value} onChange={device.onChange} />
      )}
      <Select label="Sort" options={sort.options} value={sort.value} onChange={sort.onChange} />
      <ExportButtons exports={exports} />
    </div>
  );
}

/**
 * The phone toolbar (JUDGE 10): search; the Sort select beside the Filter
 * button ("Filter, 1 on" while filters apply; it opens the filter sheet);
 * the "Needs a look" toggle chip, the applied filters as removable chips,
 * "Clear all", and the dashed placeholders while sources are checked.
 */
export const PhoneToolbar = forwardRef(function PhoneToolbar(
  { q, onQ, sort, activeCount, sheetOpen, onOpenSheet, needs, active, onClearAll, pending },
  filterRef,
) {
  return (
    <div className="flex flex-col gap-2.5">
      <SearchField label={SEARCH_LABEL} placeholder={SEARCH_PLACEHOLDER} value={q} onChange={onQ} />
      <div className="flex gap-2">
        <Select
          label="Sort"
          hideLabel
          options={sort.options}
          value={sort.value}
          onChange={sort.onChange}
          className="min-w-0 flex-1"
        />
        <button
          ref={filterRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={onOpenSheet}
          className={`h-11 shrink-0 rounded-lg border px-4 text-sm font-medium ${
            activeCount ? "border-wd-accent-line bg-accent-surface text-accent-text" : "border-wd-control bg-surface-raised text-wd-ink"
          }`}
        >
          {activeCount ? `Filter, ${activeCount} on` : "Filter"}
        </button>
      </div>
      {(needs || active.length > 0 || pending.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {needs && (
            <Chip
              on={needs.on}
              tier="check"
              count={needs.count}
              ariaLabel={`Needs a look, ${plural(needs.count, "Hotspot")}`}
              onClick={needs.onToggle}
              className="max-md:h-8 max-md:text-[13px]"
            >
              Needs a look
            </Chip>
          )}
          {active.map((a) => (
            <RemoveChip key={a.key} label={a.label} onRemove={a.onRemove} />
          ))}
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="relative h-8 px-1.5 text-[13px] font-semibold text-accent-text before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:underline"
            >
              Clear all
            </button>
          )}
          {pending.map((p) => (
            <Chip key={p} pending className="max-md:h-8">
              {p}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
});
