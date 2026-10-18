import { memo } from "react";
import { fmtCount } from "../format.js";
import { FLEET_UNAVAILABLE } from "../copy.js";

/**
 * Health: the IoT and Mobile modules. STUB (U0a): the final props, a
 * placeholder body; U5 replaces it.
 *
 * Props: wallet, list, iotStatus, iotDone, onRetryIot, utilizationIndex,
 * mobile, activity, freshness, onRetryMobile, fleetState ({ state, error,
 * retry }), byNetwork (summary.fleet.byNetwork, to reserve modules while the
 * fleet loads), onShowStatus(key), onOpenHotspot(param, el).
 */
export default memo(function HealthSection({ iotStatus, mobile, fleetState }) {
  return (
    <section id="health" aria-labelledby="health-title" data-wd-section="health">
      <h2 id="health-title" className="m-0 font-display text-wd-h2-sm font-semibold md:text-wd-h2">
        Health
      </h2>
      <p className="mt-2 text-wd-sm text-wd-ink-2">
        {fleetState.state === "failed"
          ? FLEET_UNAVAILABLE.health
          : `IoT: ${fmtCount(iotStatus.active)} of ${fmtCount(iotStatus.active + iotStatus.inactive)} active. Mobile WiFi: ${fmtCount(mobile.counts.heartbeating)} of ${fmtCount(mobile.wifiTotal)} with a heartbeat.`}
      </p>
    </section>
  );
});
