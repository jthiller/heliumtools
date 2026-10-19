import { lazy, memo, Suspense, useCallback, useMemo, useState } from "react";
import { cellToBoundary, cellToParent } from "h3-js";
import { COVERAGE_RSSI_MIN, fmtElevationM, fmtGainDbi, plural } from "../format.js";
import { fmtClock, fmtLocationSource, fmtMeters, fmtMultiplier } from "../mobileFormat.js";
import { selectedOverlay } from "../map/selectedOverlay.js";
import { useHotspotCoverage } from "../useIotLookups.js";
import { useResetOnChange } from "../useWalletData.js";
import { COVERAGE_GATE_NOTE, CoverageNotes, CoverageToggle } from "../ui/CoverageNotes.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { TimeAgo } from "../ui/TimeAgo.jsx";
import { DList, DRow, DSection, Foot, TOGGLE_BTN } from "./parts.jsx";

// MapLibre loads with the first opened detail, not with the page.
const LocationMap = lazy(() => import("./LocationMap.jsx"));

// The coverage service models res-8 cells.
const COVERAGE_RES = 8;

function parentOf(hex, res) {
  if (!hex) return null;
  try {
    return cellToParent(hex.toLowerCase(), res);
  } catch {
    return null;
  }
}

function boundaryOf(hex) {
  try {
    return cellToBoundary(hex, true);
  } catch {
    return null;
  }
}

/**
 * The footprint as drawn: cells at or above the ramp floor with their
 * outlines, plus the facts CoverageNotes words (the fleet map derives the
 * same). Null until cells load.
 */
export function deriveFootprint(cells, assertedHex) {
  if (!cells) return null;
  const ownCell = parentOf(assertedHex, COVERAGE_RES);
  const drawn = [];
  for (const c of cells) {
    if (c.rssi < COVERAGE_RSSI_MIN) continue;
    const polygon = boundaryOf(c.hex);
    if (polygon) drawn.push({ ...c, polygon });
  }
  const isOwn = (c) => c.hex.toLowerCase() === ownCell;
  return {
    modeled: cells.length,
    drawn,
    // Built nightly from the asserted location at the time: a footprint that
    // misses the Hotspot's own cell predates its current assertion.
    fromPreviousAssertion: Boolean(ownCell) && cells.length > 0 && !cells.some(isOwn),
    onlyOwnCell: drawn.length === 1 && isOwn(drawn[0]),
  };
}

/** "Reported position: 4 heartbeats in the last 60 min · 31 m from asserted ·
 * Skyhook, trust 1.00 · last heard 20m ago". */
function PositionLine({ g, hb }) {
  const facts = [
    `${plural(g.count, "heartbeat")} ${hb.long}`,
    Number.isFinite(g.distanceM) ? `${fmtMeters(g.distanceM)} from asserted` : null,
    [g.source ? fmtLocationSource(g.source) : null, g.trust != null ? `trust ${fmtMultiplier(g.trust)}` : null]
      .filter(Boolean)
      .join(", ") || null,
  ].filter(Boolean);
  return (
    <li className="grid grid-cols-[10px_minmax(0,1fr)] gap-x-2.5 text-wd-sm text-wd-ink">
      <i aria-hidden="true" className="mt-1 h-2.5 w-2.5 rounded-full border-2 border-wd-mobile bg-surface-raised" />
      <span>
        Reported position: {facts.join(" · ")}
        {g.at > 0 && (
          <>
            {" · last heard "}
            {hb.current === false ? `at ${fmtClock(g.at)}` : <TimeAgo at={g.at} fallback="at an unknown time" />}
          </>
        )}
      </span>
    </li>
  );
}

/**
 * The detail's Location: the 240 px mini map (asserted cell, pin, a WiFi
 * Hotspot's reported positions and lines; the modeled footprint when it's
 * on), the positions list, the opt-in "Modeled coverage" for active IoT
 * Hotspots with its notes, and the asserted cell, gain and elevation. The
 * coverage toggle resets per Hotspot; the map instance stays.
 */
