import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import CopyButton from "../components/CopyButton.jsx";
import DcMintModal from "../dc-mint/DcMintModal.jsx";
import { DC_MINT as DC_MINT_KEY } from "../dc-mint/constants.js";
import {
  fetchGateways,
  fetchGatewayPackets,
  fetchOuis,
  checkOnchainStatus,
  requestIssueTxns,
  requestOnboardTxn,
  createEventSource,
} from "../lib/multiGatewayApi.js";
import { latLngToCell, cellToBoundary } from "h3-js";
import {
  truncateString,
  formatDuration,
  formatTimeAgo,
} from "../lib/utils.js";
import animalHash from "angry-purple-tiger";
import { devAddrToNetId, netIdToOperator } from "../lib/lorawan.js";
import {
  ArrowDownCircleIcon,
  ArrowPathRoundedSquareIcon,
  ArrowUpCircleIcon,
  ArrowUturnDownIcon,
  ArrowUturnUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  CheckCircleIcon,
  QuestionMarkCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowDownCircleIcon as ArrowDownCircleSolidIcon,
  ArrowUpCircleIcon as ArrowUpCircleSolidIcon,
} from "@heroicons/react/24/solid";
import MapGL, { NavigationControl, Source, Layer } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import useDarkMode from "../lib/useDarkMode.js";
import "maplibre-gl/dist/maplibre-gl.css";

const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Onboarding cost constants
const DC_MINT_PUBKEY = DC_MINT_KEY;
const ONBOARD_SOL_COST = 0.004;   // ~0.002 SOL per step (rent for accounts)
const ONBOARD_DC_COST = 100000;   // 100,000 DC ($1) for IoT network registration


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

/** Self-updating timestamp display. Re-renders only itself every second. */
function LiveTime({ value, formatter }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!value) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [value]);
  return <span className="tabular-nums">{formatter(value)}</span>;
}

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
        <span className="inline-flex items-center gap-1.5">
          <PlusIcon className="h-4 w-4" />
          Add a Hotspot
        </span>
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
            <div className="mt-2 font-sans text-content-tertiary">
              <p>Select the port for your gateway region:</p>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                <span>US915 &mdash; <span className="font-mono text-content-secondary">1680</span></span>
                <span>EU868 &mdash; <span className="font-mono text-content-secondary">1681</span></span>
                <span>AU915 &mdash; <span className="font-mono text-content-secondary">1682</span></span>
                <span>AS923_1 &mdash; <span className="font-mono text-content-secondary">1683</span></span>
                <span>KR920 &mdash; <span className="font-mono text-content-secondary">1684</span></span>
                <span>IN865 &mdash; <span className="font-mono text-content-secondary">1685</span></span>
              </div>
            </div>
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
  KR920: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  IN865: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
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

