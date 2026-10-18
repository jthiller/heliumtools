import { memo, useImperativeHandle } from "react";
import { fmtHnt, plural } from "../format.js";
import { needsLine } from "../copy.js";

const STUB_ROWS = 25;

/**
 * Hotspots: the unified IoT + Mobile list (toolbar, status chips, table or
 * phone list, pager, totals) with the detail beside it. STUB (U0a): the
 * final props and the cross-section contracts, a placeholder body; U2
 * replaces it.
 *
 * Props: wallet, list (aggregateHotspotList), filter (filterRows), order
 * (useHotspotOrder), url / setUrl (useDashboardUrlState), fleetState
 * ({ state, error, retry }), iotStatus, mobile, activity, freshness,
 * detailMode ("inline"|"aside"|"drawer"|"fullscreen"), detail (the
 * HotspotDetail element for "aside" / "inline", else null), selectedKey,
 * onOpenDetail(param, linkEl), listRegionRef (attach to the list region),
 * listApiRef (fill with { ensureRendered(key), focusRow(param) }).
 * Row name links carry data-hotspot-link={row.param}; the list heading
 * carries data-wd-list-heading and tabIndex -1 (focus target).
 */
export default memo(function HotspotsSection({
  list,
  filter,
  order,
  fleetState,
  detail,
  selectedKey,
  onOpenDetail,
  listRegionRef,
  listApiRef,
}) {
  useImperativeHandle(listApiRef, () => ({ ensureRendered() {}, focusRow() {} }), []);
  const rows = order.keys
    .slice(0, STUB_ROWS)
    .map((k) => list.byKey.get(k))
    .filter(Boolean);
  return (
    <section id="hotspots" aria-labelledby="hotspots-title" data-wd-section="hotspots">
      <h2
        id="hotspots-title"
        tabIndex={-1}
        data-wd-list-heading=""
        data-wd-anchor=""
        className="m-0 font-display text-wd-h2-sm font-semibold md:text-wd-h2"
      >
        Hotspots
      </h2>
      <p className="mt-1 text-wd-cap text-wd-ink-2">
        {fleetState.state === "failed"
          ? "Couldn't load Hotspots."
          : list.counts.total === 0 && fleetState.state === "ready"
            ? "No Hotspots in this wallet."
            : list.counts.needs == null
              ? `Checking ${plural(list.counts.total, "Hotspot")}…`
              : needsLine(list.counts.needs, list.counts.total)}
      </p>
      <div className={detail && list.counts.total > 1 ? "mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]" : "mt-3"}>
        <div ref={listRegionRef}>
          {list.counts.total > 1 && (
            <ul className="m-0 list-none p-0 text-wd-sm">
              {rows.map((r) => (
                <li key={r.key} aria-current={r.key === selectedKey ? "true" : undefined} className="border-t border-wd-line-2 py-1.5">
                  <a
                    href={`?hotspot=${encodeURIComponent(r.param)}`}
                    data-hotspot-link={r.param}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenDetail(r.param, e.currentTarget);
                    }}
                  >
                    {r.name || "Unnamed Hotspot"}
                  </a>{" "}
                  <span className="text-wd-ink-2">
                    · {r.top.label}
                    {r.top.window ? `, ${r.top.window}` : ""} · Unclaimed{" "}
                    {r.unclaimed.state === "ok" ? fmtHnt(r.unclaimed.hnt) : r.unclaimed.state === "loading" ? "…" : "Couldn't load"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {filter.count > STUB_ROWS && (
            <p className="mt-2 text-wd-cap text-wd-ink-2">Showing {STUB_ROWS} of {plural(filter.count, "Hotspot")}.</p>
          )}
        </div>
        {detail}
      </div>
    </section>
  );
});
