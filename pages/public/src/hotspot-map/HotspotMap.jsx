import { useState, useCallback, useRef, useMemo } from "react";
import MapGL, { NavigationControl } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  MagnifyingGlassIcon,
  MapPinIcon,
  XMarkIcon,
  CheckIcon,
  ArrowLeftIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentCheckIcon,
} from "@heroicons/react/24/outline";
import MiddleEllipsis from "react-middle-ellipsis";
import { resolveLocations, fetchWalletHotspots } from "../lib/hotspotMapApi.js";
import { h3ToLatLng } from "../lib/h3.js";

const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

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
  "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20";

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

// -- Utilities --

function Spinner({ className = "h-4 w-4" }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function NetworkBadge({ network }) {
  if (network === "iot") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">
        IoT
      </span>
    );
  }
  if (network === "mobile") {
    return (
      <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-violet-100">
        Mobile
      </span>
    );
  }
  return null;
}

function LabelBadge({ label }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 max-w-[120px] truncate">
      {label}
    </span>
  );
}

function hotspotId(h) {
  return `${h.entityKey}:${h.network || "unknown"}`;
}

function truncateKey(key, chars = 4) {
  if (!key || key.length <= chars * 2 + 3) return key;
  return `${key.slice(0, chars)}...${key.slice(-chars)}`;
}

// -- Sub-components --