export default memo(function LocationSection({ row, mobile }) {
  const [covOn, setCovOn] = useState(false);
  useResetOnChange(row.key, () => setCovOn(false));
  const onToggle = useCallback(() => setCovOn((v) => !v), []);

  const net = row.nets.iot && !row.mobile ? "iot" : row.nets.mobile ? "mobile" : row.nets.iot ? "iot" : "mobile";
  const iot = row.iot;
  // Only active Hotspots with an asserted location (per the service's own
  // record) are modeled; anything else is guaranteed empty.
  const coverageEligible = iot?.status === "active" && Boolean(iot.hex);
  const shown = coverageEligible && covOn;
  const coverage = useHotspotCoverage(shown ? row.key : null);
  const footprint = useMemo(() => deriveFootprint(coverage.cells, iot?.hex), [coverage.cells, iot?.hex]);
  const drawn = shown && footprint?.drawn.length ? footprint.drawn : null;

  const overlay = useMemo(() => selectedOverlay(row, mobile), [row, mobile]);
  const hb = mobile?.windows?.heartbeats ?? { long: "in the last 60 min", short: "60 min", current: true };
  const hbLoaded = Boolean(mobile?.loaded?.heartbeats);
  const hbFailed = !hbLoaded && Boolean(mobile?.failed?.heartbeats);
  const groups = row.wifi && hbLoaded ? (overlay?.groups ?? []) : [];

  const legend = drawn
    ? [
        { kind: "pin", text: "Asserted location" },
        { kind: "ramp", text: "Modeled coverage −130 to −90 dBm" },
      ]
    : [{ kind: "cell", text: "Asserted cell" }];
  if (groups.length) legend.push({ kind: "pos", text: `Reported positions (${hb.current === false ? hb.short : "60 min"})` });

  const place = row.place.full || row.placeText;
  const farthest = groups.length ? Math.max(...groups.map((g) => g.distanceM).filter(Number.isFinite), 0) : null;
  const ariaLabel = [
    `Map of ${row.name || "this Hotspot"} at its asserted location${row.place.full ? ` in ${place}` : ""}`,
    groups.length === 1
      ? `with 1 reported position ${fmtMeters(groups[0].distanceM)} from the asserted cell`
      : groups.length > 1
        ? `with ${groups.length} reported positions up to ${fmtMeters(farthest)} from the asserted cell`
        : null,
    drawn ? "with modeled coverage" : null,
  ]
    .filter(Boolean)
    .join(", ");

  let pnote = null;
  if (row.wifi) {
    if (hbFailed) pnote = "Couldn't load reported positions.";
    else if (!hbLoaded) pnote = "Checking reported positions…";
    else if (!groups.length) pnote = `No reported positions ${hb.long}.`;
  }

  const caption = row.nets.iot
    ? "Asserted location, gain and elevation"
    : row.wifi
      ? "Asserted cell and reported positions"
      : "Asserted location";
  const hex = row.hotspot?.location || null;

  return (
    <DSection id="location" title="Location" right={row.asserted ? caption : null}>
      {!row.asserted || !overlay ? (
        <p className="m-0 text-wd-sm text-wd-ink-2">No asserted location on-chain for this Hotspot.</p>
      ) : (
        <>
          <Suspense fallback={<Skeleton h={240} className="w-full !rounded-xl" />}>
            <LocationMap overlay={overlay} net={net} footprint={drawn} legend={legend} ariaLabel={`${ariaLabel}.`} />
          </Suspense>
          {groups.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {groups.map((g) => (
                <PositionLine key={`${g.lat},${g.lng}`} g={g} hb={hb} />
              ))}
            </ul>
          )}
          {pnote && <Foot>{pnote}</Foot>}
          {row.nets.iot && iot && iot.status !== "pending" && !iot.lookupFailed && (
            <div className="flex flex-col items-start gap-2">
              {coverageEligible ? (
                <>
                  <CoverageToggle coverage={{ shown, onToggle }} className={TOGGLE_BTN} />
                  <CoverageNotes
                    coverage={{ shown, state: coverage.state, retry: coverage.retry, footprint }}
                    hotspot={row.hotspot}
                  />
                </>
              ) : (
                <Foot>{COVERAGE_GATE_NOTE}</Foot>
              )}
            </div>
          )}
          <DList>
            {hex && (
              <DRow label="Asserted cell">
                <span className="font-mono text-xs">{hex} (res 12)</span>
              </DRow>
            )}
            {row.nets.iot && <DRow label="Gain">{fmtGainDbi(row.hotspot?.gain)}</DRow>}
            {row.nets.iot && <DRow label="Elevation">{fmtElevationM(row.hotspot?.elevation)}</DRow>}
          </DList>
        </>
      )}
    </DSection>
  );
});
