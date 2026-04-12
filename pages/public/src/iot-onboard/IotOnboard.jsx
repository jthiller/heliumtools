import React, { useCallback, useEffect, useRef, useState } from 'react';
import Header from '../components/Header.jsx';
import StatusBanner from '../components/StatusBanner.jsx';
import CopyButton from '../components/CopyButton.jsx';
import useHotspotBle from './useHotspotBle.js';
import {
  SignalIcon,
  WifiIcon,
  ArrowPathIcon,
  LightBulbIcon,
  XMarkIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';

const WIFI_STATUS_MAP = {
  'init':        { text: 'Initializing...', tone: 'loading' },
  'connecting':  { text: 'Connecting to network...', tone: 'loading' },
  'connected':   { text: 'WiFi connected successfully.', tone: 'success' },
  'failed':      { text: 'Failed to connect. Check password and try again.', tone: 'error' },
  'timeout':     { text: 'Connection timed out. The network may be out of range.', tone: 'error' },
  'invalid':     { text: 'Invalid network or credentials.', tone: 'error' },
  'error':       { text: 'Connection error. Try again.', tone: 'error' },
};

function WifiStatus({ status }) {
  if (!status) return null;
  if (status.startsWith('error:')) {
    return <StatusBanner tone="error" message={status.slice(status.indexOf(':') + 1).trim()} />;
  }
  const mapped = WIFI_STATUS_MAP[status.trim().toLowerCase()];
  if (mapped) {
    return <StatusBanner tone={mapped.tone} message={mapped.text} />;
  }
  return <StatusBanner tone="info" message={`WiFi status: ${status}`} />;
}

function BleNotSupported() {
  return (
    <StatusBanner
      tone="warning"
      message="Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Opera on desktop."
    />
  );
}

function ActivityLog({ lines }) {
  const [displayed, setDisplayed] = useState(null);
  const [animating, setAnimating] = useState(false);
  const prevRef = useRef(null);

  useEffect(() => {
    if (lines.length === 0) { setDisplayed(null); return; }
    const latest = lines[lines.length - 1];
    if (latest === displayed) return;
    prevRef.current = displayed;
    setAnimating(true);
    setDisplayed(latest);
    const timer = setTimeout(() => setAnimating(false), 300);
    return () => clearTimeout(timer);
  }, [lines, displayed]);

  if (!displayed) return null;
  return (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-surface-inset px-4 h-8 overflow-hidden relative">
      {prevRef.current && animating && (
        <p className="absolute inset-x-4 flex items-center h-8 text-xs font-mono text-content-tertiary animate-[flipOut_0.3s_ease-in_forwards]">
          <span className="select-none mr-1.5">{'>'}</span>
          {prevRef.current}
        </p>
      )}
      <p className={`flex items-center h-8 text-xs font-mono text-content-secondary ${animating ? 'animate-[flipIn_0.3s_ease-out]' : ''}`}>
        <span className="text-content-tertiary select-none mr-1.5">{'>'}</span>
        {displayed}
      </p>
    </div>
  );
}

function StartPage({ onScan, scanning, activity }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-8 text-center space-y-6">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
        <SignalIcon className="h-8 w-8" />
      </div>
      <div>
        <h2 className="text-xl font-display font-semibold text-content mb-2">
          Connect to Hotspot
        </h2>
        <p className="text-content-secondary max-w-md mx-auto">
          Put your Helium IoT Hotspot in Bluetooth pairing mode, then click
          the button below. Your browser will show a device picker.
        </p>
      </div>
      <button
        onClick={onScan}
        disabled={scanning}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {scanning ? (
          <>
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
            {scanning === 'connecting' ? 'Connecting...' : 'Scanning...'}
          </>
        ) : (
          'Pair Hotspot'
        )}
      </button>
      <ActivityLog lines={activity} />
    </div>
  );
}

function KeyValue({ label, value, copyable = false, mono = true }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="text-sm text-content-tertiary shrink-0">{label}</span>
      <span className={`text-sm text-content text-right break-all ${mono ? 'font-mono' : ''}`}>
        {value || '—'}
        {copyable && value && (
          <span className="inline-block ml-1.5 align-middle">
            <CopyButton text={value} />
          </span>
        )}
      </span>
    </div>
  );
}

function useLoading(fn) {
  const [loading, setLoading] = useState(false);
  const run = useCallback(async (...args) => {
    setLoading(true);
    try { await fn(...args); } finally { setLoading(false); }
  }, [fn]);
  return [run, loading];
}

function DiagnosticsPanel({ pubkey, onboardingKey, ethernetOnline, diagnostics, onRefresh, onIdentify }) {
  const [refresh, refreshing] = useLoading(onRefresh);
  return (
    <div className="rounded-xl border border-border bg-surface-raised">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-display font-semibold text-content">Diagnostics</h3>
        <div className="flex gap-2">
          <button
            onClick={onIdentify}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-inset transition"
            title="Flash Hotspot LEDs"
          >
            <LightBulbIcon className="h-3.5 w-3.5" />
            Identify
          </button>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-inset transition disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="p-4 divide-y divide-border/50">
        <KeyValue label="Public Key" value={pubkey} copyable />
        <KeyValue label="Onboarding Key" value={onboardingKey} copyable />
        <KeyValue
          label="Ethernet"
          value={
            ethernetOnline === null
              ? '—'
              : ethernetOnline
                ? 'Connected'
                : 'Disconnected'
          }
          mono={false}
        />
        {diagnostics &&
          Object.entries(diagnostics).map(([k, v]) => (
            <KeyValue key={k} label={k} value={v} />
          ))}
      </div>
    </div>
  );
}

