import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import MapGL, { NavigationControl } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";
import { cellToLatLng } from "h3-js";
import { XMarkIcon } from "@heroicons/react/24/outline";
import useDarkMode from "../lib/useDarkMode.js";
import CopyButton from "../components/CopyButton.jsx";
import { Dot } from "./cards/primitives.jsx";
import {
  deviceLabel,
  isEarning,
  fmtDate,
  fmtToken,
  lifetimeUi,
  iotStatusOf,
  IOT_STATUS_LABEL,
  IOT_STATUS_COLOR,
  NETWORK_COLOR,
  accountUrl,
} from "./format.js";

const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Dot colors derive from the shared network palette so they match the card
// chips/bars (single source of truth in format.js).
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const IOT_COLOR = hexToRgb(NETWORK_COLOR.iot);
const MOBILE_COLOR = hexToRgb(NETWORK_COLOR.mobile);
const IDLE_COLOR = [148, 163, 184]; // map-only "idle" state, no card equivalent
const INACTIVE_COLOR = hexToRgb(IOT_STATUS_COLOR.inactive);

const INITIAL_VIEW = { longitude: -98.5, latitude: 39.8, zoom: 3.2, pitch: 0, bearing: 0 };

/** Decode an H3 hex cell index to [lat, lng]; null on failure. */
function h3HexToLatLng(hex) {
  try {
    return cellToLatLng(hex);
  } catch {
    return null;
  }
}

