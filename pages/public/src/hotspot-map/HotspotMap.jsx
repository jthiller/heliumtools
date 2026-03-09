import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import MapGL, { NavigationControl } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer, PolygonLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  MagnifyingGlassIcon,
  MapPinIcon,
  XMarkIcon,
  CheckIcon,
  ArrowLeftIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentCheckIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";
import MiddleEllipsis from "react-middle-ellipsis";
import { resolveLocations, fetchWalletHotspots, fetchEntityDates } from "../lib/hotspotMapApi.js";
import { h3ToLatLng } from "../lib/h3.js";
import { encodeKeys, decodeKeys } from "../lib/urlCompression.js";

const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function useBasemapStyle() {
  const [style, setStyle] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? BASEMAP_DARK : BASEMAP_LIGHT
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => setStyle(e.matches ? BASEMAP_DARK : BASEMAP_LIGHT);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return style;
}

const IOT_COLOR = [16, 185, 129];
const MOBILE_COLOR = [139, 92, 246];

const INITIAL_VIEW = {
  longitude: -98.5,
  latitude: 39.8,
  zoom: 3.5,
  pitch: 0,
  bearing: 0,
};

const RESOLVE_CHUNK_SIZE = 500;

const INPUT_CLASS =
  "block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

const COVERAGE_RADIUS_FT = 300;
const COVERAGE_RADIUS_M = COVERAGE_RADIUS_FT * 0.3048;
const COVERAGE_ARC_DEG = 120;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatDate(iso) {
  return dateFormatter.format(new Date(iso));
}

/**
 * Build a sector polygon (fan shape) in [lng, lat] coords.
 * azimuthDeg: center direction in degrees (0 = north, clockwise).
 * Returns array of [lng, lat] forming a closed polygon.
 */
function buildSectorPolygon(lat, lng, radiusM, azimuthDeg, arcDeg, steps = 24) {
  const toRad = Math.PI / 180;
  const R = 6371000; // Earth radius in meters
  const startBearing = azimuthDeg - arcDeg / 2;
  const points = [[lng, lat]]; // center
  for (let i = 0; i <= steps; i++) {
    const bearing = (startBearing + (arcDeg * i) / steps) * toRad;
    const lat1 = lat * toRad;
    const lng1 = lng * toRad;
    const d = radiusM / R;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
      );
    points.push([lng2 / toRad, lat2 / toRad]);
  }
  points.push([lng, lat]); // close
  return points;
}

// -- Validation --

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function isValidEntityKey(key) {
  if (!key || typeof key !== "string") return false;
  const trimmed = key.trim();
  if (trimmed.length < 20 || trimmed.length > 500) return false;
  return BASE58_RE.test(trimmed);
}

function isValidWalletAddress(addr) {
  if (!addr || typeof addr !== "string") return false;
  const trimmed = addr.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  return BASE58_RE.test(trimmed);
}

// -- Merge dual-network Hotspots by entity key --

function networkDetailsFor(h) {
  return {
    elevation: h.elevation,
    gain: h.gain,
    azimuth: h.azimuth,
    mechanicalDownTilt: h.mechanicalDownTilt,
    electricalDownTilt: h.electricalDownTilt,
    deviceType: h.deviceType,
  };
}

function mergeByEntityKey(items) {
  const map = new Map();
  for (const h of items) {
    const existing = map.get(h.entityKey);
    if (existing) {
      if (h.network && !existing.networks.includes(h.network)) {
        existing.networks.push(h.network);
      }
      if (h.network) {
        existing.networkDetails[h.network] = networkDetailsFor(h);
      }
      if (!existing.coords && h.coords) {
        existing.coords = h.coords;
        existing.location = h.location;
      }
      if (!existing.owner && h.owner) {
        existing.owner = h.owner;
      }
    } else {
      map.set(h.entityKey, {
        entityKey: h.entityKey,
        networks: [h.network].filter(Boolean),
        networkDetails: h.network ? { [h.network]: networkDetailsFor(h) } : {},
        location: h.location,
        coords: h.coords,
        name: h.name,
        owner: h.owner,
        label: h.label,
      });
    }
  }
  return [...map.values()];
}

// -- Utilities --

function Spinner({ className = "h-4 w-4" }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function NetworkBadge({ networks }) {
  const list = Array.isArray(networks) ? networks : networks ? [networks] : [];
  return (
    <>
      {list.includes("iot") && (
        <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-100 dark:ring-emerald-800/50">
          IoT
        </span>
      )}
      {list.includes("mobile") && (
        <span className="inline-flex items-center rounded-full bg-violet-50 dark:bg-violet-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400 ring-1 ring-violet-100 dark:ring-violet-800/50">
          Mobile
        </span>
      )}
    </>
  );
}

function LabelBadge({ label }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-[10px] font-medium text-content-secondary ring-1 ring-border max-w-[120px] truncate">
      {label}
    </span>
  );
}

function hotspotId(h) {
  return h.entityKey;
}

function truncateKey(key, chars = 4) {
  if (!key || key.length <= chars * 2 + 3) return key;
  return `${key.slice(0, chars)}...${key.slice(-chars)}`;
}

// -- Sub-components --

