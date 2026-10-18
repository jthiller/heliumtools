import { memo } from "react";
import { plural } from "../format.js";

/**
 * Map: the fleet by site, the selected Hotspot's panel, legend and loupe.
 * STUB (U0a): the final props, a placeholder body; U4 replaces it.
 *
 * Props: wallet, list, places, iotStatus, mobile, activity, freshness,
 * heartbeatsLive, fleetState ({ state, error, retry }), filter (filterRows
 * result), onClearFilter(), detailKey (the URL's `hotspot`), mapSelect
 * ({ key, seq } | null: "Show on map" from the detail), onOpenDetail(param,
 * el), onPlace(city).
 */
export default memo(function MapSection({ places, fleetState }) {
  return (
    <section id="map" aria-labelledby="map-title" data-wd-section="map">
      <h2 id="map-title" className="m-0 font-display text-wd-h2-sm font-semibold md:text-wd-h2">
        Map
      </h2>
      <p className="mt-2 text-wd-sm text-wd-ink-2">
        {fleetState.state === "failed"
          ? "Couldn't load Hotspots."
          : places
            ? `${places.caption()}. ${plural(places.sites.length, "site")}.`
            : "Loading Hotspots…"}
      </p>
    </section>
  );
});
