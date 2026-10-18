import { memo } from "react";
import { fmtCount, fmtUtcDate } from "../format.js";
import { FLEET_UNAVAILABLE } from "../copy.js";

/**
 * About this fleet: composition, places, onboarding over time, onboarding
 * fees. STUB (U0a): the final props, a placeholder body; U6 replaces it.
 *
 * Props: wallet, list, places, onboarding ({ stats, done, progress, byKey }),
 * summary ({ data, loading, error, retry }), fleetState ({ state, error,
 * retry }), onFilter(patch), onOpenHotspot(param, el).
 */
export default memo(function AboutSection({ onboarding, fleetState }) {
  const s = onboarding.stats;
  return (
    <section id="about" aria-labelledby="about-title" data-wd-section="about">
      <h2 id="about-title" className="m-0 font-display text-wd-h2-sm font-semibold md:text-wd-h2">
        About this fleet
      </h2>
      <p className="mt-2 text-wd-sm text-wd-ink-2">
        {fleetState.state === "failed"
          ? FLEET_UNAVAILABLE.about
          : s?.oldest
            ? `Onboarded ${fmtUtcDate(s.oldest)} to ${fmtUtcDate(s.newest)} (UTC).`
            : `Checking onboard dates: ${fmtCount(onboarding.progress.done)} of ${fmtCount(onboarding.progress.total)} Hotspots…`}
      </p>
    </section>
  );
});