function GatewayTable({ gateways, selectedMac, onSelect, onchainStatus, onOnboard, onAssertLocation }) {
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
              <th className="px-4 py-3 text-center">On-Chain</th>
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
                  {gw.connected && gw.connected_at ? (
                    <LiveTime
                      value={gw.connected_at}
                      formatter={(t) =>
                        formatDuration(Math.floor((Date.now() - t) / 1000))
                      }
                    />
                  ) : (
                    "Offline"
                  )}
                </td>
                <td className="px-4 py-3 text-right text-content-secondary">
                  <LiveTime value={gw.last_uplink_at} formatter={formatTimeAgo} />
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-content-secondary">
                  {gw.uplink_count ?? 0}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-content-secondary">
                  {gw.downlink_count ?? 0}
                </td>
                <td className="px-4 py-3 text-center">
                  {(() => {
                    const status = onchainStatus?.[gw.public_key];
                    if (!status) return <span className="text-content-tertiary">—</span>;
                    if (!status.onchain) {
                      return (
                        <button
                          className="rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90"
                          title="Onboard this Hotspot"
                          onClick={(e) => { e.stopPropagation(); onOnboard?.(gw.mac); }}
                        >
                          Onboard
                        </button>
                      );
                    }
                    if (!status.iot_onboarded || !status.has_location) {
                      return (
                        <button
                          className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90"
                          title={!status.iot_onboarded ? "Register on IoT network" : "Assert location"}
                          onClick={(e) => { e.stopPropagation(); onAssertLocation?.(gw.mac); }}
                        >
                          {!status.iot_onboarded ? "Register" : "Set Location"}
                        </button>
                      );
                    }
                    return (
                      <a
                        href={status.entity_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
                        title="View on Helium World"
                        onClick={(e) => e.stopPropagation()}
                      >
                        ✓
                      </a>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FRAME_TYPES = {
  UnconfirmedUp: { icon: ArrowUpCircleIcon, title: "Unconfirmed Uplink", label: "Uplink", group: 0, color: "text-emerald-500/60 dark:text-emerald-400/50" },
  ConfirmedUp: { icon: ArrowUpCircleSolidIcon, title: "Confirmed Uplink", group: 0, color: "text-emerald-600 dark:text-emerald-400" },
  UnconfirmedDown: { icon: ArrowDownCircleIcon, title: "Unconfirmed Downlink", label: "Downlink", group: 1, color: "text-sky-500/60 dark:text-sky-400/50" },
  ConfirmedDown: { icon: ArrowDownCircleSolidIcon, title: "Confirmed Downlink", group: 1, color: "text-sky-600 dark:text-sky-400" },
  JoinRequest: { icon: ArrowUturnUpIcon, title: "Join Request", group: 2, color: "text-violet-500/60 dark:text-violet-400/50" },
  JoinAccept: { icon: ArrowUturnDownIcon, title: "Join Accept", group: 2, color: "text-violet-600 dark:text-violet-400" },
  RejoinRequest: { icon: ArrowPathRoundedSquareIcon, title: "Rejoin Request", group: 2, color: "text-violet-500 dark:text-violet-400/70" },
  Proprietary: { icon: QuestionMarkCircleIcon, title: "Proprietary", group: 3, color: "text-content-tertiary" },
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
  const info = FRAME_TYPES[frameType] || {
    icon: QuestionMarkCircleIcon,
    title: frameType || "Unknown",
    color: "text-content-tertiary",
  };
  const Icon = info.icon;
  return (
    <Icon className={`h-4 w-4 ${info.color}`} title={info.title} aria-label={info.title} />
  );
}

const ALL_FRAME_TYPES = Object.keys(FRAME_TYPES);
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
  const [visibleTypes, setVisibleTypes] = useState(() =>
    Object.fromEntries(
      ALL_FRAME_TYPES.map((t) => [t, t !== "JoinRequest" && t !== "JoinAccept"]),
    ),
  );

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

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        {ALL_FRAME_TYPES.map((type, i) => {
          const info = FRAME_TYPES[type];
          const prevGroup = i > 0 ? FRAME_TYPES[ALL_FRAME_TYPES[i - 1]].group : info.group;
          return (
            <Fragment key={type}>
              {info.group !== prevGroup && (
                <span className="text-border-muted select-none">|</span>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs" title={info.title}>
                <input
                  type="checkbox"
                  checked={visibleTypes[type]}
                  onChange={() => toggleType(type)}
                  className="h-3 w-3 rounded border-border text-accent focus:ring-accent"
                />
                <info.icon
                  className={`h-3.5 w-3.5 ${visibleTypes[type] ? info.color : "text-content-tertiary"}`}
                />
                <span className={visibleTypes[type] ? "text-content-secondary" : "text-content-tertiary"}>
                  {info.label || info.title}
                </span>
              </label>
            </Fragment>
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
                  <td className="px-4 py-2 text-xs">
                    <LiveTime value={pkt.timestamp} formatter={formatTimeAgo} />
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
// Location Step (map + h3 hex + fields)
// ---------------------------------------------------------------------------

function LocationStep({ lat, lng, heightAGL, gain, setLat, setLng, setHeightAGL, setGain,
  loading, isDark, onSubmit, onSkip, inputClass }) {

  const hasCoords = lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng));
  const initLat = hasCoords ? parseFloat(lat) : 37.77;
  const initLng = hasCoords ? parseFloat(lng) : -122.42;

  const [viewState, setViewState] = useState({
    latitude: initLat,
    longitude: initLng,
    zoom: 16,
  });

  // Compute h3 cell boundary from map center
  const h3Cell = useMemo(() => {
    try {
      return latLngToCell(viewState.latitude, viewState.longitude, 12);
    } catch { return null; }
  }, [viewState.latitude, viewState.longitude]);

  const hexGeoJSON = useMemo(() => {
    if (!h3Cell) return null;
    const boundary = cellToBoundary(h3Cell, true); // [lng, lat] format
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [boundary.concat([boundary[0]])] },
    };
  }, [h3Cell]);

  // onMove only updates the local viewState (smooth dragging, no parent re-renders)
  const handleMove = useCallback((evt) => {
    setViewState(evt.viewState);
  }, []);

  // onMoveEnd flushes the final position to parent lat/lng state
  const handleMoveEnd = useCallback((evt) => {
    setLat(evt.viewState.latitude.toFixed(6));
    setLng(evt.viewState.longitude.toFixed(6));
  }, [setLat, setLng]);

  // Sync text field edits back to map
  const handleLatLngBlur = useCallback(() => {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    if (!isNaN(la) && !isNaN(lo)) {
      setViewState((v) => ({ ...v, latitude: la, longitude: lo }));
    }
  }, [lat, lng]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          Hotspot issued on-chain
        </p>
      </div>

      <p className="text-sm font-medium text-content-primary">
        Step 2: Assert Location
      </p>
      <p className="text-xs text-content-tertiary">
        Drag the map to position the pin. The highlighted hex is the H3 cell that will be asserted.
      </p>

      {/* Map with fixed center pin and h3 hex overlay */}
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
        {/* Fixed center pin */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative -mt-5">
            <svg width="24" height="36" viewBox="0 0 24 36" className="drop-shadow-lg">
              <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#8b5cf6" />
              <circle cx="12" cy="12" r="5" fill="white" />
            </svg>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-content-secondary">Latitude</label>
          <input type="text" value={lat} onChange={(e) => setLat(e.target.value)}
            onBlur={handleLatLngBlur} placeholder="e.g. 37.7749" className={inputClass} />
        </div>
        <div>
          <label className="text-xs font-medium text-content-secondary">Longitude</label>
          <input type="text" value={lng} onChange={(e) => setLng(e.target.value)}
            onBlur={handleLatLngBlur} placeholder="e.g. -122.4194" className={inputClass} />
        </div>
        <div>
          <label className="text-xs font-medium text-content-secondary">Height AGL (m)</label>
          <input type="text" value={heightAGL} onChange={(e) => setHeightAGL(e.target.value)}
            placeholder="above ground level" className={inputClass} />
        </div>
        <div>
          <label className="text-xs font-medium text-content-secondary">Gain (dBi)</label>
          <input type="text" value={gain} onChange={(e) => setGain(e.target.value)}
            placeholder="e.g. 1.2" className={inputClass} />
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Preparing..." : "Assert Location"}
      </button>

      <button
        onClick={onSkip}
        disabled={loading}
        className="w-full text-xs text-content-tertiary hover:text-content-secondary"
      >
        Skip location, register without
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboard Cost Disclosure
// ---------------------------------------------------------------------------

function OnboardCostCard({ solBalance, dcBalance, solSufficient, dcSufficient, balancesLoaded, onMintDc }) {
  return (
    <div className="rounded-lg bg-surface-inset p-3 text-xs space-y-1.5">
      <p className="font-medium text-content-primary">Onboarding costs</p>
      <div className="flex justify-between text-content-secondary">
        <span>Create on-chain entity</span>
        <span className="font-mono">~0.002 SOL</span>
      </div>
      <div className="flex justify-between text-content-secondary">
        <span>Onboard and assert location</span>
        <span className="font-mono">~0.002 SOL + 100,000 DC ($1)</span>
      </div>
      {balancesLoaded && (
        <>
          <div className="border-t border-border-muted pt-1.5 flex justify-between items-center font-medium text-content-primary">
            <span>Your balance</span>
            <span className="flex items-center gap-1.5 font-mono">
              <span className="flex items-center gap-0.5">
                {solSufficient
                  ? <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-500" />
                  : <XCircleIcon className="h-3.5 w-3.5 text-rose-500" />}
                {solBalance.toFixed(4)} SOL
              </span>
              <span className="flex items-center gap-0.5">
                {dcSufficient
                  ? <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-500" />
                  : <XCircleIcon className="h-3.5 w-3.5 text-rose-500" />}
                {dcBalance.toLocaleString()} DC
              </span>
            </span>
          </div>
          {!solSufficient && (
            <p className="text-amber-500">Insufficient SOL. Need ~0.004 SOL for both steps.</p>
          )}
          {!dcSufficient && (
            <div className="text-amber-500 space-y-1">
              <p>100,000 Data Credits required for full onboard.</p>
              {onMintDc && (
                <button onClick={onMintDc} className="text-xs font-medium text-accent hover:underline">
                  Mint DC from HNT
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboard Modal
// ---------------------------------------------------------------------------

function OnboardModal({ gateway, onClose, initialStep = "issue" }) {
  if (!gateway) return null;
  const { mac, public_key: publicKey } = gateway;
  const { connected, publicKey: walletPubkey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const isDark = useDarkMode();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("wallet"); // "wallet" | "cli"

  // Step tracking: "issue" → "location" → "onboard" → "done"
  const [step, setStep] = useState(initialStep);
  const [txSignature, setTxSignature] = useState(null);

  // Location form (pre-filled from gateway GPS if available)
  const [lat, setLat] = useState(() => gateway?.latitude?.toString() || "");
  const [lng, setLng] = useState(() => gateway?.longitude?.toString() || "");
  const [heightAGL, setHeightAGL] = useState(""); // height above ground level (m)
  const [gain, setGain] = useState("1.2"); // dBi

  // Auto-compute height above ground when lat/lng are available
  useEffect(() => {
    if (!lat || !lng || !gateway?.altitude) return;
    const gpsAlt = gateway.altitude;
    fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`)
      .then((r) => r.json())
      .then((data) => {
        const groundElev = data?.results?.[0]?.elevation;
        if (groundElev != null) {
          const agl = Math.max(0, Math.round(gpsAlt - groundElev));
          setHeightAGL(agl.toString());
        }
      })
      .catch(() => {}); // silently fail — user can enter manually
  }, [lat, lng, gateway?.altitude]);

  // Wallet balance checks
  const [solBalance, setSolBalance] = useState(null);
  const [dcBalance, setDcBalance] = useState(null);
  const [showDcMintModal, setShowDcMintModal] = useState(false);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);

  useEffect(() => {
    if (!connected || !walletPubkey || !connection) return;
    let cancelled = false;

    async function fetchBalances() {
      try {
        const [sol, tokenAccounts] = await Promise.all([
          connection.getBalance(walletPubkey),
          connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: DC_MINT_PUBKEY }),
        ]);
        if (cancelled) return;
        setSolBalance(sol / 1e9);
        const dcAccount = tokenAccounts.value[0];
        setDcBalance(dcAccount ? Number(dcAccount.account.data.parsed.info.tokenAmount.amount) : 0);
      } catch {
        if (!cancelled) { setSolBalance(null); setDcBalance(null); }
      }
    }
    fetchBalances();
    return () => { cancelled = true; };
  }, [connected, walletPubkey, connection, balanceRefreshKey]);

  const balancesLoaded = solBalance !== null;
  const solSufficient = balancesLoaded && solBalance >= ONBOARD_SOL_COST;
  const dcSufficient = !balancesLoaded || dcBalance >= ONBOARD_DC_COST;

  // CLI state
  const [cliWallet, setCliWallet] = useState("");
  const [txnData, setTxnData] = useState(null);

  // ---- Wallet tab handlers ----

  const handleIssueWithWallet = async () => {
    if (!walletPubkey || !sendTransaction) return;
    setLoading(true);
    setError(null);
    setStep("issuing");
    try {
      const result = await requestIssueTxns(mac, walletPubkey.toBase58());

      if (result.already_issued) {
        setStep("location");
        setLoading(false);
        return;
      }

      if (!result.transactions?.length) throw new Error("No transactions returned");

      for (const txnInfo of result.transactions) {
        const txn = VersionedTransaction.deserialize(Buffer.from(txnInfo.transaction, "base64"));
        const sig = await sendTransaction(txn, connection);
        setStep("confirming_issue");
        await connection.confirmTransaction(sig, "confirmed");
        setTxSignature(sig);
      }

      setStep("location");
    } catch (err) {
      console.error("Issue failed:", err);
      setError(err.message);
      setStep("issue");
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardWithWallet = async (overrides) => {
    if (!walletPubkey || !sendTransaction) return;
    setLoading(true);
    setError(null);
    setStep("onboarding");
    try {
      const effectiveLat = overrides?.lat ?? lat;
      const effectiveLng = overrides?.lng ?? lng;
      const effectiveHeight = overrides?.elevation ?? heightAGL;
      const effectiveGain = overrides?.gain ?? gain;

      const opts = {};
      if (effectiveLat && effectiveLng) {
        opts.location = latLngToCell(parseFloat(effectiveLat), parseFloat(effectiveLng), 12);
      }
      if (effectiveHeight) opts.elevation = parseInt(effectiveHeight, 10);
      if (effectiveGain) opts.gain = Math.round(parseFloat(effectiveGain) * 10);

      const result = await requestOnboardTxn(mac, walletPubkey.toBase58(), opts);

      if (result.already_onboarded) {
        setStep("done");
        setLoading(false);
        return;
      }

      const txn = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
      const sig = await sendTransaction(txn, connection);
      setStep("confirming_onboard");
      await connection.confirmTransaction(sig, "confirmed");
      setTxSignature(sig);
      setStep("done");
    } catch (err) {
      console.error("Onboard failed:", err);
      setError(err.message);
      setStep("location");
    } finally {
      setLoading(false);
    }
  };

  // ---- CLI tab handler ----

  const handleGenerateForCli = async () => {
    if (!cliWallet.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await requestIssueTxns(mac, cliWallet.trim());
      if (result.already_issued) {
        setTxnData({ already_issued: true });
      } else if (result.transactions?.length > 0) {
        setTxnData({ transaction: result.transactions[0].transaction });
      } else {
        throw new Error("No transactions returned");
      }
    } catch (err) {
      console.error("Issue transaction failed:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-content-primary placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-surface-raised p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-content-primary">
            Onboard Hotspot
          </h3>
          <button
            onClick={onClose}
            className="text-content-tertiary hover:text-content-secondary"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-sm text-content-secondary">
          {gatewayName(publicKey) || mac}
        </p>
        <p className="font-mono text-xs text-content-tertiary">{publicKey}</p>

        {/* Tab switcher */}
        <div className="mt-4 flex gap-1 rounded-lg bg-surface-inset p-1">
          <button
            onClick={() => { setTab("wallet"); setTxnData(null); setError(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "wallet"
                ? "bg-surface-raised text-content-primary shadow-sm"
                : "text-content-tertiary hover:text-content-secondary"
            }`}
          >
            Solana Wallet
          </button>
          <button
            onClick={() => { setTab("cli"); setTxnData(null); setError(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "cli"
                ? "bg-surface-raised text-content-primary shadow-sm"
                : "text-content-tertiary hover:text-content-secondary"
            }`}
          >
            CLI
          </button>
        </div>

        {error && (
          <p className="mt-3 text-sm text-rose-500">{error}</p>
        )}

        {/* ==================== WALLET TAB ==================== */}
        {tab === "wallet" && (
          <div className="mt-4">
            {/* Step 1: Issue */}
            {step === "issue" && (
              <>
                <div className="flex justify-center">
                  <WalletMultiButton />
                </div>
                {connected && walletPubkey && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-content-secondary">
                      Connected: <span className="font-mono">{truncateString(walletPubkey.toBase58(), 8, 4)}</span>
                    </p>

                    <OnboardCostCard
                      solBalance={solBalance} dcBalance={dcBalance}
                      solSufficient={solSufficient} dcSufficient={dcSufficient}
                      balancesLoaded={balancesLoaded}
                      onMintDc={() => setShowDcMintModal(true)}
                    />

                    <button
                      onClick={handleIssueWithWallet}
                      disabled={loading || !balancesLoaded || !solSufficient}
                      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {loading ? "Preparing..." : "Create On-Chain Entity"}
                    </button>
                  </div>
                )}
              </>
            )}

            {(step === "issuing" || step === "confirming_issue") && (
              <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
                <p className="text-sm text-sky-600 dark:text-sky-400">
                  {step === "issuing" ? "Waiting for wallet signature..." : "Confirming issue on Solana..."}
                </p>
              </div>
            )}

            {/* Step 2: Location assertion */}
            {step === "location" && (
              <LocationStep
                lat={lat} lng={lng} heightAGL={heightAGL} gain={gain}
                setLat={setLat} setLng={setLng} setHeightAGL={setHeightAGL} setGain={setGain}
                loading={loading} isDark={isDark}
                onSubmit={handleOnboardWithWallet}
                onSkip={() => handleOnboardWithWallet({ lat: "", lng: "", elevation: "", gain: "" })}
                inputClass={inputClass}
              />
            )}

            {(step === "onboarding" || step === "confirming_onboard") && (
              <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
                <p className="text-sm text-sky-600 dark:text-sky-400">
                  {step === "onboarding" ? "Waiting for wallet signature..." : "Confirming onboard on Solana..."}
                </p>
              </div>
            )}

            {/* Done */}
            {step === "done" && (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    Hotspot onboarded successfully!
                  </p>
                  {txSignature && (
                    <a
                      href={`https://solscan.io/tx/${txSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block text-xs text-accent hover:underline"
                    >
                      View on Solscan
                    </a>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="w-full rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:bg-surface-inset"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        )}

        {/* ==================== CLI TAB ==================== */}
        {tab === "cli" && !txnData && (
          <div className="mt-4 space-y-3">
            <OnboardCostCard />
            <label className="block text-sm font-medium text-content-secondary">
              Wallet Address (Solana)
            </label>
            <input
              type="text"
              value={cliWallet}
              onChange={(e) => setCliWallet(e.target.value)}
              placeholder="Enter your Solana wallet address"
              className={inputClass}
              onKeyDown={(e) => e.key === "Enter" && handleGenerateForCli()}
            />
            <button
              onClick={handleGenerateForCli}
              disabled={loading || !cliWallet.trim()}
              className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate Issue Transaction"}
            </button>
          </div>
        )}

        {/* CLI transaction result */}
        {tab === "cli" && txnData && (
          <div className="mt-4 space-y-4">
            {txnData.already_issued ? (
              <>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    Hotspot already issued on-chain!
                  </p>
                </div>
                <p className="text-xs text-content-tertiary">
                  Use <code className="rounded bg-surface-inset px-1 py-0.5">helium-wallet hotspots add data-only</code> to complete onboarding and assert location via CLI.
                </p>
                <button onClick={onClose}
                  className="w-full rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:bg-surface-inset">
                  Done
                </button>
              </>
            ) : (
              <>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    Issue transaction ready
                  </p>
                  <p className="mt-1 text-xs text-content-secondary">
                    Sign this transaction, then use <code className="rounded bg-surface-inset px-1 py-0.5">helium-wallet</code> to onboard and assert location.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
                    Serialized Transaction (base64)
                  </p>
                  <div className="mt-2 flex items-start gap-2">
                    <code className="block max-h-24 flex-1 overflow-auto rounded-lg bg-surface-inset p-2 font-mono text-[10px] text-content-secondary break-all">
                      {txnData.transaction}
                    </code>
                    <CopyButton text={txnData.transaction} />
                  </div>
                </div>

                <button onClick={onClose}
                  className="w-full rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:bg-surface-inset">
                  Done
                </button>
              </>
            )}
          </div>
        )}

        {showDcMintModal && (
          <DcMintModal
            onClose={() => setShowDcMintModal(false)}
            onSuccess={() => { setShowDcMintModal(false); setBalanceRefreshKey((k) => k + 1); }}
            defaultDcAmount={ONBOARD_DC_COST}
          />
        )}
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
  const [onchainStatus, setOnchainStatus] = useState({});
  const [onboardMac, setOnboardMac] = useState(null);
  const [onboardInitialStep, setOnboardInitialStep] = useState("issue");

  // Check on-chain status when gateways load
  useEffect(() => {
    const pubkeys = gateways
      .map((g) => g.public_key)
      .filter((pk) => pk && !onchainStatus[pk]);
    if (pubkeys.length === 0) return;
    checkOnchainStatus(pubkeys)
      .then((results) => setOnchainStatus((prev) => ({ ...prev, ...results })))
      .catch(() => {});
  }, [gateways]);

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
            onchainStatus={onchainStatus}
            onOnboard={(mac) => { setOnboardInitialStep("issue"); setOnboardMac(mac); }}
            onAssertLocation={(mac) => { setOnboardInitialStep("location"); setOnboardMac(mac); }}
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

      {onboardMac && (
        <OnboardModal
          gateway={gateways.find((g) => g.mac === onboardMac)}
          initialStep={onboardInitialStep}
          onClose={() => setOnboardMac(null)}
        />
      )}
    </div>
  );
}
