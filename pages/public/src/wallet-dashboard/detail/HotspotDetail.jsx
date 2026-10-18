import { memo } from "react";
import { fmtHnt } from "../format.js";

/**
 * One Hotspot's detail (aside on desktop, a dialog below 1280 px, the
 * section body for a one-Hotspot wallet). STUB (U0a): the final props, a
 * placeholder body; U3 replaces it.
 *
 * Props: row (HotspotRow), list, mobile, activity, freshness, iotStatus,
 * utilizationIndex, rewards (rewardsByKey[row.key]), prices, walletWeekHnt,
 * veHntPending, wallet, nav ({ index, total, sortLabel, prev, next }: prev /
 * next are { key, param, name } | null), mode ("inline"|"aside"|"drawer"|
 * "fullscreen"), headingRef (the h2, tabIndex -1: focused on open),
 * regionRef (the detail root), onClose(), onNavigate(target: nav.prev |
 * nav.next), onShowOnMap(key), onRetry ({ iot, mobile }).
 */
export default memo(function HotspotDetail({ row, nav, mode, headingRef, regionRef, onClose, onNavigate, onShowOnMap }) {
  return (
    <div ref={regionRef} className="wd-detail rounded-2xl bg-surface-raised p-5 shadow-soft" data-wd-detail={mode}>
      <h2 ref={headingRef} tabIndex={-1} data-wd-anchor="" className="m-0 font-display text-wd-title font-semibold">
        {row.name || "Unnamed Hotspot"}
      </h2>
      <p className="mt-1 text-wd-cap text-wd-ink-2">
        {row.deviceLabel} · {row.placeText}
      </p>
      <ul className="mt-2 list-none p-0 text-wd-sm">
        {row.states.map((s) => (
          <li key={`${s.key}:${s.window}`}>
            {s.label}
            {s.window ? `, ${s.window}` : ""}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-wd-sm">
        Unclaimed {row.unclaimed.state === "ok" ? `${fmtHnt(row.unclaimed.hnt, "day")} HNT` : "…"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-wd-sm">
        {mode !== "inline" && (
          <button type="button" onClick={onClose}>
            Close
          </button>
        )}
        <button type="button" onClick={() => onShowOnMap(row.key)}>
          Show on map
        </button>
        {nav.prev && (
          <button type="button" onClick={() => onNavigate(nav.prev)}>
            Previous: {nav.prev.name || "Unnamed Hotspot"}
          </button>
        )}
        {nav.next && (
          <button type="button" onClick={() => onNavigate(nav.next)}>
            Next: {nav.next.name || "Unnamed Hotspot"}
          </button>
        )}
        {nav.total > 0 && (
          <span className="text-wd-ink-2">
            {nav.index + 1} of {nav.total}, by {nav.sortLabel}
          </span>
        )}
      </div>
    </div>
  );
});
