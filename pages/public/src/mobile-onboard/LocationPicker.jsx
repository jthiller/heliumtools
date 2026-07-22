import { useCallback, useEffect, useMemo, useState } from "react";
import { cellToBoundary } from "h3-js";
import MapGL, { Source, Layer } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { ViewfinderCircleIcon } from "@heroicons/react/24/outline";
import useDarkMode from "../lib/useDarkMode.js";
import { fetchGeo } from "../lib/sharedApi.js";
import { latLngToH3 } from "../lib/h3.js";

const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/**
 * Location-only map picker (drag-to-position pin + H3 res-12 hex overlay +
 * geolocate + lat/lng inputs). Copy-adapted from update-location's
 * UpdatePanel, minus its elevation/gain/dirty-tracking — Mobile onboarding
 * asserts only a location. Controlled: `lat`/`lng` are strings, `onChange`
 * receives { lat, lng }. When both are empty the map seeds itself once from
 * the requester's CF-derived geo (shared/geo) without calling onChange, so an
 * untouched picker never counts as a chosen location.
 */
export default function LocationPicker({ lat, lng, onChange }) {
  const isDark = useDarkMode();
  const [viewState, setViewState] = useState(() => {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    return isNaN(la) || isNaN(lo)
      ? { latitude: 37.77, longitude: -122.42, zoom: 15 }
      : { latitude: la, longitude: lo, zoom: 16 };
  });
  const [geolocating, setGeolocating] = useState(false);

  const hasValue = lat !== "" && lng !== "";

  // Seed the viewport (not the value) from the requester's rough location.
  useEffect(() => {
    if (hasValue) return;
    let cancelled = false;
    fetchGeo().then((geo) => {
      if (cancelled || !geo) return;
      setViewState((v) => ({ ...v, latitude: geo.latitude, longitude: geo.longitude, zoom: 12 }));
    });
    return () => { cancelled = true; };
    // Seed once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const h3Cell = useMemo(() => latLngToH3(lat, lng), [lat, lng]);

  const hexGeoJSON = useMemo(() => {
    if (!h3Cell) return null;
    const boundary = cellToBoundary(h3Cell, true);
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [boundary.concat([boundary[0]])] } };
  }, [h3Cell]);

  const handleMove = useCallback((evt) => setViewState(evt.viewState), []);
  const handleMoveEnd = useCallback((evt) => {
    onChange({
      lat: evt.viewState.latitude.toFixed(6),
      lng: evt.viewState.longitude.toFixed(6),
    });
  }, [onChange]);

  const handleLatLngBlur = useCallback(() => {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    if (!isNaN(la) && !isNaN(lo)) {
      setViewState((v) => ({ ...v, latitude: la, longitude: lo }));
    }
  }, [lat, lng]);

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;
        setViewState((v) => ({ ...v, latitude: la, longitude: lo, zoom: 17 }));
        onChange({ lat: la.toFixed(6), lng: lo.toFixed(6) });
        setGeolocating(false);
      },
      () => setGeolocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [onChange]);

  return (
    <div className="space-y-3">
      <div className="relative h-56 overflow-hidden rounded-lg border border-border">
        <MapGL
          {...viewState}
          onMove={handleMove}
          onMoveEnd={handleMoveEnd}
          mapStyle={isDark ? BASEMAP_DARK : BASEMAP_LIGHT}
          attributionControl={false}
        >
          {hexGeoJSON && (
            <Source type="geojson" data={hexGeoJSON}>
              <Layer id="h3-hex-fill" type="fill" paint={{ "fill-color": "#8b5cf6", "fill-opacity": 0.25 }} />
              <Layer id="h3-hex-outline" type="line" paint={{ "line-color": "#8b5cf6", "line-width": 2 }} />
            </Source>
          )}
        </MapGL>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative -mt-5">
            <svg width="24" height="36" viewBox="0 0 24 36" className="drop-shadow-lg">
              <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#8b5cf6" />
              <circle cx="12" cy="12" r="5" fill="white" />
            </svg>
          </div>
        </div>
        <button
          type="button"
          onClick={handleGeolocate}
          disabled={geolocating}
          title="Use my location"
          aria-label="Use my location"
          className="absolute right-2 top-2 rounded-md border border-border bg-surface-raised p-2 text-content-secondary shadow-sm transition hover:border-accent hover:text-accent-text disabled:opacity-50"
        >
          <ViewfinderCircleIcon className={`h-4 w-4 ${geolocating ? "animate-pulse" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-content-secondary">Latitude</label>
          <input type="text" value={lat} onChange={(e) => onChange({ lat: e.target.value, lng })}
            onBlur={handleLatLngBlur} placeholder="e.g. 37.7749" className={INPUT_CLASS} />
        </div>
        <div>
          <label className="text-xs font-medium text-content-secondary">Longitude</label>
          <input type="text" value={lng} onChange={(e) => onChange({ lat, lng: e.target.value })}
            onBlur={handleLatLngBlur} placeholder="e.g. -122.4194" className={INPUT_CLASS} />
        </div>
      </div>
    </div>
  );
}
