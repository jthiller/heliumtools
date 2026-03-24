import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import CopyButton from "../components/CopyButton.jsx";
import {
  fetchGateways,
  fetchGatewayPackets,
  fetchOuis,
  createEventSource,
} from "../lib/multiGatewayApi.js";
import {
  truncateString,
  formatDuration,
  formatTimeAgo,
} from "../lib/utils.js";
import animalHash from "angry-purple-tiger";
import { devAddrToNetId, netIdToOperator } from "../lib/lorawan.js";
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from "@heroicons/react/24/outline";
import MapGL, { NavigationControl } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import useDarkMode from "../lib/useDarkMode.js";
import "maplibre-gl/dist/maplibre-gl.css";

const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";


/**
 * Build a sorted lookup from OUI cache data.
 * Returns a function: devAddrHex → { oui, name } | null
 */
function buildOuiLookup(ouiData) {
  if (!ouiData?.ouis) return () => null;
  // Flatten all ranges with their OUI info, sort by start
  const entries = [];
  for (const o of ouiData.ouis) {
    for (const r of o.ranges) {
      entries.push({
        start: parseInt(r.start, 16) >>> 0,
        end: parseInt(r.end, 16) >>> 0,
        oui: o.oui,
        name: o.name,
      });
    }
  }
  entries.sort((a, b) => a.start - b.start);

  return (devAddrHex) => {
    if (!devAddrHex) return null;
    const addr = parseInt(devAddrHex, 16) >>> 0;
    // Binary search
    let lo = 0;
    let hi = entries.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (addr < entries[mid].start) hi = mid - 1;
      else if (addr > entries[mid].end) lo = mid + 1;
      else return { oui: entries[mid].oui, name: entries[mid].name };
    }
    return null;
  };
}

function gatewayName(publicKey) {
  if (!publicKey) return null;
  return animalHash(publicKey);
}

// ---------------------------------------------------------------------------
// SSE Hook
// ---------------------------------------------------------------------------

function useMultiGateway() {
  const [gateways, setGateways] = useState([]);
  const [sseStatus, setSseStatus] = useState("connecting");
  const [latestPacket, setLatestPacket] = useState(null);
  const [tick, setTick] = useState(0);

  // Tick every 5s to keep relative timestamps fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  // Convert API relative-seconds to absolute timestamps
  const loadGateways = () =>
    fetchGateways()
      .then((data) => {
        const now = Date.now();
        setGateways(
          data.gateways.map((g) => ({
            ...g,
            connected_at: g.connected
              ? now - (g.connected_seconds || 0) * 1000
              : null,
            last_uplink_at:
              g.last_uplink_seconds_ago != null
                ? now - g.last_uplink_seconds_ago * 1000
                : null,
          })),
        );
      })
      .catch((err) => console.error("Failed to fetch gateways:", err));

  // Initial load
  useEffect(() => {
    loadGateways();
  }, []);

  // SSE connection with visibility-aware reconnect
  const esRef = useRef(null);

  const connectSse = () => {
    if (esRef.current) esRef.current.close();
    const es = createEventSource();
    esRef.current = es;

    es.onopen = () => setSseStatus("connected");
    es.onerror = () => setSseStatus("reconnecting");

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "gateway_connect":
            setGateways((prev) => {
              const existing = prev.find((g) => g.mac === data.mac);
              if (existing) {
                return prev.map((g) =>
                  g.mac === data.mac
                    ? {
                        ...g,
                        connected: true,
                        connected_at: Date.now(),
                        region: data.region,
                      }
                    : g,
                );
              }
              return [
                ...prev,
                {
                  mac: data.mac,
                  public_key: "",
                  region: data.region || "",
                  connected: true,
                  connected_at: Date.now(),
                  last_uplink_at: null,
                  uplink_count: 0,
                  downlink_count: 0,
                },
              ];
            });
            break;

          case "gateway_disconnect":
            setGateways((prev) =>
              prev.map((g) =>
                g.mac === data.mac
                  ? { ...g, connected: false, connected_at: null }
                  : g,
              ),
            );
            break;

          case "uplink":
            if (data.metadata) {
              setLatestPacket({ mac: data.mac, metadata: data.metadata });
            }
            setGateways((prev) =>
              prev.map((g) =>
                g.mac === data.mac
                  ? {
                      ...g,
                      uplink_count: (g.uplink_count || 0) + 1,
                      last_uplink_at: Date.now(),
                    }
                  : g,
              ),
            );
            break;

          case "downlink":
            if (data.metadata) {
              setLatestPacket({ mac: data.mac, metadata: data.metadata });
            }
            setGateways((prev) =>
              prev.map((g) =>
                g.mac === data.mac
                  ? { ...g, downlink_count: (g.downlink_count || 0) + 1 }
                  : g,
              ),
            );
            break;
        }
      } catch {
        // ignore malformed events
      }
    };
  };

  // Initial SSE connection
  useEffect(() => {
    connectSse();
    return () => esRef.current?.close();
  }, []);

  // Reconnect + refresh state when tab becomes visible again
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadGateways();
        connectSse();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Memoize derived counts so they are only recomputed when gateways changes,
  // not on every tick-driven re-render.
  const summary = useMemo(() => {
    let connected = 0;
    let totalUplinks = 0;
    let totalDownlinks = 0;
    for (const g of gateways) {
      if (g.connected) connected++;
      totalUplinks += g.uplink_count || 0;
      totalDownlinks += g.downlink_count || 0;
    }
    return {
      total: gateways.length,
      connected,
      totalUplinks,
      totalDownlinks,
    };
  }, [gateways]);

  return { gateways, summary, sseStatus, latestPacket };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ title, value }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-soft">
      <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
        {title}
      </p>
      <p className="mt-1 text-2xl font-semibold text-content-primary">
        {value}
      </p>
    </div>
  );
}