export default function FleetMap({
  hotspots = [],
  rewardsByKey = {},
  iotStatusByKey = {},
  iotDataThrough = null,
  wallet = null,
}) {
  const dark = useDarkMode();
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [selected, setSelected] = useState(null); // entityKey
  const fittedRef = useRef(null);

  // Decode coordinates once per fleet.
  const mappable = useMemo(() => {
    const out = [];
    for (const h of hotspots) {
      if (!h.location) continue;
      const coords = h3HexToLatLng(h.location);
      if (coords) out.push({ ...h, coords });
    }
    return out;
  }, [hotspots]);

  // Hotspots known to be idle (zero lifetime rewards) get dimmed.
  const idleSet = useMemo(() => {
    const s = new Set();
    for (const [key, rewards] of Object.entries(rewardsByKey)) {
      if (isEarning(rewards) === false) s.add(key);
    }
    return s;
  }, [rewardsByKey]);

  // IoT Hotspots the liveness feed marked inactive — highlighted over the idle
  // dimming (an offline Hotspot is the most actionable thing on this map).
  // Membership usually doesn't change on a status flush, so reuse the previous
  // Set when it's equal — a fresh identity would rebuild the deck.gl layer and
  // re-run getFillColor for every point.
  const prevInactiveRef = useRef(new Set());
  const inactiveSet = useMemo(() => {
    const next = new Set();
    for (const h of hotspots) {
      if (iotStatusOf(h, iotStatusByKey[h.entityKey], iotDataThrough) === "inactive") {
        next.add(h.entityKey);
      }
    }
    const prev = prevInactiveRef.current;
    if (next.size === prev.size && [...next].every((k) => prev.has(k))) return prev;
    prevInactiveRef.current = next;
    return next;
  }, [hotspots, iotStatusByKey, iotDataThrough]);

  // Fit to bounds once per wallet (keyed on wallet+size, so switching to another
  // wallet re-centers even if it has the same Hotspot count) without fighting pan/zoom.
  useEffect(() => {
    if (mappable.length === 0) return;
    const sig = `${wallet}:${mappable.length}`;
    if (fittedRef.current === sig) return;
    fittedRef.current = sig;

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const h of mappable) {
      const [lat, lng] = h.coords;
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
    if (mappable.length === 1) {
      setViewState((p) => ({ ...p, latitude: minLat, longitude: minLng, zoom: 12, transitionDuration: 800 }));
    } else {
      const span = Math.max(maxLat - minLat, maxLng - minLng) || 0.1;
      const zoom = Math.max(1, Math.min(15, Math.log2(360 / (span * 1.6))));
      setViewState((p) => ({
        ...p,
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        zoom,
        transitionDuration: 800,
      }));
    }
  }, [mappable, wallet]);

  const layers = useMemo(
    () => [
      new ScatterplotLayer({
        id: "fleet",
        data: mappable,
        getPosition: (d) => [d.coords[1], d.coords[0]],
        getFillColor: (d) =>
          inactiveSet.has(d.entityKey)
            ? INACTIVE_COLOR
            : idleSet.has(d.entityKey)
              ? IDLE_COLOR
              : d.network === "mobile"
                ? MOBILE_COLOR
                : IOT_COLOR,
        getLineColor: (d) => (d.entityKey === selected ? [255, 255, 255] : [255, 255, 255, 150]),
        getRadius: (d) => (d.entityKey === selected ? 7 : 4),
        radiusMinPixels: 3,
        radiusMaxPixels: 11,
        lineWidthMinPixels: 1,
        stroked: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [14, 165, 233, 120],
        onClick: (info) => info.object && setSelected(info.object.entityKey),
        updateTriggers: {
          getFillColor: [idleSet, inactiveSet],
          getLineColor: [selected],
          getRadius: [selected],
        },
      }),
    ],
    [mappable, idleSet, inactiveSet, selected],
  );

  const selectedHotspot = useMemo(
    () => (selected ? mappable.find((h) => h.entityKey === selected) : null),
    [selected, mappable],
  );

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-surface-inset">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs)}
        layers={layers}
        controller={true}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <MapGL mapStyle={dark ? BASEMAP_DARK : BASEMAP_LIGHT}>
          <NavigationControl position="top-right" showCompass={false} />
        </MapGL>
      </DeckGL>

      {/* Legend */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-lg bg-surface-raised/90 px-3 py-2 text-xs shadow-soft backdrop-blur">
        <LegendRow color={`rgb(${IOT_COLOR.join(",")})`} label="IoT" />
        <LegendRow color={`rgb(${MOBILE_COLOR.join(",")})`} label="Mobile" />
        {inactiveSet.size > 0 && (
          <LegendRow color={`rgb(${INACTIVE_COLOR.join(",")})`} label="Inactive (IoT)" />
        )}
        {idleSet.size > 0 && <LegendRow color={`rgb(${IDLE_COLOR.join(",")})`} label="Idle (no rewards)" />}
      </div>

      {hotspots.length > 0 && mappable.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-lg bg-surface-raised/90 px-3 py-2 text-xs text-content-tertiary shadow-soft backdrop-blur">
            None of this wallet&apos;s Hotspots have an asserted location.
          </span>
        </div>
      )}

      {selectedHotspot && (
        <FleetMapDetail
          hotspot={selectedHotspot}
          rewards={rewardsByKey[selectedHotspot.entityKey]}
          iotStatus={iotStatusOf(
            selectedHotspot,
            iotStatusByKey[selectedHotspot.entityKey],
            iotDataThrough,
          )}
          iotDataThrough={iotDataThrough}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function LegendRow({ color, label }) {
  return (
    <span className="flex items-center gap-1.5 text-content-secondary">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function FleetMapDetail({ hotspot, rewards, iotStatus, iotDataThrough, onClose }) {
  const earning = isEarning(rewards);
  // Resolved verdicts only — "pending" (scan running) and null (non-IoT) have
  // no label and stay quiet.
  const showStatus = iotStatus in IOT_STATUS_LABEL;
  return (
    <div className="absolute bottom-3 left-3 right-3 max-w-sm rounded-xl bg-surface-raised/95 p-3 text-sm shadow-lg backdrop-blur sm:right-auto">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-content">{hotspot.name || "Unnamed Hotspot"}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-content-tertiary">
            <span>{deviceLabel(hotspot.deviceType)}</span>
            {showStatus && (
              <span className="inline-flex items-center gap-1">
                <Dot color={IOT_STATUS_COLOR[iotStatus]} />
                {IOT_STATUS_LABEL[iotStatus]}
                {(iotStatus === "active" || iotStatus === "inactive") && iotDataThrough
                  ? ` as of ${fmtDate(iotDataThrough)}`
                  : ""}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-content-tertiary hover:text-content-secondary"
          aria-label="Close"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {(hotspot.city || hotspot.state) && (
        <div className="mt-1.5 text-xs text-content-secondary">
          {[hotspot.city, hotspot.state, hotspot.country].filter(Boolean).join(", ")}
        </div>
      )}

      {rewards && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {earning === false ? (
            <span className="text-content-tertiary">No lifetime rewards</span>
          ) : (
            ["hnt", "iot", "mobile"].map((t) => {
              const ui = lifetimeUi(rewards, t);
              if (!ui) return null;
              return (
                <span key={t} className="text-content-secondary">
                  {fmtToken(ui, { max: 2 })}{" "}
                  <span className="text-content-tertiary">{t.toUpperCase()} lifetime</span>
                </span>
              );
            })
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-content-tertiary">
        <span className="truncate font-mono">{hotspot.entityKey}</span>
        <CopyButton text={hotspot.entityKey} />
        {hotspot.assetId && (
          <a
            href={accountUrl(hotspot.assetId)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 text-accent-text hover:underline"
          >
            Explorer
          </a>
        )}
      </div>
    </div>
  );
}
