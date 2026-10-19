import { memo } from "react";
import { Disclosure } from "../ui/index.js";
import { DotMark } from "./SiteMarkers.jsx";

const NET_BG = { iot: "rgb(var(--wd-iot))", mobile: "rgb(var(--wd-mobile))" };

function Swatch({ row }) {
  switch (row.kind) {
    case "dot":
      return <DotMark dot={row.dot} size={row.dot.size} />;
    case "ring":
      return (
        <span className="relative block h-[18px] w-[18px] rounded-full" style={{ background: row.background }}>
          <span className="absolute inset-[4.5px] rounded-full bg-surface-raised" />
        </span>
      );
    case "badge":
      return (
        <span className="inline-flex h-4 w-5 items-center justify-center rounded-full bg-surface-raised shadow-soft">
          <span className="block h-[9px] w-[9px] bg-wd-caution" style={{ clipPath: "polygon(50% 6%, 100% 94%, 0 94%)" }} />
        </span>
      );
    case "select":
      return (
        <span
          className="block h-4 w-4 rounded-full border-2 border-wd-ink"
          style={{ boxShadow: "0 0 0 1.5px rgb(var(--color-surface-raised))" }}
        />
      );
    case "cell":
      return (
        <span
          className="block h-[18px] w-4 opacity-55"
          style={{ background: NET_BG[row.net] ?? NET_BG.mobile, clipPath: "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)" }}
        />
      );
    case "pos":
      return <span className="block h-3 w-3 rounded-full border-2 border-wd-mobile bg-surface-raised" />;
    case "ramp":
      return <span className="block h-2 w-[22px] rounded-sm" style={{ background: row.background }} />;
    default:
      return null;
  }
}

function Rows({ rows }) {
  return rows.map((row, i) =>
    row.kind === "head" ? (
      <div
        key={`h${i}`}
        className="flex min-h-5 basis-full items-center border-t border-wd-line pt-1 font-semibold text-wd-ink [.wd-legend-row_&]:border-t-0 [.wd-legend-row_&]:pt-0.5"
      >
        {row.label}
      </div>
    ) : (
      <div key={`${row.kind}${i}`} className="flex min-h-5 items-center gap-2">
        <span aria-hidden="true" className="inline-flex w-[22px] shrink-0 items-center justify-center">
          <Swatch row={row} />
        </span>
        <span>{row.label}</span>
      </div>
    ),
  );
}

/**
 * The map's legend: rows only for what is drawn (mapEncoding `legendRows`),
 * then the windows every encoding is read in ("IoT status: Oct 14 (UTC).
 * WiFi heartbeats: last 60 min. …"). Three placements: `float` (a glass box
 * over the map from 1280 px), `row` (under the map, 768 to 1279) and
 * `details` (a "Legend" disclosure on phones).
 */
export const MapLegend = memo(function MapLegend({ rows, windows, variant = "float", className = "" }) {
  if (!rows?.length && !windows) return null;
  const win = windows ? (
    <p
      className={`m-0 basis-full text-wd-cap text-wd-ink-2 ${variant === "row" ? "" : "mt-1 border-t border-wd-line pt-1.5"}`}
    >
      {windows}
    </p>
  ) : null;
  if (variant === "details") {
    return (
      <Disclosure
        summary="Legend"
        className={`border-t border-wd-line-2 ${className}`}
        summaryClassName="wd-ring-inset w-full px-4 text-wd-sm font-semibold text-wd-ink"
      >
        <div className="flex flex-col gap-[5px] px-4 pb-3.5 text-wd-cap text-wd-ink-2">
          <Rows rows={rows} />
          {win}
        </div>
      </Disclosure>
    );
  }
  if (variant === "row") {
    return (
      <div className={`wd-legend-row flex flex-wrap gap-x-5 gap-y-1.5 border-t border-wd-line-2 px-4 pb-3.5 pt-3 text-wd-cap text-wd-ink-2 ${className}`}>
        <Rows rows={rows} />
        {win}
      </div>
    );
  }
  return (
    <div
      className={`absolute left-3.5 top-3.5 z-[7] flex max-h-[calc(100%-28px)] w-[262px] flex-col gap-[5px] overflow-auto rounded-[10px] px-3 py-2.5 text-wd-cap text-wd-ink-2 shadow-soft ${className}`}
      style={{ background: "var(--wd-glass)" }}
    >
      <Rows rows={rows} />
      {win}
    </div>
  );
});

export default MapLegend;