function SetupNote() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 rounded-xl border border-border bg-surface-raised shadow-soft">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-content-secondary hover:text-content-primary"
      >
        <span>How to Add a Hotspot</span>
        {open ? (
          <ChevronUpIcon className="h-4 w-4" />
        ) : (
          <ChevronDownIcon className="h-4 w-4" />
        )}
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 text-sm text-content-secondary">
          <p>
            Connect a LoRaWAN gateway to the Helium network by pointing its
            packet forwarder at the multi-gateway aggregator:
          </p>
          <div className="mt-3 rounded-lg bg-surface-inset p-3 font-mono text-xs">
            <p>
              <span className="text-content-tertiary">server_address:</span>{" "}
              hotspot.heliumtools.org
            </p>
            <p className="mt-2 font-sans text-content-tertiary">
              If your gateway region is US915, use port{" "}
              <span className="font-mono text-content-secondary">1680</span>.
              For EU868, use port{" "}
              <span className="font-mono text-content-secondary">1681</span>.
              For AU915, use port{" "}
              <span className="font-mono text-content-secondary">1682</span>.
            </p>
          </div>
          <p className="mt-3 text-content-tertiary">
            A keypair is auto-provisioned on first connection. The gateway will
            connect as a new Hotspot on the network. Each gateway must have a
            unique Gateway EUI &mdash; check your packet forwarder config and
            replace the default (<span className="font-mono">AA555A0000000101</span>)
            with your concentrator&apos;s actual EUI.
          </p>
        </div>
      )}
    </div>
  );
}

const REGION_COLORS = {
  US915: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  EU868: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  AU915: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  AS923_1: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
};

