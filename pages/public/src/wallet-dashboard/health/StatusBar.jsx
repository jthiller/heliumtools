import { fmtCount } from "../format.js";
import { StatusMark } from "../ui/index.js";

// Segment fills by tier: status colors for Serious and Check, quiet inks for
// OK and setting up, the hatch for Unknown (never color alone: the legend
// carries each tier's mark and count).
const SEG = {
  serious: "bg-wd-critical",
  check: "bg-wd-caution",
  ok: "bg-wd-ink-4",
  info: "bg-wd-ink-3",
  unknown: "wd-hatch",
  checking: "border border-dashed border-wd-ink-4",
};

/**
 * A module's Hotspots by status tier: a 10 px bar split by count (decorative)
 * and its legend, one item per tier with its mark, word and count ("Check 5"),
 * plus the share from 200 Hotspots up. `pending` draws the dashed placeholder
 * bar while the module loads. `bar` is a view model's `bar`
 * (iotModule.js `tierBar`).
 */
export default function StatusBar({ bar, pending = false }) {
  if (pending) {
    return <span aria-hidden="true" className="block h-2.5 rounded-full border-[1.5px] border-dashed border-wd-ink-4" />;
  }
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-wd-well">
        {bar.segs.map((s) => (
          <i key={s.tier} className={`block min-w-1 basis-0 ${SEG[s.tier]}`} style={{ flexGrow: s.n }} />
        ))}
      </div>
      {bar.legend.length > 0 && (
        <ul aria-label={bar.aria} className="m-0 flex list-none flex-wrap gap-x-[18px] gap-y-1.5 p-0">
          {bar.legend.map((l) => (
            <li key={l.tier} className="flex items-center gap-1.5 text-wd-cap text-wd-ink-2">
              <StatusMark tier={l.tier} sr={false} />
              <span>{l.label}</span>
              <span className="sr-only">: </span>
              <b className="font-display text-[13px] font-semibold leading-4 tabular-nums text-wd-ink">{fmtCount(l.n)}</b>
              {l.pct && <span className="text-wd-cap tabular-nums text-wd-ink-2">{l.pct}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
