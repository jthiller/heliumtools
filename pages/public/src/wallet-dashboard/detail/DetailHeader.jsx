import { memo } from "react";
import { accountUrl, fmtUtcDate, shortAddress } from "../format.js";
import { fmtReason } from "../mobileFormat.js";
import { NetChip } from "../ui/Chip.jsx";
import { CopyIconButton } from "../ui/CopyIconButton.jsx";
import { ExtLink } from "../ui/ExtLink.jsx";
import { StatusMark } from "../ui/StatusMark.jsx";
import { COPY_BTN, DBTN, DETAIL_TITLE_ID, DLINK, RetryBtn } from "./parts.jsx";

/** "Banned · Data farming · Sep 3, 2026" (an unknown reason is left out). */
export function banLine(ban) {
  const reason = ban?.reason && ban.reason !== "ban_reason_unknown" ? fmtReason(ban.reason) : null;
  return ["Banned", reason, ban?.at ? fmtUtcDate(ban.at) : null].filter(Boolean).join(" · ");
}

/** The network chips: the device's own network carries the device label; a
 * dual-network Hotspot adds its other network. CBRS and no-network Hotspots
 * get the plain label (no network identity to show). */
function NetChips({ row }) {
  const { nets, deviceLabel } = row;
  if (nets.cbrs || nets.none) return <span className="text-wd-sm text-wd-ink-2">{deviceLabel}</span>;
  const primary = deviceLabel.startsWith("Mobile") ? "mobile" : deviceLabel.startsWith("IoT") ? "iot" : nets.iot ? "iot" : "mobile";
  const other = nets.dual ? (primary === "iot" ? "mobile" : "iot") : null;
  return (
    <>
      <NetChip net={primary}>{deviceLabel}</NetChip>
      {other && <NetChip net={other} />}
    </>
  );
}

/**
 * Why the Mobile figures aren't current, with a Retry: the one sentence every
 * surface shows (mobileFreshness `note`: "Couldn't check the latest Mobile
 * data. Showing data from 7:42 PM.", "Couldn't update heartbeats. Showing
 * data from 7:42 PM."). A data-only Hotspot skips a note about WiFi tables
 * only (it has no heartbeats or speedtests).
 */
function mobileNote(row, freshness) {
  if (!row.mobile || !freshness?.note) return null;
  const failed = freshness.failedTables ?? [];
  const wifiOnly = failed.length > 0 && !failed.includes("bans");
  if (!row.wifi && wifiOnly && freshness.state !== "error") return null;
  return freshness.note;
}

/**
 * The detail's header: the name (the h2 focus moves to), its network and
 * device, its place, and the actions (Copy entity key, Solscan, Show on map,
 * Update location for IoT). Then, when they apply, the ban block and the
 * note on Mobile data that couldn't update.
 */
export default memo(function DetailHeader({ row, freshness, windows, headingRef, onShowOnMap, onRetryMobile }) {
  const keyShort = shortAddress(row.key, 8, 4);
  const ban = row.mobile?.banned ? row.mobile.ban : null;
  const note = mobileNote(row, freshness);
  return (
    <>
      <header className="flex flex-col gap-2.5 px-5 py-[18px] max-md:p-4">
        <h2
          ref={headingRef}
          id={DETAIL_TITLE_ID}
          tabIndex={-1}
          data-wd-anchor=""
          data-wd-detail-heading=""
          className="m-0 font-display text-xl font-semibold leading-[26px] tracking-[-0.015em] text-wd-ink [overflow-wrap:anywhere] focus-visible:outline-offset-4"
        >
          {row.name || "Unnamed Hotspot"}
        </h2>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <NetChips row={row} />
          <span className="text-wd-sm text-wd-ink-2">{row.place.full || row.placeText}</span>
        </div>
        <div className="flex flex-wrap gap-2 pt-0.5">
          <CopyIconButton text={row.key} label={`Copy entity key ${keyShort}`} copiedText="Copied entity key" className={COPY_BTN}>
            <span className="font-mono">{keyShort}</span>
          </CopyIconButton>
          {row.assetId && (
            <ExtLink href={accountUrl(row.assetId)} className={DLINK}>
              Solscan
            </ExtLink>
          )}
          {row.asserted && (
            <button type="button" className={DBTN} onClick={() => onShowOnMap(row.key)}>
              Show on map
            </button>
          )}
          {row.nets.iot && (
            <a href="/update-location" className={DLINK}>
              Update location
            </a>
          )}
        </div>
      </header>

      {ban && (
        <div
          role="note"
          className="mx-5 mb-[18px] grid grid-cols-[12px_minmax(0,1fr)] gap-x-2.5 rounded-[10px] bg-wd-critical-surface px-3.5 py-3 max-md:mx-4 max-md:mb-4"
        >
          <span className="mt-1 flex">
            <StatusMark tier="serious" sr={false} />
          </span>
          <div className="min-w-0">
            <span className="sr-only">Serious: </span>
            <span className="block text-sm font-semibold leading-5 text-wd-critical-text">{banLine(ban)}</span>
            {ban.message && <p className="m-0 mt-1 text-wd-sm text-wd-ink-2">{ban.message}</p>}
          </div>
        </div>
      )}

      {note && (
        <div className="mx-5 mb-[18px] flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-wd-well px-3 py-2.5 text-wd-sm text-wd-ink-2 max-md:mx-4 max-md:mb-4">
          <StatusMark tier="unknown" mark="x" word="Unknown" />
          <span className="min-w-0 flex-1">{note}</span>
          {onRetryMobile && <RetryBtn onClick={onRetryMobile} label="Retry Mobile data" />}
        </div>
      )}
    </>
  );
});
