import { useEffect, useRef } from "react";
import { fmtCount, plural } from "../format.js";
import { Btn, Btn2, IconBtn } from "../ui/Controls.jsx";
import { NetDot } from "../ui/NetDot.jsx";
import { StatusMark } from "../ui/StatusMark.jsx";

function Fieldset({ legend, name, options, value, onChange }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 border-t border-solid border-wd-line-2 px-4 pb-2 pt-2.5">
      <legend className="float-left mb-1 w-full p-0 font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.12em] text-wd-ink-3">
        {legend}
      </legend>
      {options.map((o) => (
        <label key={o.value} className="clear-both flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-wd-ink">
          <input
            type="radio"
            name={name}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
            className="h-[18px] w-[18px] shrink-0 cursor-pointer border-wd-control bg-surface-raised text-accent focus:ring-0 focus:ring-offset-0"
          />
          {o.tier && <StatusMark tier={o.tier} sr={false} />}
          {o.net && <NetDot net={o.net} />}
          <span className="min-w-0 flex-1">{o.label}</span>
          {o.count != null && <b className="font-medium tabular-nums text-wd-ink-2">{fmtCount(o.count)}</b>}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The phone filter sheet (JUDGE 10, P1): a bottom-sheet modal `<dialog>`
 * named "Filter Hotspots", at most 85% of the viewport tall, with native
 * radio fieldsets (Status with tier marks and counts; Network only when both
 * networks exist; Device with two or more types). A choice applies at once;
 * the sticky footer has "Clear all" and "Show {n} Hotspots" (closes). Escape,
 * the close button or a tap on the scrim close it; the list returns focus to
 * the Filter button. Rendered only while open.
 *
 * `status`, `net`, `device`: { options: [{ value, label, count, tier?, net? }],
 * value, onChange } (net / device null when hidden).
 */
export default function FilterSheet({ status, net, device, count, onClearAll, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="wd-sheet"
      aria-labelledby="hs-sheet-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // the scrim
      }}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between pb-1.5 pl-4 pr-2 pt-2.5">
          <h3 id="hs-sheet-title" className="m-0 font-display text-wd-title font-semibold text-wd-ink">
            Filter Hotspots
          </h3>
          <IconBtn aria-label="Close" onClick={onClose} className="text-[22px] leading-none">
            ×
          </IconBtn>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <Fieldset legend="Status" name="hs-f-status" {...status} />
          {net && <Fieldset legend="Network" name="hs-f-net" {...net} />}
          {device && <Fieldset legend="Device" name="hs-f-device" {...device} />}
        </div>
        <div className="flex gap-2 border-t border-wd-line bg-surface-raised px-4 pb-4 pt-3">
          <Btn2 onClick={onClearAll} className="text-sm">
            Clear all
          </Btn2>
          <Btn onClick={onClose} className="flex-1 text-sm">
            Show {plural(count, "Hotspot")}
          </Btn>
        </div>
      </div>
    </dialog>
  );
}
