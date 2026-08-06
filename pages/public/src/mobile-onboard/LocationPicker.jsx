import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** True once BOTH coordinates are set — the seed only applies to an empty picker. */
const hasCoords = (v) => v.lat !== "" && v.lng !== "";

/** The string props as numbers, or null when either is unusable. */
function parseCoords(lat, lng) {
  const la = parseFloat(lat);
  const lo = parseFloat(lng);
  return isNaN(la) || isNaN(lo) ? null : { la, lo };
}

/**
 * Location-only map picker (drag-to-position pin + H3 res-12 hex overlay +
 * geolocate + lat/lng inputs). Copy-adapted from update-location's
 * UpdatePanel, minus its elevation/gain/dirty-tracking — Mobile onboarding
 * asserts only a location. Controlled: `lat`/`lng` are strings, `onChange`
 * receives { lat, lng }. When both are empty the map seeds itself once from
 * the requester's CF-derived geo (shared/geo) without calling onChange, so an
 * untouched picker never counts as a chosen location.
 *
 * The picker owns programmatic recentering: when the lat/lng props change to
 * a value the picker did not itself produce, the camera follows. Values the
 * picker produced — map drags, geolocate, typed input — echo back down as
 * props without moving the camera, so typing a coordinate doesn't jerk the
 * map mid-keystroke (blur applies it, as before). Callers therefore never
 * need remount keys.
 *
 * Of the callers today, only OnboardStep's address geocode exercises this
 * live: ManageDetail's chain-loaded location and OnboardWizard's resumed
 * draft both land before the picker mounts, so the mount-time initializer
 * positions those. The point of owning the behavior is that a caller can set
 * the value whenever it likes without knowing which case it is.
 *
 * `recenterZoom` (optional) is a zoom hint for external recenters, e.g. a
 * geocode's match precision. It must be set in the same commit as the lat/lng
 * it describes — the picker reads it only while recentering, so a hint set a
 * commit late applies to whatever moved the value next.
 *
 * Known tradeoff: an external set whose value is string-identical to the
 * current one is a no-op. Panning is unaffected (a pan emits a new internal
 * value, so re-asserting the old one is a real change); the gap is *zoom-only*
 * divergence — zoom out without panning, re-search the same address, and the
 * camera keeps your zoom. Deliberate: a value-identical re-assert has no prop
 * delta to observe, and the only fix is a fresh-object-per-call signal, i.e.
 * the token contract this design replaced.
 *
 * update-location's UpdatePanel deliberately has none of this: it owns its own
 * lat/lng state rather than receiving it, so no value round-trips through a
 * parent and provenance is never ambiguous. Don't port this mechanism there.
 */
export default function LocationPicker({ lat, lng, onChange, recenterZoom }) {
  const isDark = useDarkMode();
  const [viewState, setViewState] = useState(() => {
    const c = parseCoords(lat, lng);
    return c
      ? { latitude: c.la, longitude: c.lo, zoom: 16 }
      : { latitude: 37.77, longitude: -122.42, zoom: 15 };
  });
  const [geolocating, setGeolocating] = useState(false);

  // The last value this picker itself produced. Every internal origin (map
  // moveEnd, geolocate, the lat/lng inputs) records here before calling
  // onChange, so the recenter effect below can tell an external set from the
  // echo of its own output. Exact string comparison is deliberate: internal
  // origins record the identical strings the parent hands back.
  const internal = useRef({ lat, lng });
  const emit = useCallback(
    (next) => {
      internal.current = next;
      onChange(next);
    },
    [onChange],
  );

  // Seed the viewport (not the value) from the requester's rough location.
  useEffect(() => {
    if (hasCoords(internal.current)) return;
    let cancelled = false;
    fetchGeo().then((geo) => {
      // Re-checked at resolve time: a geocode or chain load may have landed
      // while this was in flight, and the seed must not clobber it. `internal`
      // is a live mirror of the value (every origin records there), so it
      // answers this without a second ref.
      if (cancelled || !geo || hasCoords(internal.current)) return;
      setViewState((v) => ({ ...v, latitude: geo.latitude, longitude: geo.longitude, zoom: 12 }));
    });
    return () => { cancelled = true; };
    // Seed once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Externally-set values recenter the camera; internal echoes don't.
  useEffect(() => {
    if (lat === internal.current.lat && lng === internal.current.lng) return;
    // Adopt before parsing, so a cleared or half-typed external value doesn't
    // re-trigger on the next dep change. This also keeps `internal` a total
    // mirror of the committed value, which the seed effect above relies on.
    internal.current = { lat, lng };
    const c = parseCoords(lat, lng);
    if (!c) return;
    setViewState((v) => ({
      ...v,
      latitude: c.la,
      longitude: c.lo,
      // A precision hint (geocode) wins; otherwise never zoom OUT on a
      // recenter, but pull at least to street level.
      zoom: recenterZoom ?? Math.max(v.zoom, 16),
    }));
  }, [lat, lng, recenterZoom]);

  const h3Cell = useMemo(() => latLngToH3(lat, lng), [lat, lng]);

  const hexGeoJSON = useMemo(() => {
    if (!h3Cell) return null;
    const boundary = cellToBoundary(h3Cell, true);
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [boundary.concat([boundary[0]])] } };
  }, [h3Cell]);

  const handleMove = useCallback((evt) => setViewState(evt.viewState), []);
  const handleMoveEnd = useCallback((evt) => {
    emit({
      lat: evt.viewState.latitude.toFixed(6),
      lng: evt.viewState.longitude.toFixed(6),
    });
  }, [emit]);

  // Typed coordinates are an internal origin, so the recenter effect ignores
  // their echo. Blur is what applies them to the camera.
  const handleLatLngBlur = useCallback(() => {
    const c = parseCoords(lat, lng);
    if (c) setViewState((v) => ({ ...v, latitude: c.la, longitude: c.lo }));
  }, [lat, lng]);

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;
        setViewState((v) => ({ ...v, latitude: la, longitude: lo, zoom: 17 }));
        emit({ lat: la.toFixed(6), lng: lo.toFixed(6) });
        setGeolocating(false);
      },
      () => setGeolocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [emit]);

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
          <input type="text" value={lat} onChange={(e) => emit({ lat: e.target.value, lng })}
            onBlur={handleLatLngBlur} placeholder="e.g. 37.7749" className={INPUT_CLASS} />
        </div>
        <div>
          <label className="text-xs font-medium text-content-secondary">Longitude</label>
          <input type="text" value={lng} onChange={(e) => emit({ lat, lng: e.target.value })}
            onBlur={handleLatLngBlur} placeholder="e.g. -122.4194" className={INPUT_CLASS} />
        </div>
      </div>
    </div>
  );
}
