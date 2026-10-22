import { useLayoutEffect, useRef } from "react";
import { IOT_MESSAGES_NOTE, ONBOARDED_NOTE, fmtDataDay } from "../format.js";
import { UNCLAIMED_NOTE, noDailyNote } from "../copy.js";
import { InfoTip } from "../ui/InfoTip.jsx";
import HotspotRow, { COL, CellSub, CellValue, SkeletonRow, TD } from "./HotspotRow.jsx";

export const BAND_NOTE = noDailyNote("IoT Hotspots");
export const LIFETIME_NOTE = "All HNT this Hotspot has earned. Legacy IOT and MOBILE amounts are in its details.";

const TH =
  "border-y border-wd-line bg-surface-raised px-3 py-2.5 text-left align-bottom font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-wd-ink-3 max-lg:px-2.5";
// The row's ends sit 24 px in; the second header row (under the band) is
// inside the row, so its cells keep the 12 px padding.
const TH_EDGE = "first:pl-6 last:pr-6 max-lg:first:pl-6 max-lg:last:pr-6";
// From 1024 px the table lays out fixed from its <colgroup>: a long list
// ("Show all" on 2,000 rows) then never re-measures every row to size the
// columns. Hotspot takes what's left; below 1024 px the columns size to their
// content (auto layout) so the table fits a 768 px window.
// Each width holds the column's longest word inside its padding: "Couldn't
// confirm" (Unclaimed), "Couldn't load" (the day), and "Never rewarded" or
// "0 · legacy only" in Lifetime. Below 1280 px Onboarded is hidden, so
// Lifetime is the row's last cell with the 24 px end padding: 136 px.
const COLS = {
  name: "",
  status: "lg:w-[212px] xl:w-[264px]",
  unc: "lg:w-32",
  day: "lg:w-[108px] xl:w-[116px]",
  week: "lg:w-[148px] xl:w-[164px]",
  life: "lg:w-[136px] xl:w-28",
  onb: "lg:w-[120px]",
  msg: "lg:w-[132px] xl:w-[150px]",
};

const FOOT = "border-t border-wd-line bg-wd-well px-3 py-3.5 align-top first:rounded-bl-2xl first:pl-6 last:rounded-br-2xl last:pr-6 max-lg:px-2.5 max-lg:first:pl-6 max-lg:last:pr-6";

// Name sorts A to Z first, everything else most first; a second click flips.
function nextSort(sort, key) {
  if (sort.key !== key) return { key, dir: key === "name" ? "asc" : "desc" };
  return { key, dir: sort.dir === "asc" ? "desc" : "asc" };
}

function HeadCell({ h, sort, onSort, rowSpan, colSpan, second }) {
  const on = h.sort && sort.key === h.sort;
  const desc = sort.dir !== "asc";
  const align = h.band ? "text-center" : h.right ? "text-right" : "";
  return (
    <th
      scope={h.band ? "colgroup" : "col"}
      rowSpan={rowSpan}
      colSpan={colSpan}
      aria-sort={on ? (desc ? "descending" : "ascending") : undefined}
      className={`${TH} ${align} ${h.width ?? ""} ${second ? "border-t-0 pt-2" : TH_EDGE}`}
    >
      <span className={`inline-flex items-center gap-x-1.5 align-bottom max-lg:flex-wrap ${h.right ? "justify-end" : ""}`}>
        {h.sort ? (
          <button
            type="button"
            onClick={() => onSort(nextSort(sort, h.sort))}
            className={`inline-flex min-h-6 items-center gap-1 uppercase tracking-[inherit] ${on ? "text-wd-ink" : "hover:text-wd-ink-2"}`}
          >
            {h.label}
            {on && <span aria-hidden="true">{desc ? "↓" : "↑"}</span>}
          </button>
        ) : (
          <span>{h.label}</span>
        )}
        {h.tip && <InfoTip label={`About ${h.name ?? h.label}`}>{h.tip}</InfoTip>}
      </span>
      {h.sub && (
        <span className="mt-0.5 block font-sans text-[11px] font-normal normal-case leading-4 tracking-normal text-wd-ink-2">
          {h.sub}
        </span>
      )}
    </th>
  );
}

