import { useState, useEffect, useRef, useCallback } from "react";
import Header from "../components/Header.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import CopyButton from "../components/CopyButton.jsx";
import {
  fetchGateways,
  fetchGatewayPackets,
  createEventSource,
} from "../lib/multiGatewayApi.js";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds) {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTimeAgo(isoString) {
  if (!isoString) return "-";
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function truncateKey(key) {
  if (!key || key.length <= 16) return key || "";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// SSE Hook
// ---------------------------------------------------------------------------

function useMultiGateway() {
  const [gateways, setGateways] = useState([]);
  const [summary, setSummary] = useState({ total: 0, connected: 0 });
  const [sseStatus, setSseStatus] = useState("connecting");
  const esRef = useRef(null);

  // initial load
  useEffect(() => {
    fetchGateways()
      .then((data) => {
        setGateways(data.gateways);
        setSummary({ total: data.total, connected: data.connected });
      })
      .catch((err) => console.error("Failed to fetch gateways:", err));
  }, []);

  // SSE connection
  useEffect(() => {
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
              const exists = prev.find((g) => g.mac === data.mac);
              if (exists) {
                return prev.map((g) =>
                  g.mac === data.mac
                    ? { ...g, connected: true, connected_seconds: 0 }
                    : g,
                );
              }
              return [
                ...prev,
                {
                  mac: data.mac,
                  public_key: "",
                  connected: true,
                  connected_seconds: 0,
                  last_uplink_seconds_ago: null,
                  uplink_count: 0,
                  downlink_count: 0,
                },
              ];
            });
            setSummary((s) => ({
              total: s.total + (gateways.find((g) => g.mac === data.mac) ? 0 : 1),
              connected: s.connected + 1,
            }));
            break;

          case "gateway_disconnect":
            setGateways((prev) =>
              prev.map((g) =>
                g.mac === data.mac ? { ...g, connected: false } : g,
              ),
            );
            setSummary((s) => ({
              ...s,
              connected: Math.max(0, s.connected - 1),
            }));
            break;

          case "uplink":
            setGateways((prev) =>
              prev.map((g) =>
                g.mac === data.mac
                  ? {
                      ...g,
                      uplink_count: (g.uplink_count || 0) + 1,
                      last_uplink_seconds_ago: 0,
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

  return { gateways, summary, sseStatus };
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
        <span>How to add a Hotspot</span>
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
            <p>
              <span className="text-content-tertiary">serv_port_up:</span> 1680
            </p>
            <p>
              <span className="text-content-tertiary">serv_port_down:</span>{" "}
              1680
            </p>
            <p>
              <span className="text-content-tertiary">region:</span> US915
            </p>
          </div>
          <p className="mt-3 text-content-tertiary">
            A keypair is auto-provisioned on first connection. The gateway will
            appear as a new Hotspot on the network.
          </p>
        </div>
      )}
    </div>
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
                      {truncateKey(gw.public_key)}
                    </span>
                    {gw.public_key && <CopyButton text={gw.public_key} />}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-content-secondary">
                  {gw.connected
                    ? formatDuration(gw.connected_seconds)
                    : "Offline"}
                </td>
                <td className="px-4 py-3 text-right text-content-secondary">
                  {gw.last_uplink_seconds_ago != null
                    ? `${gw.last_uplink_seconds_ago}s ago`
                    : "-"}
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

function GatewayDetail({ mac, onClose }) {
  const [packets, setPackets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchGatewayPackets(mac)
      .then((data) => setPackets(data))
      .catch((err) => console.error("Failed to fetch packets:", err))
      .finally(() => setLoading(false));
  }, [mac]);

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
              {[...packets].reverse().map((pkt, i) => (
                <tr
                  key={i}
                  className="border-t border-border-muted text-content-secondary"
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
  const { gateways, summary, sseStatus } = useMultiGateway();
  const [selectedMac, setSelectedMac] = useState(null);

  const totalUplinks = gateways.reduce(
    (sum, g) => sum + (g.uplink_count || 0),
    0,
  );
  const totalDownlinks = gateways.reduce(
    (sum, g) => sum + (g.downlink_count || 0),
    0,
  );

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
          <SummaryCard title="Uplinks" value={totalUplinks.toLocaleString()} />
          <SummaryCard
            title="Downlinks"
            value={totalDownlinks.toLocaleString()}
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
            onClose={() => setSelectedMac(null)}
          />
        )}
      </div>
    </div>
  );
}