function WifiPanel({
  wifiSsid,
  wifiNetworks,
  wifiConfigured,
  wifiConnectStatus,
  onRefresh,
  onConnect,
  onRemove,
}) {
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [scan, scanning] = useLoading(onRefresh);

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!ssid) return;
    setConnecting(true);
    try {
      await onConnect(ssid, password);
      setPassword('');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-raised">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-display font-semibold text-content">WiFi</h3>
        <button
          onClick={scan}
          disabled={scanning}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-inset transition disabled:opacity-50"
        >
          <ArrowPathIcon className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning...' : 'Scan'}
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-content-tertiary mb-1">
            Current Connection
          </p>
          <div className="flex items-center justify-between">
            <p className="text-sm text-content font-mono">{wifiSsid || 'Not connected'}</p>
            {wifiSsid && (
              <button
                onClick={() => onRemove(wifiSsid)}
                className="text-content-tertiary hover:text-rose-500 transition"
                title="Disconnect from network"
                aria-label="Disconnect from network"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {wifiConfigured.length > 0 && (
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-content-tertiary mb-2">
              Saved Networks
            </p>
            <div className="space-y-1.5">
              {wifiConfigured.map((net) => (
                <div
                  key={net}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-sm font-mono text-content">{net}</span>
                  <button
                    onClick={() => onRemove(net)}
                    className="text-content-tertiary hover:text-rose-500 transition"
                    title="Remove network"
                    aria-label="Remove network"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {wifiNetworks.length > 0 && (
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-content-tertiary mb-2">
              Available Networks
            </p>
            <div className="flex flex-wrap gap-1.5">
              {wifiNetworks.map((net) => (
                <button
                  key={net}
                  onClick={() => setSsid(net)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-mono transition ${
                    ssid === net
                      ? 'border-accent text-accent-text bg-accent/5'
                      : 'border-border text-content-secondary hover:border-content-tertiary'
                  }`}
                >
                  {net}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleConnect} className="space-y-3">
          <div>
            <label htmlFor="wifi-ssid" className="text-xs font-mono uppercase tracking-widest text-content-tertiary mb-1 block">
              SSID
            </label>
            <input
              id="wifi-ssid"
              type="text"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              className="block w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 font-mono"
              placeholder="Network name"
            />
          </div>
          <div>
            <label htmlFor="wifi-password" className="text-xs font-mono uppercase tracking-widest text-content-tertiary mb-1 block">
              Password
            </label>
            <div className="relative">
              <input
                id="wifi-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-border bg-surface-inset px-3 py-2 pr-9 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 font-mono"
                placeholder="Password (leave empty for open)"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-content-tertiary hover:text-content-secondary transition"
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword
                  ? <EyeSlashIcon className="h-4 w-4" />
                  : <EyeIcon className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={!ssid || connecting}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <WifiIcon className="h-4 w-4" />
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </form>

        {wifiConnectStatus && <WifiStatus status={wifiConnectStatus} />}
      </div>
    </div>
  );
}

export default function IotOnboard() {
  const ble = useHotspotBle();
  const bleSupported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="IoT Hotspot Setup" />
      <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="mb-10">
          <p className="text-[13px] font-mono font-medium uppercase tracking-[0.08em] text-accent-text mb-2">
            IoT Hotspot Setup
          </p>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-content tracking-[-0.03em] mb-4">
            Hotspot Diagnostics
          </h1>
          <p className="text-lg text-content-secondary">
            Connect to a Helium IoT Hotspot over Bluetooth to view diagnostics,
            configure WiFi, and verify device identity.
          </p>
        </div>

        {!bleSupported && <BleNotSupported />}

        {bleSupported && ble.status !== 'connected' && (
          <>
            {ble.status === 'disconnected' && (
              <div className="mb-6">
                <StatusBanner
                  tone="warning"
                  message="Bluetooth connection lost. Put your Hotspot back into pairing mode, then click Pair Hotspot to reconnect."
                />
              </div>
            )}
            {ble.error && (
              <div className="mb-6">
                <StatusBanner tone="error" message={ble.error} />
              </div>
            )}
            <StartPage
              onScan={ble.scan}
              scanning={ble.status === 'scanning' || ble.status === 'connecting' ? ble.status : false}
              activity={ble.activity}
            />
          </>
        )}

        {ble.status === 'connected' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-display font-semibold text-content">
                  {ble.hotspotName}
                </h2>
                <p className="text-sm font-mono text-content-tertiary">
                  {ble.device?.name || 'Helium Hotspot'}
                </p>
              </div>
              <button
                onClick={ble.disconnect}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-inset transition"
              >
                Disconnect
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <DiagnosticsPanel
                pubkey={ble.pubkey}
                onboardingKey={ble.onboardingKey}
                ethernetOnline={ble.ethernetOnline}
                diagnostics={ble.diagnostics}
                onRefresh={ble.refreshDiagnostics}
                onIdentify={ble.identifyLights}
              />
              <WifiPanel
                wifiSsid={ble.wifiSsid}
                wifiNetworks={ble.wifiNetworks}
                wifiConfigured={ble.wifiConfigured}
                wifiConnectStatus={ble.wifiConnectStatus}
                onRefresh={ble.refreshWifi}
                onConnect={ble.connectWifi}
                onRemove={ble.removeWifi}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