function TabToggle({ mode, onChange }) {
  return (
    <div className="flex rounded-lg bg-slate-100 p-1">
      {[
        { key: "keys", label: "Entity Keys" },
        { key: "wallet", label: "Wallet" },
      ].map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition ${
            mode === tab.key
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
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
      <div className="flex-1 h-[3px] rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-400 tabular-nums shrink-0">
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
      className={`w-full text-left flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-100 transition hover:bg-slate-50 ${
        isSelected ? "bg-sky-50 border-l-2 border-l-sky-500" : ""
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${hasLocation ? "text-slate-900" : "text-slate-400"}`}>
            {hotspot.name || "Unknown Hotspot"}
          </span>
          <NetworkBadge network={hotspot.network} />
          <LabelBadge label={hotspot.label} />
        </div>
        <p className={`text-xs mt-0.5 ${hasLocation ? "text-slate-400" : "text-slate-300 italic"}`}>
          {hasLocation
            ? `${hotspot.coords[0].toFixed(4)},  ${hotspot.coords[1].toFixed(4)}`
            : "No location asserted"}
        </p>
      </div>
      <span className="text-[10px] text-slate-400 font-mono shrink-0">
        {truncateKey(hotspot.entityKey)}
      </span>
    </button>
  );
}

function DetailCard({ hotspot, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!hotspot) return null;
  const hasCoords = !!hotspot.coords;
  const h3Hex = hotspot.location
    ? BigInt(hotspot.location).toString(16)
    : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">
            {hotspot.name || truncateKey(hotspot.entityKey, 8)}
          </h3>
          <NetworkBadge network={hotspot.network} />
          <LabelBadge label={hotspot.label} />
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Details */}
      <div className="px-4 py-3 space-y-3">
        {hasCoords && (
          <div className="flex items-start gap-2.5">
            <MapPinIcon className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-slate-500">Coordinates</p>
              <p className="text-sm font-mono text-slate-900">
                {hotspot.coords[0].toFixed(4)},  {hotspot.coords[1].toFixed(4)}
              </p>
            </div>
          </div>
        )}
        {h3Hex && (
          <div className="flex items-start gap-2.5">
            <svg className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6" />
            </svg>
            <div>
              <p className="text-xs text-slate-500">H3 Index (res 12)</p>
              <p className="text-sm font-mono text-slate-900">{h3Hex}</p>
            </div>
          </div>
        )}
        <div className="flex items-start gap-2.5">
          <svg className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 8h8M8 4v8" strokeLinecap="round" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500">Entity Key</p>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <MiddleEllipsis>
                  <span className="text-sm font-mono text-slate-900" title={hotspot.entityKey}>{hotspot.entityKey}</span>
                </MiddleEllipsis>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(hotspot.entityKey);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                title="Copy entity key"
              >
                {copied
                  ? <ClipboardDocumentCheckIcon className="h-3.5 w-3.5 text-emerald-500" />
                  : <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                }
              </button>
            </div>
          </div>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-4 pt-1 text-xs text-slate-500">
          {hotspot.elevation != null && (
            <span>Elevation: <strong className="text-slate-700">{hotspot.elevation}m</strong></span>
          )}
          {hotspot.gain != null && (
            <span>Gain: <strong className="text-slate-700">{(hotspot.gain / 10).toFixed(1)} dBi</strong></span>
          )}
          {hotspot.deviceType && (
            <span className="text-slate-400">{hotspot.deviceType}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function MapTooltip({ hotspot, tooltipRef, initialPos }) {
  if (!hotspot) return null;
  return (
    <div
      ref={tooltipRef}
      className="pointer-events-none absolute z-50 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg"
      style={{ left: initialPos.x + 12, top: initialPos.y - 12 }}
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-slate-900">
          {hotspot.name || truncateKey(hotspot.entityKey, 8)}
        </p>
        <NetworkBadge network={hotspot.network} />
        <LabelBadge label={hotspot.label} />
      </div>
      {hotspot.coords && (
        <p className="text-xs text-slate-400 mt-0.5 font-mono">
          {hotspot.coords[0].toFixed(4)}, {hotspot.coords[1].toFixed(4)}
        </p>
      )}
      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
        {truncateKey(hotspot.entityKey, 12)}
      </p>
    </div>
  );
}

function WalletPreviewRow({ item, isChecked, isOnMap, onToggle }) {
  return (
    <label
      className={`flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-100 transition ${
        isOnMap
          ? "opacity-50 cursor-default"
          : "cursor-pointer hover:bg-slate-50"
      }`}
    >
      <input
        type="checkbox"
        checked={isChecked}
        disabled={isOnMap}
        onChange={onToggle}
        className="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-500/20 disabled:opacity-40"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${isOnMap ? "text-slate-400" : "text-slate-900"}`}>
            {item.name || "Unknown Hotspot"}
          </span>
          <NetworkBadge network={item.network} />
          {isOnMap && (
            <span className="text-[10px] text-slate-400 italic">Already on map</span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-slate-400 font-mono shrink-0">
        {truncateKey(item.entityKey)}
      </span>
    </label>
  );
}

function WalletPreview({ results, selected, onSelectedChange, label, onLabelChange, onAdd, onBack, existingIds, resolving }) {
  const iotCount = results.filter((h) => h.network === "iot").length;
  const mobileCount = results.filter((h) => h.network === "mobile").length;
  const selectableCount = results.filter((h) => !existingIds.has(hotspotId(h))).length;
  const selectedCount = selected.size;

  const handleSelectAll = () => {
    const allSelectable = new Set(
      results.filter((h) => !existingIds.has(hotspotId(h))).map((h) => hotspotId(h))
    );
    onSelectedChange(allSelectable);
  };

  const handleDeselectAll = () => {
    onSelectedChange(new Set());
  };

  const allSelected = selectedCount === selectableCount && selectableCount > 0;

  return (
    <div className="pointer-events-auto rounded-xl border border-slate-200 bg-white shadow-soft overflow-hidden flex flex-col max-h-[480px]">
      {/* Success banner */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border-b border-emerald-100">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 shrink-0">
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
      <div className="px-4 py-3 border-b border-slate-100">
        <label className="block text-xs text-slate-500 mb-1.5">
          Label (optional)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
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
      <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back
        </button>
        <button
          onClick={allSelected ? handleDeselectAll : handleSelectAll}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>
        <button
          onClick={onAdd}
          disabled={selectedCount === 0 || resolving}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
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

  const displayHotspots = useMemo(() => {
    if (networkFilter === "all") return hotspots;
    return hotspots.filter((h) => h.network === networkFilter);
  }, [hotspots, networkFilter]);

  const mappableHotspots = useMemo(
    () => displayHotspots.filter((h) => h.coords),
    [displayHotspots]
  );

  const stats = useMemo(() => {
    let iot = 0, mobile = 0;
    for (const h of hotspots) {
      if (h.network === "iot") iot++;
      else if (h.network === "mobile") mobile++;
    }
    return { iot, mobile, total: hotspots.length };
  }, [hotspots]);

  const selectedHotspotData = useMemo(
    () => hotspots.find((h) => h.entityKey === selectedHotspot) || null,
    [hotspots, selectedHotspot]
  );

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
              location: h.location,
              coords,
              name: nameMap?.get(h.entityKey) || h.name || null,
              label,
            });
          }
          setProgress({ done: Math.min(i + chunk.length, entityKeys.length), total: entityKeys.length });
        }

        setHotspots((prev) => {
          const existing = new Set(prev.map((h) => hotspotId(h)));
          const newOnes = allHotspots.filter((h) => !existing.has(hotspotId(h)));
          return [...prev, ...newOnes];
        });

        if (allHotspots.some((h) => h.coords)) {
          fitBounds(allHotspots.filter((h) => h.coords));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setResolving(false);
        setProgress({ done: 0, total: 0 });
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

      // Populate preview instead of resolving immediately
      const defaultLabel = `Wallet ${walletCountRef.current + 1}`;
      setWalletLabel(defaultLabel);
      setWalletResults(result.hotspots);

      // Pre-select all Hotspots that aren't already on the map
      const preSelected = new Set(
        result.hotspots
          .filter((h) => !existingHotspotIds.has(hotspotId(h)))
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
  }, []);

  // Deck.gl layer
  const layers = useMemo(
    () => [
      new ScatterplotLayer({
        id: "hotspots",
        data: mappableHotspots,
        getPosition: (d) => [d.coords[1], d.coords[0]],
        getFillColor: (d) =>
          d.entityKey === selectedHotspot
            ? [14, 165, 233]
            : d.network === "iot"
              ? IOT_COLOR
              : MOBILE_COLOR,
        getLineColor: [255, 255, 255],
        getRadius: (d) => (d.entityKey === selectedHotspot ? 8 : 5),
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
          }
        },
        updateTriggers: {
          getFillColor: [selectedHotspot],
          getRadius: [selectedHotspot],
        },
      }),
    ],
    [mappableHotspots, selectedHotspot]
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
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between px-6 py-4">
          <a href="/" className="flex items-center gap-3 text-slate-900 hover:text-slate-700">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
              HT
            </div>
            <div className="leading-tight">
              <p className="text-base font-semibold">Helium Tools</p>
              <p className="text-xs text-slate-500">Operator utilities</p>
            </div>
          </a>
          <div className="flex items-center gap-4">
            {hasHotspots && (
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {stats.iot} IoT
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-violet-500" />
                  {stats.mobile} Mobile
                </span>
                <span className="font-semibold text-slate-900">
                  {stats.total} hotspots
                </span>
              </div>
            )}
            {!hasHotspots && (
              <span className="text-sm font-semibold text-slate-900">
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
          <MapGL mapStyle={BASEMAP_STYLE}>
            <NavigationControl position="top-right" />
          </MapGL>
        </DeckGL>

        {/* Hover tooltip */}
        {hoveredHotspot && (
          <MapTooltip
            hotspot={hoveredHotspot}
            tooltipRef={tooltipRef}
            initialPos={hoverPosRef.current}
          />
        )}

        {/* Floating sidebar panels */}
        <div className="absolute top-4 left-4 bottom-4 w-[380px] flex flex-col gap-3 pointer-events-none z-10">
          {/* Detail card (when Hotspot selected) */}
          {selectedHotspotData && (
            <div className="pointer-events-auto">
              <DetailCard
                hotspot={selectedHotspotData}
                onClose={() => setSelectedHotspot(null)}
              />
            </div>
          )}

          {/* Input Panel (when no Hotspot selected and no wallet preview) */}
          {!selectedHotspotData && !walletResults && (
            <div className="pointer-events-auto rounded-xl border border-slate-200 bg-white shadow-soft overflow-hidden">
              <div className="px-4 pt-3 pb-4 space-y-3">
                <TabToggle mode={mode} onChange={setMode} />

                {mode === "keys" && (
                  <>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5">
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
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {resolving ? <Spinner /> : null}
                        Load Hotspots
                      </button>
                      {hasHotspots && (
                        <button
                          onClick={handleClear}
                          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
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
                      <label className="block text-xs text-slate-500 mb-1.5">
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
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {walletLoading ? <Spinner /> : <MagnifyingGlassIcon className="h-4 w-4" />}
                        {walletLoading ? "Looking up..." : "Search Wallet"}
                      </button>
                      {hasHotspots && (
                        <button
                          onClick={handleClear}
                          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </>
                )}

                {error && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {error}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Wallet Preview Panel */}
          {walletResults && !selectedHotspotData && (
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
          )}

          {/* Results Panel */}
          {(hasHotspots || progress.total > 0) && (
            <div className="pointer-events-auto rounded-xl border border-slate-200 bg-white shadow-soft overflow-hidden flex flex-col min-h-0">
              {/* Progress bar */}
              {progress.total > 0 && (
                <ProgressBar done={progress.done} total={progress.total} />
              )}

              {/* Filter header */}
              {hasHotspots && (
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                    Hotspots
                  </span>
                  <button
                    onClick={() => fitBounds(hotspots.filter((h) => h.coords))}
                    className="text-[10px] text-slate-400 hover:text-slate-600 transition"
                    title="Fit map to all Hotspots"
                  >
                    Fit all
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
                            ? "bg-slate-900 text-white"
                            : "text-slate-400 hover:text-slate-600"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Hotspot list */}
              <div className="flex-1 overflow-y-auto max-h-[340px]">
                {displayHotspots.map((hotspot) => (
                  <HotspotListRow
                    key={hotspotId(hotspot)}
                    hotspot={hotspot}
                    isSelected={selectedHotspot === hotspot.entityKey}
                    onClick={() => flyToHotspot(hotspot)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
