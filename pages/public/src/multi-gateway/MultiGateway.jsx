import { useState, useEffect, useMemo, useRef } from "react";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import CopyButton from "../components/CopyButton.jsx";
import {
  fetchGateways,
  fetchGatewayPackets,
  createEventSource,
} from "../lib/multiGatewayApi.js";
import {
  truncateString,
  formatDuration,
  formatTimeAgo,
} from "../lib/utils.js";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";

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

  // Initial load — convert API seconds to absolute timestamps
  useEffect(() => {
    fetchGateways()
      .then((data) => {
        const now = Date.now();
        setGateways(
          data.gateways.map((g) => ({
            ...g,
            connected_at: g.connected
              ? now - (g.connected_seconds || 0) * 1000
              : null,
            last_uplink_at: g.last_uplink_seconds_ago != null
              ? now - g.last_uplink_seconds_ago * 1000
              : null,
          })),
        );
      })
      .catch((err) => console.error("Failed to fetch gateways:", err));
  }, []);

  // SSE connection (Worker merges all region streams)
  useEffect(() => {
    const es = createEventSource();

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

    return () => es.close();
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
            </p>
          </div>
          <p className="mt-3 text-content-tertiary">
            A keypair is auto-provisioned on first connection. The gateway will
            connect as a new Hotspot on the network.
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
              <th className="px-4 py-3">Status</th>
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
                <td className="px-4 py-3">
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
                    <span className="font-mono text-xs text-content-secondary">
                      {truncateString(gw.public_key, 8, 4)}
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

function GatewayDetail({ mac, latestPacket, onClose }) {
  const idRef = useRef(0);
  const tagPackets = (arr, isNew) =>
    arr.map((pkt) => ({ ...pkt, _id: ++idRef.current, _new: isNew }));
  const [packets, setPackets] = useState([]);
  const [loading, setLoading] = useState(true);
  const reversedPackets = useMemo(
    () => [...packets].reverse().slice(0, 50),
    [packets],
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
        return next.length > 50 ? next.slice(-50) : next;
      });
    }
  }, [latestPacket, mac]);

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-raised shadow-soft">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-content-primary">
          Recent Packets &mdash;{" "}
          <span className="font-mono text-xs text-content-secondary">
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
                <th className="px-4 py-2 text-right">RSSI</th>
                <th className="px-4 py-2 text-right">SNR</th>
                <th className="px-4 py-2 text-right">Freq (MHz)</th>
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
                    {formatTimeAgo(pkt.timestamp)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {pkt.rssi} dBm
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {pkt.snr.toFixed(1)} dB
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {pkt.frequency.toFixed(1)}
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
// Main Component
// ---------------------------------------------------------------------------

export default function MultiGateway() {
  const { gateways, summary, sseStatus, latestPacket } = useMultiGateway();
  const [selectedMac, setSelectedMac] = useState(null);

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
            onSelect={setSelectedMac}
          />
        </div>

        {selectedMac && (
          <GatewayDetail
            mac={selectedMac}
            latestPacket={latestPacket}
            onClose={() => setSelectedMac(null)}
          />
        )}
      </div>
    </div>
  );
}