function RegionBadge({ region }) {
  const colors =
    REGION_COLORS[region] ||
    "bg-surface-inset text-content-tertiary";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colors}`}
    >
      {region}
    </span>
  );
}

function GatewayTable({ gateways, selectedMac, onSelect }) {
  if (gateways.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-8 text-center shadow-soft">
        <p className="text-sm text-content-tertiary">
          No gateways registered yet. Connect a gateway to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-inset text-left text-xs font-medium uppercase tracking-wider text-content-tertiary">
              <th className="w-8 px-2 py-3"></th>
              <th className="px-4 py-3">Region</th>
              <th className="px-4 py-3">MAC</th>
              <th className="px-4 py-3">Public Key</th>
              <th className="px-4 py-3 text-right">Connected</th>
              <th className="px-4 py-3 text-right">Last Uplink</th>
              <th className="px-4 py-3 text-right">Uplinks</th>
              <th className="px-4 py-3 text-right">Downlinks</th>
            </tr>
          </thead>
          <tbody>
            {gateways.map((gw) => (
              <tr
                key={gw.mac}
                onClick={() => onSelect(gw.mac === selectedMac ? null : gw.mac)}
                className={`cursor-pointer border-t border-border-muted transition-colors hover:bg-surface-inset ${
                  gw.mac === selectedMac ? "bg-surface-inset" : ""
                }`}
              >
                <td
                  className="w-8 px-2 py-3"
                  title={gw.connected ? "Active" : "Inactive"}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      gw.connected
                        ? "bg-emerald-500"
                        : "bg-content-tertiary"
                    }`}
                  />
                </td>
                <td className="px-4 py-3">
                  <RegionBadge region={gw.region} />
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono text-xs text-content-secondary">
                      {gw.mac}
                    </span>
                    <CopyButton text={gw.mac} />
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-xs text-content-primary" title={gw.public_key}>
                      {gatewayName(gw.public_key) || truncateString(gw.public_key, 8, 4)}
                    </span>
                    {gw.public_key && <CopyButton text={gw.public_key} />}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-content-secondary">
                  {gw.connected && gw.connected_at
                    ? formatDuration(
                        Math.floor((Date.now() - gw.connected_at) / 1000),
                      )
                    : "Offline"}
                </td>
                <td className="px-4 py-3 text-right text-content-secondary">
                  {formatTimeAgo(gw.last_uplink_at)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-content-secondary">
                  {gw.uplink_count ?? 0}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-content-secondary">
                  {gw.downlink_count ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FRAME_TYPE_LABELS = {
  JoinRequest: { label: "Join", title: "Join Request", color: "text-violet-600 dark:text-violet-400" },
  JoinAccept: { label: "Join Acc", title: "Join Accept", color: "text-violet-600 dark:text-violet-400" },
  UnconfirmedUp: { label: "Uncnf Up", title: "Unconfirmed Uplink", color: "text-content-secondary" },
  ConfirmedUp: { label: "Cnf Up", title: "Confirmed Uplink", color: "text-sky-600 dark:text-sky-400" },
  UnconfirmedDown: { label: "Uncnf Dn", title: "Unconfirmed Downlink", color: "text-content-tertiary" },
  ConfirmedDown: { label: "Cnf Dn", title: "Confirmed Downlink", color: "text-sky-600 dark:text-sky-400" },
  RejoinRequest: { label: "Rejoin", title: "Rejoin Request", color: "text-amber-600 dark:text-amber-400" },
  Proprietary: { label: "Prop", title: "Proprietary", color: "text-content-tertiary" },
};

function NetIdCell({ devAddr }) {
  if (!devAddr) return <span className="text-content-tertiary">-</span>;
  const result = devAddrToNetId(devAddr);
  if (!result) return <span className="text-content-tertiary">-</span>;
  const operator = netIdToOperator(result.netId);
  return (
    <span className="text-xs" title={`NetID: ${result.netId}`}>
      {operator ? (
        <span className="text-content-primary">{operator}</span>
      ) : (
        <a
          href={`https://michaeldjeffrey.github.io/bit_looker/?net_id=${result.netId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-accent hover:underline"
        >
          {result.netId}
        </a>
      )}
      <span className="ml-1.5 text-[10px] text-content-tertiary">T{result.type}</span>
    </span>
  );
}

function FrameTypeBadge({ frameType }) {
  const info = FRAME_TYPE_LABELS[frameType] || {
    label: frameType || "?",
    title: frameType || "Unknown",
    color: "text-content-tertiary",
  };
  return (
    <span className={`text-xs font-medium ${info.color}`} title={info.title}>
      {info.label}
    </span>
  );
}

const ALL_FRAME_TYPES = Object.keys(FRAME_TYPE_LABELS);
const MAX_PACKETS = 200;

const WELL_KNOWN_REPO = "https://github.com/helium/well-known/";

function OuiCell({ devAddr, ouiLookup }) {
  if (!devAddr) return <span className="text-content-tertiary">-</span>;
  const match = ouiLookup(devAddr);
  if (!match) return <span className="text-content-tertiary">-</span>;
  if (match.name) {
    return (
      <span className="text-xs text-content-secondary" title={`OUI ${match.oui}`}>
        {match.name}
      </span>
    );
  }
  return (
    <a
      href={WELL_KNOWN_REPO}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-accent hover:underline"
      title="Identify this OUI"
    >
      {match.oui}
    </a>
  );
}

function GatewayDetail({ mac, publicKey, latestPacket, ouiLookup, onClose }) {
  const idRef = useRef(0);
  const tagPackets = (arr, isNew) =>
    arr.map((pkt) => ({ ...pkt, _id: ++idRef.current, _new: isNew }));
  const [packets, setPackets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [, setTimeTick] = useState(0);
  const [visibleTypes, setVisibleTypes] = useState(() =>
    Object.fromEntries(
      ALL_FRAME_TYPES.map((t) => [t, t !== "JoinRequest" && t !== "JoinAccept"]),
    ),
  );

  // 1-second tick to keep "Xs ago" timestamps fresh
  useEffect(() => {
    const id = setInterval(() => setTimeTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const toggleType = (type) =>
    setVisibleTypes((prev) => ({ ...prev, [type]: !prev[type] }));

  const reversedPackets = useMemo(
    () =>
      [...packets]
        .reverse()
        .filter((pkt) => !pkt.frame_type || visibleTypes[pkt.frame_type] !== false)
        .slice(0, MAX_PACKETS),
    [packets, visibleTypes],
  );

  useEffect(() => {
    setLoading(true);
    fetchGatewayPackets(mac)
      .then((data) => setPackets(tagPackets(data, false)))
      .catch((err) => console.error("Failed to fetch packets:", err))
      .finally(() => setLoading(false));
  }, [mac]);

  // Append new packets from SSE
  useEffect(() => {
    if (latestPacket && latestPacket.mac === mac) {
      setPackets((prev) => {
        const next = [...prev, ...tagPackets([latestPacket.metadata], true)];
        return next.length > MAX_PACKETS ? next.slice(-MAX_PACKETS) : next;
      });
    }
  }, [latestPacket, mac]);

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-raised shadow-soft">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-content-primary">
          {gatewayName(publicKey) || "Recent Packets"}{" "}
          <span className="font-mono text-xs text-content-tertiary">
            {mac}
          </span>
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-content-tertiary hover:text-content-secondary"
        >
          Close
        </button>
      </div>

      <div className="flex flex-wrap gap-3 border-b border-border px-4 py-2">
        {ALL_FRAME_TYPES.map((type) => {
          const info = FRAME_TYPE_LABELS[type];
          return (
            <label
              key={type}
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs"
              title={info.title}
            >
              <input
                type="checkbox"
                checked={visibleTypes[type]}
                onChange={() => toggleType(type)}
                className="h-3 w-3 rounded border-border text-accent focus:ring-accent"
              />
              <span className={visibleTypes[type] ? info.color : "text-content-tertiary"}>
                {info.label}
              </span>
            </label>
          );
        })}
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-content-tertiary">
          Loading...
        </div>
      ) : packets.length === 0 ? (
        <div className="p-6 text-center text-sm text-content-tertiary">
          No packets recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-inset text-left text-xs font-medium uppercase tracking-wider text-content-tertiary">
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">NetID</th>
                <th className="px-4 py-2">DevAddr</th>
                <th className="px-4 py-2">Helium OUI</th>
                <th className="px-4 py-2 text-right">FCnt</th>
                <th className="px-4 py-2 text-right">FPort</th>
                <th className="px-4 py-2 text-right">RSSI</th>
                <th className="px-4 py-2 text-right">SNR</th>
                <th className="px-4 py-2 text-right">Freq</th>
                <th className="px-4 py-2">SF</th>
                <th className="px-4 py-2 text-right">Size</th>
              </tr>
            </thead>
            <tbody>
              {reversedPackets.map((pkt) => (
                <tr
                  key={pkt._id}
                  className={`border-t border-border-muted text-content-secondary ${pkt._new ? "animate-pulse-once" : ""}`}
                >
                  <td className="px-4 py-2 text-xs tabular-nums">
                    {formatTimeAgo(pkt.timestamp)}
                  </td>
                  <td className="px-4 py-2">
                    <FrameTypeBadge frameType={pkt.frame_type} />
                  </td>
                  <td className="px-4 py-2">
                    <NetIdCell devAddr={pkt.dev_addr} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-content-secondary">
                    {pkt.dev_addr || "-"}
                  </td>
                  <td className="px-4 py-2">
                    <OuiCell devAddr={pkt.dev_addr} ouiLookup={ouiLookup} />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-content-secondary">
                    {pkt.fcnt ?? "-"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-content-secondary">
                    {pkt.fport ?? "-"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {pkt.rssi} dBm
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {pkt.snr?.toFixed(1)} dB
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {pkt.frequency?.toFixed(1)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {pkt.spreading_factor}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {pkt.payload_size} B
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map Modal
// ---------------------------------------------------------------------------

function GatewayMapModal({ gateways, onClose }) {
  const dark = useDarkMode();
  const withCoords = useMemo(
    () => gateways.filter((g) => g.latitude != null && g.longitude != null),
    [gateways],
  );

  const [viewState, setViewState] = useState(() => {
    if (withCoords.length > 0) {
      const avgLat =
        withCoords.reduce((s, g) => s + g.latitude, 0) / withCoords.length;
      const avgLng =
        withCoords.reduce((s, g) => s + g.longitude, 0) / withCoords.length;
      return { latitude: avgLat, longitude: avgLng, zoom: 10 };
    }
    return { latitude: 39, longitude: -98, zoom: 3 };
  });

  const flyTo = (lat, lng) =>
    setViewState((v) => ({ ...v, latitude: lat, longitude: lng, zoom: 14 }));

  const layers = [
    new ScatterplotLayer({
      id: "gateways",
      data: withCoords,
      getPosition: (d) => [d.longitude, d.latitude],
      getFillColor: (d) =>
        d.connected ? [16, 185, 129, 200] : [156, 163, 175, 160],
      getRadius: 80,
      radiusMinPixels: 6,
      radiusMaxPixels: 20,
      pickable: true,
    }),
  ];

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m-4 flex flex-1 overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-lg lg:m-8">
        {/* Map */}
        <div className="relative flex-1">
          <DeckGL
            viewState={viewState}
            onViewStateChange={({ viewState: vs }) => setViewState(vs)}
            layers={layers}
            controller={true}
            getTooltip={({ object }) =>
              object && `${gatewayName(object.public_key) || object.mac}`
            }
          >
            <MapGL mapStyle={dark ? BASEMAP_DARK : BASEMAP_LIGHT}>
              <NavigationControl position="top-right" />
            </MapGL>
          </DeckGL>
        </div>

        {/* Sidebar table */}
        <div className="flex w-80 flex-col border-l border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium text-content-primary">
              Gateway Locations
            </h3>
            <button
              onClick={onClose}
              className="text-content-tertiary hover:text-content-secondary"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {gateways.map((gw) => {
              const name = gatewayName(gw.public_key);
              const hasCoords =
                gw.latitude != null && gw.longitude != null;
              return (
                <button
                  key={gw.mac}
                  onClick={() =>
                    hasCoords && flyTo(gw.latitude, gw.longitude)
                  }
                  className={`w-full border-b border-border-muted px-4 py-2.5 text-left transition-colors ${
                    hasCoords
                      ? "hover:bg-surface-inset cursor-pointer"
                      : "opacity-50"
                  }`}
                >
                  <p className="text-xs font-medium text-content-primary">
                    {name || gw.mac}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-content-tertiary">
                    {gw.mac}
                  </p>
                  <p className="mt-0.5 text-[10px] text-content-secondary tabular-nums">
                    {hasCoords
                      ? `${gw.latitude.toFixed(5)}, ${gw.longitude.toFixed(5)}${gw.altitude != null ? ` (${gw.altitude}m)` : ""}`
                      : "No GPS data"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function MultiGateway() {
  const { gateways, summary, sseStatus, latestPacket } = useMultiGateway();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedMac, setSelectedMac] = useState(
    () => searchParams.get("mac") || null,
  );
  const [showMap, setShowMap] = useState(false);
  const [ouiLookup, setOuiLookup] = useState(() => () => null);

  // Sync selected MAC to URL param
  const selectMac = (mac) => {
    setSelectedMac(mac);
    if (mac) {
      setSearchParams({ mac }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  // Fetch OUI → DevAddr mapping once
  useEffect(() => {
    fetchOuis()
      .then((data) => {
        if (data) setOuiLookup(() => buildOuiLookup(data));
      })
      .catch((err) => console.error("Failed to fetch OUI data:", err));
  }, []);

  // Press M to toggle map (ignore when typing in an input)
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "m" && !e.metaKey && !e.ctrlKey) {
        const el = document.activeElement;
        const tag = el?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !el?.isContentEditable) {
          setShowMap((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Multi-Gateway" />

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        {sseStatus === "reconnecting" && (
          <div className="mb-4">
            <StatusBanner
              tone="warning"
              message="Reconnecting to event stream..."
            />
          </div>
        )}

        <SetupNote />

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard title="Total Gateways" value={summary.total} />
          <SummaryCard title="Connected" value={summary.connected} />
          <SummaryCard title="Uplinks" value={summary.totalUplinks.toLocaleString()} />
          <SummaryCard
            title="Downlinks"
            value={summary.totalDownlinks.toLocaleString()}
          />
        </div>

        <div className="mt-6">
          <GatewayTable
            gateways={gateways}
            selectedMac={selectedMac}
            onSelect={selectMac}
          />
        </div>

        {selectedMac && (
          <GatewayDetail
            mac={selectedMac}
            publicKey={gateways.find((g) => g.mac === selectedMac)?.public_key}
            latestPacket={latestPacket}
            ouiLookup={ouiLookup}
            onClose={() => selectMac(null)}
          />
        )}
      </div>

      {showMap && (
        <GatewayMapModal
          gateways={gateways}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>
  );
}