function TabToggle({ mode, onChange }) {
  return (
    <div className="flex rounded-lg bg-surface-inset p-1">
      {[
        { key: "keys", label: "Entity Keys" },
        { key: "wallet", label: "Wallet" },
      ].map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition ${
            mode === tab.key
              ? "bg-surface-raised text-content shadow-sm"
              : "text-content-secondary hover:text-content"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ProgressBar({ done, total }) {
  if (total === 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex-1 h-[3px] rounded-full bg-surface-inset overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-content-tertiary tabular-nums shrink-0">
        {done} / {total}
      </span>
    </div>
  );
}

function HotspotListRow({ hotspot, isSelected, onClick }) {
  const hasLocation = !!hotspot.coords;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2.5 px-4 py-2.5 border-b border-border-muted transition hover:bg-surface-inset ${
        isSelected ? "bg-accent-surface border-l-2 border-l-accent" : ""
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${hasLocation ? "text-content" : "text-content-tertiary"}`}>
            {hotspot.name || "Unknown Hotspot"}
          </span>
          <NetworkBadge networks={hotspot.networks} />
          <LabelBadge label={hotspot.label} />
        </div>
        <p className={`text-xs mt-0.5 ${hasLocation ? "text-content-tertiary" : "text-content-tertiary italic"}`}>
          {hasLocation
            ? `${hotspot.coords[0].toFixed(4)},  ${hotspot.coords[1].toFixed(4)}`
            : "No location asserted"}
        </p>
      </div>
      <span className="text-[10px] text-content-tertiary font-mono shrink-0">
        {truncateKey(hotspot.entityKey)}
      </span>
    </button>
  );
}

function CopyableRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-content-tertiary shrink-0">{label}</span>
      <div className="flex-1 min-w-0">
        <MiddleEllipsis>
          <span className="text-xs font-mono text-content-secondary" title={value}>{value}</span>
        </MiddleEllipsis>
      </div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="shrink-0 rounded p-1 text-content-tertiary hover:text-content-secondary hover:bg-surface-inset transition"
        title={`Copy ${label.toLowerCase()}`}
      >
        {copied
          ? <ClipboardDocumentCheckIcon className="h-3.5 w-3.5 text-emerald-500" />
          : <ClipboardDocumentIcon className="h-3.5 w-3.5" />
        }
      </button>
    </div>
  );
}

function HotspotDetail({ hotspot }) {
  const [dates, setDates] = useState(null);

  useEffect(() => {
    let stale = false;
    fetchEntityDates(hotspot.entityKey)
      .then((d) => { if (!stale) setDates(d); })
      .catch(() => {});
    return () => { stale = true; };
  }, [hotspot.entityKey]);

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Name + badges */}
      <div className="flex items-center gap-2 min-w-0">
        <h3 className="text-sm font-semibold text-content truncate">
          {hotspot.name || truncateKey(hotspot.entityKey, 8)}
        </h3>
        <NetworkBadge networks={hotspot.networks} />
        <LabelBadge label={hotspot.label} />
      </div>

      <CopyableRow label="Key" value={hotspot.entityKey} />
      {hotspot.owner && <CopyableRow label="Owner" value={hotspot.owner} />}

      {/* Per-network metadata sections */}
      {hotspot.networks.map((net) => {
        const d = hotspot.networkDetails[net];
        if (!d) return null;
        const hasAnyMeta =
          d.elevation != null ||
          d.gain != null ||
          d.azimuth != null ||
          (d.mechanicalDownTilt != null && d.mechanicalDownTilt !== 0) ||
          (d.electricalDownTilt != null && d.electricalDownTilt !== 0) ||
          d.deviceType;
        if (!hasAnyMeta && !dates?.[net]) return null;
        return (
          <div key={net} className="space-y-1.5">
            {hotspot.networks.length > 1 && (
              <NetworkBadge networks={[net]} />
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-content-secondary">
              {d.elevation != null && (
                <span>Elevation: <strong className="text-content-secondary">{d.elevation}m</strong></span>
              )}
              {d.gain != null && (
                <span>Gain: <strong className="text-content-secondary">{(d.gain / 10).toFixed(1)} dBi</strong></span>
              )}
              {d.azimuth != null && (
                <span>Azimuth: <strong className="text-content-secondary">{d.azimuth}°</strong></span>
              )}
              {d.mechanicalDownTilt != null && d.mechanicalDownTilt !== 0 && (
                <span>Mech. tilt: <strong className="text-content-secondary">{d.mechanicalDownTilt}°</strong></span>
              )}
              {d.electricalDownTilt != null && d.electricalDownTilt !== 0 && (
                <span>Elec. tilt: <strong className="text-content-secondary">{d.electricalDownTilt}°</strong></span>
              )}
              {d.deviceType && (
                <span className="text-content-tertiary">{d.deviceType}</span>
              )}
              {dates?.[net] && (
                <span>Onboarded: <strong className="text-content-secondary">{formatDate(dates[net])}</strong></span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DetailCard({ hotspots, onClose }) {
  if (!hotspots || hotspots.length === 0) return null;
  const primary = hotspots[0];
  const hasCoords = !!primary.coords;
  const h3Hex = primary.location
    ? BigInt(primary.location).toString(16)
    : null;

  return (
    <div className="rounded-xl border border-border bg-surface-raised shadow-soft overflow-hidden max-h-[40vh] md:max-h-[60vh] overflow-y-auto">
      {/* Shared location header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-border-muted">
        <div className="space-y-1.5">
          {hasCoords && (
            <div className="flex items-center gap-2">
              <MapPinIcon className="h-4 w-4 text-content-tertiary shrink-0" />
              <p className="text-sm font-mono text-content">
                {primary.coords[0].toFixed(4)},  {primary.coords[1].toFixed(4)}
              </p>
            </div>
          )}
          {h3Hex && (
            <p className="text-[10px] font-mono text-content-tertiary ml-6">{h3Hex}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-content-tertiary hover:text-content-secondary hover:bg-surface-inset transition"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Per-Hotspot sections */}
      {hotspots.map((h, i) => (
        <div key={hotspotId(h)} className={i > 0 ? "border-t border-border-muted" : ""}>
          <HotspotDetail hotspot={h} />
        </div>
      ))}
    </div>
  );
}

function MapTooltip({ hotspot, tooltipRef, initialPos }) {
  if (!hotspot) return null;
  return (
    <div
      ref={tooltipRef}
      className="pointer-events-none absolute z-50 rounded-lg border border-border bg-surface-raised px-3 py-2 shadow-lg"
      style={{ left: initialPos.x + 12, top: initialPos.y - 12 }}
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-content">
          {hotspot.name || truncateKey(hotspot.entityKey, 8)}
        </p>
        <NetworkBadge networks={hotspot.networks} />
        <LabelBadge label={hotspot.label} />
      </div>
      {hotspot.coords && (
        <p className="text-xs text-content-tertiary mt-0.5 font-mono">
          {hotspot.coords[0].toFixed(4)}, {hotspot.coords[1].toFixed(4)}
        </p>
      )}
      <p className="text-[10px] text-content-tertiary font-mono mt-0.5">
        {truncateKey(hotspot.entityKey, 12)}
      </p>
    </div>
  );
}

function WalletPreviewRow({ item, isChecked, isOnMap, onToggle }) {
  const noLocation = item.networks.length === 0;
  const disabled = isOnMap || noLocation;
  return (
    <label
      className={`flex items-center gap-2.5 px-4 py-2.5 border-b border-border-muted transition ${
        disabled
          ? "opacity-50 cursor-default"
          : "cursor-pointer hover:bg-surface-inset"
      }`}
    >
      <input
        type="checkbox"
        checked={isChecked}
        disabled={disabled}
        onChange={onToggle}
        className="h-4 w-4 rounded border-border text-accent focus:ring-accent/20 disabled:opacity-40"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${disabled ? "text-content-tertiary" : "text-content"}`}>
            {item.name || "Unknown Hotspot"}
          </span>
          <NetworkBadge networks={item.networks} />
          {isOnMap && (
            <span className="text-[10px] text-content-tertiary italic">Already on map</span>
          )}
          {noLocation && (
            <span className="text-[10px] text-amber-600 italic">No Location</span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-content-tertiary font-mono shrink-0">
        {truncateKey(item.entityKey)}
      </span>
    </label>
  );
}

function WalletPreview({ results, selected, onSelectedChange, label, onLabelChange, onAdd, onBack, existingIds, resolving }) {
  let iotCount = 0, mobileCount = 0, selectableCount = 0;
  const isSelectable = (h) => !existingIds.has(hotspotId(h)) && h.networks.length > 0;
  for (const h of results) {
    if (h.networks.includes("iot")) iotCount++;
    if (h.networks.includes("mobile")) mobileCount++;
    if (isSelectable(h)) selectableCount++;
  }
  const selectedCount = selected.size;

  const handleSelectAll = () => {
    const allSelectable = new Set(
      results.filter(isSelectable).map((h) => hotspotId(h))
    );
    onSelectedChange(allSelectable);
  };

  const handleDeselectAll = () => {
    onSelectedChange(new Set());
  };

  const allSelected = selectedCount === selectableCount && selectableCount > 0;

  return (
    <div className="pointer-events-auto rounded-xl border border-border bg-surface-raised shadow-soft overflow-hidden flex flex-col max-h-[480px]">
      {/* Success banner */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-100">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/400 shrink-0">
          <CheckIcon className="h-3.5 w-3.5 text-white" strokeWidth={3} />
        </div>
        <p className="text-sm font-medium text-emerald-800">
          Found {results.length} hotspot{results.length !== 1 ? "s" : ""}
          {(iotCount > 0 || mobileCount > 0) && (
            <span className="text-emerald-600 font-normal">
              {" "}({[iotCount > 0 && `${iotCount} IoT`, mobileCount > 0 && `${mobileCount} Mobile`].filter(Boolean).join(", ")})
            </span>
          )}
        </p>
      </div>

      {/* Label input */}
      <div className="px-4 py-3 border-b border-border-muted">
        <label className="block text-xs text-content-secondary mb-1.5">
          Label (optional)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="block w-full rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          placeholder="e.g. My Hotspots"
        />
      </div>

      {/* Hotspot list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {results.map((item) => {
          const id = hotspotId(item);
          const isOnMap = existingIds.has(id);
          return (
            <WalletPreviewRow
              key={id}
              item={item}
              isChecked={!isOnMap && selected.has(id)}
              isOnMap={isOnMap}
              onToggle={() => {
                const next = new Set(selected);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                onSelectedChange(next);
              }}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border-muted bg-surface-inset">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-inset transition"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back
        </button>
        <button
          onClick={allSelected ? handleDeselectAll : handleSelectAll}
          className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-inset transition"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>
        <button
          onClick={onAdd}
          disabled={selectedCount === 0 || resolving}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {resolving ? <Spinner /> : null}
          {resolving ? "Resolving..." : `Add ${selectedCount} to Map`}
        </button>
      </div>
    </div>
  );
}

// -- Main Component --

export default function HotspotMap() {
  const mapStyle = useBasemapStyle();
  const [mode, setMode] = useState("keys");
  const [keysInput, setKeysInput] = useState("");
  const [walletInput, setWalletInput] = useState("");
  const [hotspots, setHotspots] = useState([]);
  const [resolving, setResolving] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [selectedHotspot, setSelectedHotspot] = useState(null);
  const [hoveredHotspot, setHoveredHotspot] = useState(null);
  const hoverPosRef = useRef({ x: 0, y: 0 });
  const tooltipRef = useRef(null);
  const [networkFilter, setNetworkFilter] = useState("all");
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [walletResults, setWalletResults] = useState(null);
  const [walletSelected, setWalletSelected] = useState(new Set());
  const [walletLabel, setWalletLabel] = useState("");
  const walletCountRef = useRef(0);

  // Share URL state
  const [, setSearchParams] = useSearchParams();
  const [shareState, setShareState] = useState("idle"); // "idle" | "copied" | "warning"

  // Mobile responsive state
  const [isMobile, setIsMobile] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    setIsMobile(mql.matches);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Pulse animation for selected Hotspot (~30fps)
  const [pulseT, setPulseT] = useState(0);
  useEffect(() => {
    if (!selectedHotspot) return;
    const interval = setInterval(() => setPulseT(Date.now()), 33);
    return () => clearInterval(interval);
  }, [selectedHotspot]);

  const displayHotspots = useMemo(() => {
    if (networkFilter === "all") return hotspots;
    return hotspots.filter((h) => h.networks.includes(networkFilter));
  }, [hotspots, networkFilter]);

  const mappableHotspots = useMemo(
    () => displayHotspots.filter((h) => h.coords),
    [displayHotspots]
  );

  const stats = useMemo(() => {
    let iot = 0, mobile = 0;
    for (const h of hotspots) {
      if (h.networks.includes("iot")) iot++;
      if (h.networks.includes("mobile")) mobile++;
    }
    return { iot, mobile, total: hotspots.length };
  }, [hotspots]);

  // All Hotspots sharing the same H3 location as the selected one
  const selectedGroup = useMemo(() => {
    if (!selectedHotspot) return [];
    const primary = hotspots.find((h) => h.entityKey === selectedHotspot);
    if (!primary) return [];
    if (!primary.location) return [primary];
    return hotspots.filter((h) => h.location === primary.location);
  }, [hotspots, selectedHotspot]);

  // Fit map to Hotspot bounds
  const fitBounds = useCallback((hotspotsWithCoords) => {
    if (hotspotsWithCoords.length === 0) return;

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const h of hotspotsWithCoords) {
      const [lat, lng] = h.coords;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    if (hotspotsWithCoords.length === 1) {
      setViewState((prev) => ({ ...prev, latitude: minLat, longitude: minLng, zoom: 14, transitionDuration: 1000 }));
    } else {
      const centerLat = (minLat + maxLat) / 2;
      const centerLng = (minLng + maxLng) / 2;
      const span = Math.max(maxLat - minLat, maxLng - minLng);
      const zoom = Math.max(1, Math.min(18, Math.log2(360 / (span * 1.5))));
      setViewState((prev) => ({ ...prev, latitude: centerLat, longitude: centerLng, zoom, transitionDuration: 1000 }));
    }
  }, []);

  // Resolve entity keys → locations
  const resolveKeys = useCallback(
    async (entityKeys, nameMap = null, label = null) => {
      setResolving(true);
      setError(null);
      setProgress({ done: 0, total: entityKeys.length });

      const allHotspots = [];
      try {
        for (let i = 0; i < entityKeys.length; i += RESOLVE_CHUNK_SIZE) {
          const chunk = entityKeys.slice(i, i + RESOLVE_CHUNK_SIZE);
          const result = await resolveLocations(chunk);

          for (const h of result.hotspots) {
            let coords = null;
            if (h.location) {
              const latLng = h3ToLatLng(h.location);
              if (latLng) coords = latLng;
            }
            allHotspots.push({
              entityKey: h.entityKey,
              network: h.network,
              elevation: h.elevation,
              gain: h.gain,
              deviceType: h.deviceType,
              azimuth: h.azimuth,
              mechanicalDownTilt: h.mechanicalDownTilt,
              electricalDownTilt: h.electricalDownTilt,
              location: h.location,
              coords,
              name: nameMap?.get(h.entityKey) || h.name || null,
              owner: h.owner || null,
              label,
            });
          }
          setProgress({ done: Math.min(i + chunk.length, entityKeys.length), total: entityKeys.length });
        }

        const merged = mergeByEntityKey(allHotspots);

        setHotspots((prev) => {
          const existing = new Set(prev.map((h) => hotspotId(h)));
          const newOnes = merged.filter((h) => !existing.has(hotspotId(h)));
          return [...prev, ...newOnes];
        });

        if (merged.some((h) => h.coords)) {
          fitBounds(merged.filter((h) => h.coords));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setResolving(false);
        setProgress({ done: 0, total: 0 });
        setMobileExpanded(false);
      }
    },
    [fitBounds]
  );

  const handleLoadKeys = useCallback(() => {
    const keys = keysInput
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    const valid = keys.filter(isValidEntityKey);
    if (valid.length === 0) {
      setError("No valid entity keys found. Check your input.");
      return;
    }
    resolveKeys(valid);
  }, [keysInput, resolveKeys]);

  // Load shared keys from URL on mount
  useEffect(() => {
    const encoded = new URLSearchParams(window.location.search).get("keys");
    if (!encoded) return;

    // Strip the param from URL without adding a history entry
    setSearchParams({}, { replace: true });

    (async () => {
      try {
        const decoded = await decodeKeys(encoded);
        const valid = decoded.filter(isValidEntityKey);
        if (valid.length === 0) {
          setError("Shared link contained no valid entity keys.");
          return;
        }
        setKeysInput(valid.join("\n"));
        resolveKeys(valid);
      } catch {
        setError("Failed to decode shared link.");
      }
    })();
  }, [setSearchParams, resolveKeys]);

  // Precompute share URL whenever hotspots change (so clipboard write can be synchronous)
  const [shareUrl, setShareUrl] = useState(null);
  useEffect(() => {
    if (hotspots.length === 0) {
      setShareUrl(null);
      return;
    }
    let cancelled = false;
    encodeKeys(hotspots.map((h) => h.entityKey)).then((encoded) => {
      if (!cancelled) {
        setShareUrl(`${window.location.origin}/hotspot-map?keys=${encoded}`);
      }
    });
    return () => { cancelled = true; };
  }, [hotspots]);

  // Auto-reset share state after feedback
  useEffect(() => {
    if (shareState === "idle") return;
    const id = setTimeout(() => setShareState("idle"), 3000);
    return () => clearTimeout(id);
  }, [shareState]);

  // Share button handler — no async work before clipboard write
  const handleShare = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setShareState(shareUrl.length > 2000 ? "warning" : "copied");
  }, [shareUrl]);

  const existingHotspotIds = useMemo(
    () => new Set(hotspots.map((h) => hotspotId(h))),
    [hotspots]
  );

  const handleLookupWallet = useCallback(async () => {
    const address = walletInput.trim();
    if (!isValidWalletAddress(address)) {
      setError("Invalid Solana wallet address.");
      return;
    }

    setWalletLoading(true);
    setError(null);

    try {
      const result = await fetchWalletHotspots(address);

      if (result.hotspots.length === 0) {
        setError("No Helium Hotspots found for this wallet.");
        setWalletLoading(false);
        return;
      }

      // Merge dual-network entries before preview
      const merged = mergeByEntityKey(result.hotspots);

      // Populate preview instead of resolving immediately
      const defaultLabel = `Wallet ${walletCountRef.current + 1}`;
      setWalletLabel(defaultLabel);
      setWalletResults(merged);

      // Pre-select all Hotspots that aren't already on the map and have a location
      const preSelected = new Set(
        merged
          .filter((h) => !existingHotspotIds.has(hotspotId(h)) && h.networks.length > 0)
          .map((h) => hotspotId(h))
      );
      setWalletSelected(preSelected);
      setWalletLoading(false);
    } catch (err) {
      setError(err.message);
      setWalletLoading(false);
    }
  }, [walletInput, existingHotspotIds]);

  const handleAddToMap = useCallback(async () => {
    if (!walletResults || walletSelected.size === 0) return;

    walletCountRef.current += 1;
    const selectedItems = walletResults.filter((h) => walletSelected.has(hotspotId(h)));
    const entityKeys = [...new Set(selectedItems.map((h) => h.entityKey))];
    const nameMap = new Map(selectedItems.map((h) => [h.entityKey, h.name]));
    const label = walletLabel.trim() || null;

    // Reset preview state
    setWalletResults(null);
    setWalletSelected(new Set());
    setWalletInput("");

    await resolveKeys(entityKeys, nameMap, label);
  }, [walletResults, walletSelected, walletLabel, resolveKeys]);

  const handleDismissPreview = useCallback(() => {
    setWalletResults(null);
    setWalletSelected(new Set());
    setWalletLabel("");
  }, []);

  const flyToHotspot = useCallback((hotspot) => {
    setSelectedHotspot(hotspot.entityKey);
    setMobileExpanded(true);
    if (hotspot.coords) {
      setViewState((prev) => ({
        ...prev,
        latitude: hotspot.coords[0],
        longitude: hotspot.coords[1],
        zoom: 14,
        transitionDuration: 800,
      }));
    }
  }, []);

  const handleClear = useCallback(() => {
    setHotspots([]);
    setSelectedHotspot(null);
    setError(null);
    setKeysInput("");
    setWalletInput("");
    setWalletResults(null);
    setWalletSelected(new Set());
    setWalletLabel("");
    walletCountRef.current = 0;
    setNetworkFilter("all");
    setViewState(INITIAL_VIEW);
    setMobileExpanded(false);
  }, []);

  // Deck.gl layers
  const selectedEntityKeys = useMemo(
    () => new Set(selectedGroup.map((h) => h.entityKey)),
    [selectedGroup]
  );

  const selectedData = useMemo(
    () => mappableHotspots.filter((d) => selectedEntityKeys.has(d.entityKey)),
    [mappableHotspots, selectedEntityKeys]
  );

  // Coverage sector geometry — only recomputed when selection changes, not every frame
  const sectorData = useMemo(
    () =>
      selectedData.flatMap((h) => {
        if (!h.coords) return [];
        return Object.values(h.networkDetails)
          .filter((d) => d.deviceType === "wifiOutdoor" && d.azimuth != null)
          .map((d) => ({
            polygon: buildSectorPolygon(h.coords[0], h.coords[1], COVERAGE_RADIUS_M, d.azimuth, COVERAGE_ARC_DEG),
            primary: h.entityKey === selectedHotspot,
          }));
      }),
    [selectedData, selectedHotspot]
  );

  // Static layers — only rebuilt when data or selection changes
  const staticLayers = useMemo(() => {
    const result = [];

    // Coverage sectors
    if (sectorData.length > 0) {
      result.push(
        new PolygonLayer({
          id: "coverage",
          data: sectorData,
          getPolygon: (d) => d.polygon,
          getFillColor: (d) => d.primary ? [139, 92, 246, 60] : [139, 92, 246, 20],
          getLineColor: (d) => d.primary ? [139, 92, 246, 140] : [139, 92, 246, 60],
          lineWidthMinPixels: 1,
          filled: true,
          stroked: true,
        })
      );
    }

    // Main Hotspot dots
    result.push(
      new ScatterplotLayer({
        id: "hotspots",
        data: mappableHotspots,
        getPosition: (d) => [d.coords[1], d.coords[0]],
        getFillColor: (d) =>
          d.networks.includes("iot") ? IOT_COLOR : MOBILE_COLOR,
        getLineColor: (d) =>
          selectedEntityKeys.has(d.entityKey) ? [255, 255, 255] : [255, 255, 255, 180],
        getRadius: (d) => (selectedEntityKeys.has(d.entityKey) ? 7 : 5),
        radiusMinPixels: 4,
        radiusMaxPixels: 12,
        lineWidthMinPixels: 1.5,
        stroked: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [14, 165, 233, 100],
        onClick: (info) => {
          if (info.object) {
            setSelectedHotspot(info.object.entityKey);
            setMobileExpanded(true);
          }
        },
        updateTriggers: {
          getLineColor: [selectedEntityKeys],
          getRadius: [selectedEntityKeys],
        },
      })
    );

    return result;
  }, [mappableHotspots, selectedEntityKeys, sectorData]);

  // Pulse layer — rebuilt every frame (~30fps), kept separate from static layers
  const pulse = selectedHotspot ? (pulseT % 1500) / 1500 : 0;
  const pulseLayer = useMemo(() => {
    if (selectedData.length === 0) return [];
    const opacity = Math.round(160 * (1 - pulse));
    const color = selectedData[0].networks.includes("iot")
      ? [16, 185, 129, opacity]
      : [139, 92, 246, opacity];
    return [
      new ScatterplotLayer({
        id: "pulse",
        data: selectedData,
        getPosition: (d) => [d.coords[1], d.coords[0]],
        getFillColor: [0, 0, 0, 0],
        getLineColor: color,
        getRadius: 6 + 18 * pulse,
        radiusUnits: "pixels",
        lineWidthMinPixels: 2,
        stroked: true,
        filled: false,
      }),
    ];
  }, [selectedData, pulse]);

  const layers = useMemo(
    () => [...pulseLayer, ...staticLayers],
    [pulseLayer, staticLayers]
  );

  const onHover = useCallback((info) => {
    if (info.object) {
      hoverPosRef.current = { x: info.x, y: info.y };
      // Update position via DOM ref to avoid re-render on every mouse move
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${info.x + 12}px`;
        tooltipRef.current.style.top = `${info.y - 12}px`;
      }
      // Only trigger re-render when the hovered object changes
      setHoveredHotspot((prev) => (prev === info.object ? prev : info.object));
    } else {
      setHoveredHotspot(null);
    }
  }, []);

  const hasHotspots = hotspots.length > 0;

  return (
    <div className="flex flex-col h-screen bg-surface-inset">
      {/* Header */}
      <header className="bg-surface-raised border-b border-border shrink-0">
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4">
          <a href="/" className="flex items-center gap-2 md:gap-3 text-content hover:opacity-80">
            <div className="flex h-8 w-8 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent text-xs md:text-sm font-semibold text-white">
              HT
            </div>
            <span className="font-display text-sm md:text-[17px] font-semibold tracking-[-0.02em]">Helium Tools</span>
            <span className="text-[13px] text-content-tertiary hidden md:inline">Operator utilities</span>
          </a>
          <div className="flex items-center gap-4">
            {hasHotspots && (
              <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-iot" />
                  {stats.iot} IoT
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-mobile" />
                  {stats.mobile} Mobile
                </span>
                <span className="font-semibold text-content hidden md:inline">
                  {stats.total} hotspots
                </span>
              </div>
            )}
            {!hasHotspots && (
              <span className="text-sm font-semibold text-content">
                Hotspot Map
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Map + floating panels */}
      <div className="flex-1 relative overflow-hidden">
        {/* Map fills entire area */}
        <DeckGL
          viewState={viewState}
          onViewStateChange={({ viewState: vs }) => setViewState(vs)}
          layers={layers}
          onHover={onHover}
          controller={true}
          getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
        >
          <MapGL mapStyle={mapStyle}>
            <NavigationControl position={isMobile ? "top-left" : "top-right"} />
          </MapGL>
        </DeckGL>

        {/* Hover tooltip (desktop only — no hover on touch) */}
        {!isMobile && hoveredHotspot && (
          <MapTooltip
            hotspot={hoveredHotspot}
            tooltipRef={tooltipRef}
            initialPos={hoverPosRef.current}
          />
        )}

        {/* === Shared panel sections (used by both desktop + mobile) === */}
        {(() => {
          const detailPanel = selectedGroup.length > 0 && (
            <DetailCard
              hotspots={selectedGroup}
              onClose={() => setSelectedHotspot(null)}
            />
          );

          const showInput = selectedGroup.length === 0 && !walletResults;

          const inputContent = showInput && (
            <div className="px-4 pt-3 pb-4 space-y-3">
              <TabToggle mode={mode} onChange={setMode} />

              {mode === "keys" && (
                <>
                  <div>
                    <label className="block text-xs text-content-secondary mb-1.5">
                      Paste entity keys, one per line
                    </label>
                    <textarea
                      value={keysInput}
                      onChange={(e) => setKeysInput(e.target.value)}
                      className={`${INPUT_CLASS} resize-none font-mono text-xs`}
                      rows={3}
                      placeholder={"112DN41Qw6YACUSc2q57vKH...\n143cUvMpimEbKHyjBXMDLWZ...\n11hbFBz7v4V8hfjoPT5dQrS..."}
                      disabled={resolving}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleLoadKeys}
                      disabled={resolving || !keysInput.trim()}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {resolving ? <Spinner /> : null}
                      Load Hotspots
                    </button>
                    {hasHotspots && (
                      <button
                        onClick={handleClear}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-content-secondary hover:bg-surface-inset transition"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </>
              )}

              {mode === "wallet" && !walletResults && (
                <>
                  <div>
                    <label className="block text-xs text-content-secondary mb-1.5">
                      Solana wallet address
                    </label>
                    <input
                      type="text"
                      value={walletInput}
                      onChange={(e) => setWalletInput(e.target.value)}
                      className={`${INPUT_CLASS} font-mono text-xs`}
                      placeholder="Af2uuGb4bis8KrfbDoyZevHPoQDBf4vNBNVyG5XfW2m"
                      disabled={walletLoading || resolving}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !walletLoading && !resolving) {
                          handleLookupWallet();
                        }
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleLookupWallet}
                      disabled={walletLoading || resolving || !walletInput.trim()}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {walletLoading ? <Spinner /> : <MagnifyingGlassIcon className="h-4 w-4" />}
                      {walletLoading ? "Looking up..." : "Search Wallet"}
                    </button>
                    {hasHotspots && (
                      <button
                        onClick={handleClear}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-content-secondary hover:bg-surface-inset transition"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </>
              )}

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-300">
                  {error}
                </div>
              )}
            </div>
          );

          // Desktop input panel wraps content in a card
          const inputPanel = showInput && (
            <div className="rounded-xl border border-border bg-surface-raised shadow-soft overflow-hidden">
              {inputContent}
            </div>
          );

          const walletPreviewPanel = walletResults && selectedGroup.length === 0 && (
            <WalletPreview
              results={walletResults}
              selected={walletSelected}
              onSelectedChange={setWalletSelected}
              label={walletLabel}
              onLabelChange={setWalletLabel}
              onAdd={handleAddToMap}
              onBack={handleDismissPreview}
              existingIds={existingHotspotIds}
              resolving={resolving}
            />
          );

          const showResults = hasHotspots || progress.total > 0;

          const resultsContent = showResults && (
            <>
              {progress.total > 0 && (
                <ProgressBar done={progress.done} total={progress.total} />
              )}

              {hasHotspots && (
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-muted">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-content-tertiary">
                    Hotspots
                  </span>
                  <button
                    onClick={() => fitBounds(hotspots.filter((h) => h.coords))}
                    className="text-[10px] text-content-tertiary hover:text-content-secondary transition"
                    title="Fit map to all Hotspots"
                  >
                    Fit all
                  </button>
                  <button
                    onClick={handleShare}
                    className={`flex items-center gap-1 text-[10px] transition ${
                      shareState === "copied"
                        ? "text-emerald-600"
                        : "text-content-tertiary hover:text-content-secondary"
                    }`}
                    title="Copy shareable link"
                  >
                    <LinkIcon className="h-3 w-3" />
                    {shareState === "copied" ? "Copied!" : "Share"}
                  </button>
                  <div className="flex items-center gap-1 ml-auto">
                    {[
                      { key: "all", label: `All ${stats.total}` },
                      { key: "iot", label: `IoT ${stats.iot}` },
                      { key: "mobile", label: `Mobile ${stats.mobile}` },
                    ].map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setNetworkFilter(f.key)}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium transition ${
                          networkFilter === f.key
                            ? "bg-accent text-white"
                            : "text-content-tertiary hover:text-content-secondary"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {shareState === "warning" && (
                <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700">
                  Link copied but is very long — may not work with all sharing tools.
                </div>
              )}
            </>
          );

          const resultsListContent = showResults && (
            <div className="flex-1 overflow-y-auto max-h-[35vh] md:max-h-[340px]">
              {displayHotspots.map((hotspot) => (
                <HotspotListRow
                  key={hotspotId(hotspot)}
                  hotspot={hotspot}
                  isSelected={selectedHotspot === hotspot.entityKey}
                  onClick={() => flyToHotspot(hotspot)}
                />
              ))}
            </div>
          );

          const resultsPanel = showResults && (
            <div className="rounded-xl border border-border bg-surface-raised shadow-soft overflow-hidden flex flex-col min-h-0">
              {resultsContent}
              {resultsListContent}
            </div>
          );

          return (
            <>
              {/* Desktop floating sidebar — unchanged layout */}
              <div className="hidden md:flex absolute top-4 left-4 bottom-4 w-[380px] flex-col gap-3 pointer-events-none z-10">
                {detailPanel && <div className="pointer-events-auto">{detailPanel}</div>}
                {inputPanel && <div className="pointer-events-auto">{inputPanel}</div>}
                {walletPreviewPanel && <div className="pointer-events-auto">{walletPreviewPanel}</div>}
                {resultsPanel && <div className="pointer-events-auto">{resultsPanel}</div>}
              </div>

              {/* Mobile bottom sheet */}
              <div className="md:hidden absolute bottom-0 left-0 right-0 z-10 pointer-events-auto">
                <div className="bg-surface-raised rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
                  {/* Handle bar */}
                  <div
                    onClick={() => {
                      if (hasHotspots || selectedGroup.length > 0 || walletResults) {
                        setMobileExpanded((v) => !v);
                      }
                    }}
                    className="flex justify-center py-2 cursor-pointer"
                  >
                    <div className="w-9 h-1 rounded-full bg-content-tertiary/40" />
                  </div>

                  {/* Collapsed summary (Hotspots loaded, sheet collapsed, no detail) */}
                  {!mobileExpanded && hasHotspots && selectedGroup.length === 0 && !walletResults && (
                    <div
                      onClick={() => setMobileExpanded(true)}
                      className="px-4 pb-3 flex items-center gap-2"
                    >
                      <span className="text-sm font-semibold text-emerald-600">
                        {hotspots.length} Hotspot{hotspots.length !== 1 ? "s" : ""}
                      </span>
                      <span className="text-xs text-content-tertiary">Tap to expand</span>
                    </div>
                  )}

                  {/* Expanded / active content */}
                  {(mobileExpanded || !hasHotspots || selectedGroup.length > 0 || walletResults) && (() => {
                    // Detail view with back button
                    if (selectedGroup.length > 0) {
                      return (
                        <div className="max-h-[50vh] overflow-y-auto">
                          <div className="flex items-center justify-between px-4 pb-2">
                            <button
                              onClick={() => setSelectedHotspot(null)}
                              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-secondary hover:text-content-secondary transition"
                            >
                              <ArrowLeftIcon className="h-3.5 w-3.5" />
                              Back to list
                            </button>
                            <NetworkBadge networks={selectedGroup[0]?.networks} />
                          </div>
                          <div className="border-t border-border-muted">
                            {selectedGroup.map((h, i) => (
                              <div key={hotspotId(h)} className={i > 0 ? "border-t border-border-muted" : ""}>
                                <HotspotDetail hotspot={h} />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }

                    // Wallet preview — render directly (WalletPreview has its own card styling)
                    if (walletResults) {
                      return (
                        <div className="max-h-[50vh] overflow-hidden [&>div]:border-0 [&>div]:shadow-none [&>div]:rounded-none">
                          {walletPreviewPanel}
                        </div>
                      );
                    }

                    // Input state (no Hotspots loaded yet)
                    if (!hasHotspots) {
                      return inputContent;
                    }

                    // Expanded results list
                    if (mobileExpanded) {
                      return (
                        <div className="max-h-[50vh] overflow-hidden flex flex-col">
                          {resultsContent}
                          <div className="flex-1 overflow-y-auto">{resultsListContent}</div>
                        </div>
                      );
                    }

                    return null;
                  })()}
                </div>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