function FootCell({ model }) {
  if (!model) return <td className={FOOT} />;
  return (
    <td className={`${FOOT} text-right`}>
      <CellValue model={model} />
      <CellSub sub={model.sub} className="text-right font-normal" />
      <CellSub sub={model.sub2} className="text-right font-normal" />
    </td>
  );
}

/**
 * The desktop and tablet Hotspot table (WdHotspots, JUDGE 4): two sticky
 * header rows under the app bar ("HNT from Mobile data transfer" spans Oct 14
 * and 7 days), sortable headers with `aria-sort`, InfoTips on Status,
 * Unclaimed, the band, Lifetime, Onboarded and Messages; labelled `tbody`
 * groups for rows without the sort's value; the pager; the `tfoot` totals.
 *
 * `mode` "mixed" | "iot" (Messages replaces the band: the IoT network filter,
 * or a wallet with no Mobile Hotspot); `narrow` (the detail is open beside
 * it); `showOnboarded` (1280 px and wider). `groups` are the rendered rows;
 * `skeleton` a row count while the list loads. `foot`: { label, sub, cells:
 * { u, day, week, life, msg } } (cell models).
 */
export default function HotspotTable({
  groups,
  skeleton = 0,
  mode,
  narrow,
  showOnboarded,
  sort,
  onSort,
  ctx,
  statusNote,
  caption,
  busy,
  foot,
  pager,
  rowProps,
}) {
  const tableRef = useRef(null);
  const two = mode === "mixed" && !narrow;

  // The second header row sticks just under the first: measure the first.
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || !two) return undefined;
    const first = table.querySelector("thead tr");
    const set = () => table.style.setProperty("--wd-thead-r1", `${Math.round(first.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(set) : null;
    ro?.observe(first);
    return () => ro?.disconnect();
  }, [two]);

  const dayLabel = ctx?.rewardsDayLabel ?? "Latest UTC day";
  const weekLabel = ctx?.rewardsDay ? `7 days to ${fmtDataDay(ctx.rewardsDay)} (UTC)` : "7 days";
  const H = {
    name: { label: "Hotspot", sort: "name", width: COL.name },
    status: { label: "Status", sort: "status", tip: statusNote || null, width: COL.status },
    unc: { label: "Unclaimed", sort: "unclaimed", right: true, tip: UNCLAIMED_NOTE, sub: narrow ? "HNT" : "HNT · since last claim", width: COL.unc },
    band: { label: "HNT from Mobile data transfer", band: true, tip: BAND_NOTE },
    day: { label: dayLabel, sort: "day", right: true, width: COL.day },
    week: { label: weekLabel, sort: "week", right: true, width: COL.week, sub: narrow ? "HNT from Mobile data transfer" : null },
    life: { label: "Lifetime", sort: "lifetime", right: true, tip: LIFETIME_NOTE, sub: "HNT", width: COL.life },
    onb: { label: "Onboarded", sort: "onboarded", tip: ONBOARDED_NOTE, sub: "UTC", width: COL.onb },
    msg: { label: "Messages", sort: "messages", right: true, tip: IOT_MESSAGES_NOTE, sub: ctx?.trafficWindow ?? "30 days", width: COL.msg },
  };
  const cell = (k, extra) => <HeadCell key={k} h={H[k]} sort={sort} onSort={onSort} {...extra} />;

  let head;
  let footCells;
  let skelCells;
  let colKeys;
  const fc = foot?.cells ?? {};
  if (two) {
    head = (
      <>
        <tr>
          {cell("name", { rowSpan: 2 })}
          {cell("status", { rowSpan: 2 })}
          {cell("unc", { rowSpan: 2 })}
          {cell("band", { colSpan: 2 })}
          {cell("life", { rowSpan: 2 })}
          {showOnboarded && cell("onb", { rowSpan: 2 })}
        </tr>
        <tr>
          {cell("day", { second: true })}
          {cell("week", { second: true })}
        </tr>
      </>
    );
    footCells = [
      <FootCell key="u" model={fc.u} />,
      <FootCell key="d" model={fc.day} />,
      <FootCell key="w" model={fc.week} />,
      <FootCell key="l" model={fc.life} />,
      showOnboarded && <FootCell key="o" model={null} />,
    ];
    skelCells = ["right", "right", "right", "right", ...(showOnboarded ? ["left"] : [])];
    colKeys = ["name", "status", "unc", "day", "week", "life", ...(showOnboarded ? ["onb"] : [])];
  } else if (mode === "iot" && !narrow) {
    head = (
      <tr>
        {cell("name")}
        {cell("status")}
        {cell("msg")}
        {cell("unc")}
        {cell("life")}
        {showOnboarded && cell("onb")}
      </tr>
    );
    footCells = [
      <FootCell key="m" model={fc.msg} />,
      <FootCell key="u" model={fc.u} />,
      <FootCell key="l" model={fc.life} />,
      showOnboarded && <FootCell key="o" model={null} />,
    ];
    skelCells = ["right", "right", "right", ...(showOnboarded ? ["left"] : [])];
    colKeys = ["name", "status", "msg", "unc", "life", ...(showOnboarded ? ["onb"] : [])];
  } else {
    const last = mode === "iot" ? "msg" : "week";
    head = (
      <tr>
        {cell("name")}
        {cell("status")}
        {cell("unc")}
        {cell(last)}
      </tr>
    );
    footCells = [<FootCell key="u" model={fc.u} />, <FootCell key="x" model={mode === "iot" ? fc.msg : fc.week} />];
    skelCells = ["right", "right"];
    colKeys = ["name", "status", "unc", last];
  }
  const ncols = 2 + skelCells.length;

  return (
    <table ref={tableRef} className="wd-table w-full border-separate border-spacing-0 text-sm lg:table-fixed" aria-busy={busy || undefined}>
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        {colKeys.map((k) => (
          <col key={k} className={COLS[k]} />
        ))}
      </colgroup>
      <thead>{head}</thead>
      {skeleton > 0 ? (
        <tbody>
          {Array.from({ length: skeleton }, (_, i) => (
            <SkeletonRow key={i} cells={skelCells} />
          ))}
        </tbody>
      ) : (
        groups.map((g, gi) => (
          <tbody key={g.kind ?? `g${gi}`}>
            {g.label && (
              <tr>
                <th
                  colSpan={ncols}
                  scope="rowgroup"
                  className="border-t border-wd-line-2 bg-wd-well px-6 py-2 text-left font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-wd-ink-2"
                >
                  {g.label}
                </th>
              </tr>
            )}
            {g.rows.map((r) => (
              <HotspotRow
                key={r.key}
                row={r}
                mode={mode}
                narrow={narrow}
                showOnboarded={showOnboarded}
                selected={r.key === rowProps.selectedKey}
                flashKey={rowProps.flashKeys?.get(r.key) ?? 0}
                noLonger={rowProps.noLongerMatches.has(r.key)}
                scaleMax={rowProps.scaleMax}
                wallet={rowProps.wallet}
                href={rowProps.hrefFor(r.param)}
                onOpen={rowProps.onOpen}
              />
            ))}
            {pager && gi === groups.length - 1 && (
              <tr>
                <td colSpan={ncols} className={`${TD} py-3.5`}>
                  {pager}
                </td>
              </tr>
            )}
          </tbody>
        ))
      )}
      {foot && (
        <tfoot>
          <tr>
            <th scope="row" colSpan={2} className={`${FOOT} text-left font-normal`}>
              <span className="block text-wd-sm font-semibold text-wd-ink">{foot.label}</span>
              {foot.sub && <span className="block text-wd-cap text-wd-ink-2">{foot.sub}</span>}
            </th>
            {footCells}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
