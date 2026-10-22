import { COVERAGE_RSSI_MIN, fmtDbm, fmtElevationM, fmtGainDbi, modeledCoverageInputs } from "../format.js";
import { ExtLink } from "./ExtLink.jsx";

const TERRAIN_TILES_URL = "https://registry.opendata.aws/terrain-tiles/";
// The footprint ramp's ends (light, dark), for a toggle whose host passes no `rampCss`.
const DEFAULT_RAMP =
  "bg-[linear-gradient(to_right,rgba(183,211,246,0.9),rgba(28,92,171,0.9))] dark:bg-[linear-gradient(to_right,rgba(24,79,149,0.9),rgba(109,167,236,0.9))]";

/** Shown instead of the toggle for a Hotspot the service doesn't model (inactive, or no asserted location). */
export const COVERAGE_GATE_NOTE = "Coverage is modeled nightly for active Hotspots with an asserted location.";

const NOTE = "m-0 text-xs leading-[17px] text-wd-ink-2";

/**
 * The opt-in "Modeled coverage" toggle (`aria-pressed`; the label never
 * changes) with the footprint ramp's swatch. `coverage` is the host's
 * `{ shown, onToggle, rampCss }` (without `rampCss`, the theme's default
 * ramp). Only for a Hotspot the service models (active IoT with an asserted
 * location); otherwise show COVERAGE_GATE_NOTE.
 */
export function CoverageToggle({ coverage, className = "" }) {
  const on = Boolean(coverage?.shown);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={coverage?.onToggle}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition md:min-h-8 ${
        on
          ? "border-wd-accent-line bg-accent-surface text-accent-text"
          : "border-wd-control bg-surface-raised text-wd-ink hover:bg-wd-well"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-[22px] shrink-0 rounded-sm ${coverage?.rampCss ? "" : DEFAULT_RAMP}`}
        style={coverage?.rampCss ? { background: coverage.rampCss } : undefined}
      />
      Modeled coverage
    </button>
  );
}

/**
 * What the modeled footprint means, under the toggle. Off: the caveat alone
 * (a model, not a measurement). On: loading, a failed load with Retry, "not
 * modeled yet", or the caveat plus the asserted inputs and where the model
 * clamped them, the low-elevation notes, a footprint from a previous
 * assertion, own-cell-only and nothing-drawn notes, and the terrain credit
 * whenever cells are drawn. `coverage` is the host's `{ shown, state, retry,
 * footprint }` (`useHotspotCoverage` + the footprint derivation); `hotspot`
 * the fleet row (`gain`, `elevation`).
 */
export function CoverageNotes({ coverage, hotspot, className = "" }) {
  const caveat = <p className={NOTE}>Modeled reach from the asserted location, gain and elevation. A model, not a measurement.</p>;
  if (!coverage?.shown) return <div className={className}>{caveat}</div>;

  const { state, retry, footprint } = coverage;
  if (state === "error") {
    return (
      <p className={`${NOTE} ${className}`} role="status">
        Couldn&apos;t load modeled coverage.{" "}
        <button
          type="button"
          onClick={retry}
          aria-label="Retry modeled coverage"
          className="relative font-semibold text-accent-text hover:underline before:absolute before:-inset-x-1 before:-inset-y-3 before:content-['']"
        >
          Retry
        </button>
      </p>
    );
  }
  if (state !== "ok" && state !== "notFound") {
    return (
      <p className={`${NOTE} ${className}`} role="status">
        Loading modeled coverage…
      </p>
    );
  }
  if (state === "notFound" || !footprint || footprint.modeled === 0) {
    return (
      <p className={`${NOTE} ${className}`} role="status">
        Not modeled yet. {COVERAGE_GATE_NOTE}
      </p>
    );
  }

  // The model clamps the asserted inputs (gain 1 to 15 dBi, default 1.2;
  // elevation 0 to 50 m with a 1.5 m floor): say so where it changed one.
  const modeled = modeledCoverageInputs(hotspot?.gain, hotspot?.elevation);
  const elevation = Number.isFinite(hotspot?.elevation) ? hotspot.elevation : null;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {caveat}
      <p className={NOTE}>
        Currently asserted: gain {fmtGainDbi(hotspot?.gain)}
        {modeled.gainAdjusted && ` (modeled at ${fmtGainDbi(modeled.gain)})`} · elevation {fmtElevationM(hotspot?.elevation)}
        {modeled.elevationAdjusted && ` (modeled at ${fmtElevationM(modeled.elevation)})`}
      </p>
      {(elevation === null || elevation === 0) && (
        <p className={NOTE}>0 m is the on-chain default; the model may understate this Hotspot&apos;s reach.</p>
      )}
      {elevation > 0 && elevation <= 2 && (
        <p className={NOTE}>Low asserted elevation; the model may understate this Hotspot&apos;s reach.</p>
      )}
      {footprint.fromPreviousAssertion && (
        <p className={NOTE}>Footprint from a previous assertion. Coverage is rebuilt nightly.</p>
      )}
      {footprint.onlyOwnCell && (
        <p className={NOTE}>Only this Hotspot&apos;s own cell is modeled above {fmtDbm(COVERAGE_RSSI_MIN)}.</p>
      )}
      {footprint.drawn.length === 0 && <p className={NOTE}>No modeled cells reach {fmtDbm(COVERAGE_RSSI_MIN)}.</p>}
      {footprint.drawn.length > 0 && (
        <p className={NOTE}>
          Modeled coverage © Helium. Terrain © Tilezen <ExtLink href={TERRAIN_TILES_URL}>Terrain Tiles</ExtLink> (NASA SRTM,
          USGS 3DEP, GEBCO)
        </p>
      )}
    </div>
  );
}

export default CoverageNotes;
