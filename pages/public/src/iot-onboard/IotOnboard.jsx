import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';
import { latLngToCell, cellToBoundary } from 'h3-js';
import Address from '@helium/address';
import MapGL, { Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import Header from '../components/Header.jsx';
import StatusBanner from '../components/StatusBanner.jsx';
import CopyButton from '../components/CopyButton.jsx';
import { confirmAndVerify } from '../dc-mint/solanaUtils.js';
import { lookupHotspot, requestIssue, requestOnboard } from '../lib/iotOnboardApi.js';
import useDarkMode from '../lib/useDarkMode.js';
import useHotspotBle from './useHotspotBle.js';
import {
  SignalIcon,
  WifiIcon,
  ArrowPathIcon,
  LightBulbIcon,
  XMarkIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ArrowTopRightOnSquareIcon,
  GlobeAltIcon,
  BoltIcon,
  MapPinIcon,
  ViewfinderCircleIcon,
} from '@heroicons/react/24/outline';

const BASEMAP_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const BASEMAP_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const ONBOARD_SOL_COST = 0.004;

// Fallback fees (used while fetching from chain)
const DEFAULT_FEES = {
  full: { base: 1_000_000, location: 100_000 },
  data_only: { base: 50_000, location: 50_000 },
};

function dcToUsd(dc) { return (dc / 100_000).toFixed(2); }

function formatDcCost(mode, fees) {
  const f = mode === 'full' ? fees.full : fees.data_only;
  const total = f.base + f.location;
  return `${total.toLocaleString()} DC ($${dcToUsd(total)})`;
}

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

const MNTD_FIRMWARE_URL = 'https://pub-b6000f897a404647a3b09e6d2a841924.r2.dev/MNTD_2023_04_18_0.img';
const MNTD_MAKERS = new Set(['RAKwireless', 'CalChip Connect']);
const BALENA_ETCHER_URL = 'https://etcher.balena.io/';

function StaleFirmwareBanner({ maker, rawResponse }) {
  const hasFirmwareImage = maker && MNTD_MAKERS.has(maker);
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800 dark:text-amber-200 space-y-2">
          <p className="font-medium">Hotspot firmware is too old to sign Solana transactions.</p>
          <p className="text-amber-700 dark:text-amber-300">
            This Hotspot&apos;s firmware predates the Helium → Solana migration and cannot
            produce the signatures required for on-chain onboarding.
          </p>
        </div>
      </div>
      {hasFirmwareImage && (
        <div className="border-t border-amber-500/30 pt-3 space-y-2 text-xs text-amber-800 dark:text-amber-200">
          <p className="font-medium">Update firmware ({maker} Hotspots):</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>
              <a href={MNTD_FIRMWARE_URL} className="underline font-mono hover:no-underline" target="_blank" rel="noopener noreferrer">
                Download the MNTD firmware image
              </a>{' '}
              (~1 GB)
            </li>
            <li>
              Flash it directly to your SD card using{' '}
              <a href={BALENA_ETCHER_URL} className="underline hover:no-underline" target="_blank" rel="noopener noreferrer">
                balenaEtcher
              </a>
            </li>
            <li>Insert the SD card into your Hotspot and power it on</li>
            <li>Wait ~5 minutes for initial boot, then put it back in pairing mode and retry</li>
          </ol>
        </div>
      )}
      <details className="text-xs text-amber-700 dark:text-amber-400">
        <summary className="cursor-pointer">Technical details</summary>
        <p className="font-mono mt-1">Hotspot returned: {rawResponse}</p>
      </details>
    </div>
  );
}

function BleNotSupported() {
  return (
    <StatusBanner
      tone="warning"
      message="Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Opera on desktop."
    />
  );
}

const PROGRESS_MILESTONES = new Set([
  'GATT connected', 'Service discovered',
  'Public key: OK', 'Onboarding key: OK',
  'Diagnostics: OK', 'Diagnostics: not available',
  'Ethernet status: OK', 'Ethernet status: not available',
  'WiFi SSID: OK', 'WiFi SSID: not available',
  'Ready',
]);
const TOTAL_MILESTONES = 7; // GATT + service + 5 reads (OK or not available)

function ConnectionProgress({ lines }) {
  if (lines.length === 0) return null;
  const completed = lines.filter(l => PROGRESS_MILESTONES.has(l)).length;
  const pct = Math.min((completed / TOTAL_MILESTONES) * 100, 100);
  const latest = lines[lines.length - 1];
  return (
    <div className="mx-auto max-w-md space-y-2">
      <div className="h-1.5 rounded-full bg-surface-inset overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs font-mono text-content-tertiary text-center">
        {latest}
      </p>
    </div>
  );
}

function StartPage({ onScan, scanning, activity }) {
  return (
    <div className="space-y-6">
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
        <ConnectionProgress lines={activity} />
      </div>
      {/* Journey preview */}
      <div className="flex items-center justify-center gap-6 text-xs text-content-tertiary">
        {['Pair via Bluetooth', 'Configure WiFi', 'Onboard to Helium'].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-6 bg-border" />}
            <span className="font-mono">{label}</span>
          </div>
        ))}
      </div>
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
                title="Forget network"
                aria-label="Forget network"
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

// ---------------------------------------------------------------------------
// OnboardPanel — full on-chain onboarding flow
// ---------------------------------------------------------------------------

async function signAndBroadcast(txn, walletPubkey, sendTransaction, connection) {
  const msg = txn.message;
  const staticKeys = msg.staticAccountKeys || msg.accountKeys || [];
  const numSigners = msg.header?.numRequiredSignatures ?? txn.signatures.length;
  const signerKeys = staticKeys.slice(0, numSigners);
  const walletStr = walletPubkey.toBase58();
  const walletIsSigner = signerKeys.some((k) => k.toBase58() === walletStr);

  let sig;
  if (walletIsSigner) {
    // Wallet must sign — use the wallet adapter
    sig = await sendTransaction(txn, connection, { skipPreflight: true });
  } else {
    // Transaction is already fully signed (e.g., maker-paid) — broadcast directly
    sig = await connection.sendRawTransaction(txn.serialize(), { skipPreflight: true });
  }
  await confirmAndVerify(connection, sig);
  return sig;
}

function OnboardPanel({ ble }) {
  const { connected, publicKey: walletPubkey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const isDark = useDarkMode();

  // Fees (from chain, cached in KV)
  const [fees, setFees] = useState(DEFAULT_FEES);

  // Lookup state
  const [lookupData, setLookupData] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState(null);

  // Step machine: lookup → issue → location → onboard → done
  const [step, setStep] = useState('lookup');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [txSignature, setTxSignature] = useState(null);
  const [onboardMode, setOnboardMode] = useState(null); // "full" | "data_only"

  // Location fields
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [elevation, setElevation] = useState('');
  const [gain, setGain] = useState('1.2');

  const inputClass = 'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';

  // Auto-lookup when connected
  useEffect(() => {
    if (!ble.onboardingKey && !ble.pubkey) return;
    let cancelled = false;
    setLookupLoading(true);
    setLookupError(null);

    lookupHotspot(ble.onboardingKey, ble.pubkey)
      .then((data) => {
        if (cancelled) return;
        setLookupData(data);
        if (data.fees) setFees(data.fees);

        // Determine initial step from on-chain status
        const onchain = data.onchain;
        if (onchain.onboarded && onchain.has_location) {
          setStep('done');
        } else if (onchain.onboarded && !onchain.has_location) {
          setStep('location');
          setOnboardMode(data.suggested_mode === 'full' ? 'full' : 'data_only');
        } else if (onchain.issued) {
          if (data.maker?.dc_sufficient) setOnboardMode('full');
          setStep('location');
        } else {
          if (data.maker?.dc_sufficient) setOnboardMode('full');
          setStep('issue');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLookupError(err.message);
        setOnboardMode('data_only'); // Default so Issue button isn't stranded
        setStep('issue');
      })
      .finally(() => { if (!cancelled) setLookupLoading(false); });

    return () => { cancelled = true; };
  }, [ble.onboardingKey, ble.pubkey]);

  // Auto-fetch elevation from lat/lng
  useEffect(() => {
    if (!lat || !lng || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) return;
    let cancelled = false;
    fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`)
      .then(r => r.json())
      .then(data => {
        const groundElev = data?.results?.[0]?.elevation;
        if (!cancelled && groundElev != null) setElevation(String(Math.round(groundElev)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lat, lng]);

  // Map state for location step
  const hasCoords = lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng));
  const initLat = hasCoords ? parseFloat(lat) : 37.77;
  const initLng = hasCoords ? parseFloat(lng) : -122.42;
  const [viewState, setViewState] = useState({ latitude: initLat, longitude: initLng, zoom: 16 });

  const h3Cell = useMemo(() => {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    if (isNaN(la) || isNaN(lo)) return null;
    try { return latLngToCell(la, lo, 12); }
    catch { return null; }
  }, [lat, lng]);

  const hexGeoJSON = useMemo(() => {
    if (!h3Cell) return null;
    const boundary = cellToBoundary(h3Cell, true);
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [boundary.concat([boundary[0]])] } };
  }, [h3Cell]);

  const handleMove = useCallback((evt) => setViewState(evt.viewState), []);
  const handleMoveEnd = useCallback((evt) => {
    setLat(evt.viewState.latitude.toFixed(6));
    setLng(evt.viewState.longitude.toFixed(6));
  }, []);

  const handleLatLngBlur = useCallback(() => {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    if (!isNaN(la) && !isNaN(lo)) setViewState(v => ({ ...v, latitude: la, longitude: lo }));
  }, [lat, lng]);

  const [geolocating, setGeolocating] = useState(false);
  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;
        setLat(la.toFixed(6));
        setLng(lo.toFixed(6));
        setViewState((v) => ({ ...v, latitude: la, longitude: lo, zoom: 17 }));
        setGeolocating(false);
      },
      () => setGeolocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const locationComplete = lat !== '' && lng !== '' && elevation !== '' && gain !== ''
    && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng))
    && Number.isFinite(parseInt(elevation)) && Number.isFinite(parseFloat(gain));

  // --- Handlers ---

  const handleIssue = async () => {
    if (!walletPubkey || !ble.pubkey) return;
    setLoading(true);
    setError(null);
    try {
      // Firmware's b58_to_bin expects a Helium-style address (version + net_type + pubkey + checksum).
      // Convert the Solana ed25519 pubkey bytes to the Helium address format.
      const heliumAddr = new Address(0, 0, 1, walletPubkey.toBytes()).b58;
      const addGatewayHex = await ble.writeAddGateway(heliumAddr, heliumAddr);

      // Build issue transaction on worker
      const result = await requestIssue(
        walletPubkey.toBase58(),
        ble.pubkey,
        addGatewayHex,
      );

      if (result.already_issued) {
        setStep('location');
        return;
      }

      let lastSig = null;
      for (const txB64 of result.transactions) {
        const txn = VersionedTransaction.deserialize(Buffer.from(txB64, 'base64'));
        lastSig = await signAndBroadcast(txn, walletPubkey, sendTransaction, connection);
      }
      setTxSignature(lastSig);
      setStep('location');
    } catch (err) {
      if (err.name === 'StaleFirmwareError') {
        setError({ kind: 'stale_firmware', rawResponse: err.rawResponse });
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOnboard = async () => {
    if (!walletPubkey || !ble.pubkey || !locationComplete) return;
    setLoading(true);
    setError(null);
    try {
      const h3Hex = latLngToCell(parseFloat(lat), parseFloat(lng), 12);
      // When maker has enough DC for full PoC onboard, they pay everything.
      // Otherwise the user covers DC (and SOL).
      const userPays = !lookupData?.maker?.dc_sufficient;
      const result = await requestOnboard(
        walletPubkey.toBase58(),
        ble.pubkey,
        {
          location: h3Hex,
          elevation: parseInt(elevation, 10),
          gain: Math.round(parseFloat(gain) * 10),
          user_pays: userPays,
        },
      );

      if (result.already_onboarded) {
        setStep('done');
        return;
      }

      let lastSig = null;
      for (const txB64 of result.transactions) {
        const txn = VersionedTransaction.deserialize(Buffer.from(txB64, 'base64'));
        lastSig = await signAndBroadcast(txn, walletPubkey, sendTransaction, connection);
      }
      setTxSignature(lastSig);
      setStep('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Render ---

  return (
    <div className="rounded-xl border border-border bg-surface-raised">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-display font-semibold text-content">On-Chain Onboarding</h3>
        {lookupLoading && <ArrowPathIcon className="h-4 w-4 animate-spin text-content-tertiary" />}
      </div>

      <div className="p-4 space-y-4">
        {lookupError && <StatusBanner tone="warning" message={`Lookup: ${lookupError}`} />}
        {typeof error === 'string' && <StatusBanner tone="error" message={error} />}
        {error?.kind === 'stale_firmware' && (
          <StaleFirmwareBanner maker={lookupData?.maker?.name} rawResponse={error.rawResponse} />
        )}

        {/* Maker info card */}
        {lookupData?.maker && (
          <div className="rounded-lg bg-surface-inset p-3 text-xs space-y-1.5">
            <p className="font-medium text-content">Maker Info</p>
            <div className="flex justify-between text-content-secondary">
              <span>Name</span>
              <span className="font-mono">{lookupData.maker.name || 'Unknown'}</span>
            </div>
            <div className="flex justify-between text-content-secondary">
              <span>DC Balance</span>
              <span className="flex items-center gap-1 font-mono">
                {lookupData.maker.dc_sufficient
                  ? <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-500" />
                  : <XCircleIcon className="h-3.5 w-3.5 text-rose-500" />}
                {Number(lookupData.maker.dc_balance).toLocaleString()} DC
              </span>
            </div>
          </div>
        )}

        {/* On-chain status summary */}
        {lookupData?.onchain && (
          <div className="rounded-lg bg-surface-inset p-3 text-xs space-y-1.5">
            <p className="font-medium text-content">On-Chain Status</p>
            <div className="flex justify-between text-content-secondary">
              <span>Issued</span>
              <span className={lookupData.onchain.issued ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                {lookupData.onchain.issued ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between text-content-secondary">
              <span>Onboarded (IoT)</span>
              <span className={lookupData.onchain.onboarded ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                {lookupData.onchain.onboarded ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between text-content-secondary">
              <span>Location Asserted</span>
              <span className={lookupData.onchain.has_location ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                {lookupData.onchain.has_location ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        )}

        {/* Mode selector — always visible when maker can't cover DC */}
        {lookupData && !lookupData.maker?.dc_sufficient && step !== 'done' && (
          <div className="space-y-3">
            {lookupData.maker?.name && !onboardMode && (
              <StatusBanner
                tone="warning"
                message={`This Hotspot's maker (${lookupData.maker.name}) does not have sufficient Data Credits to cover the onboarding fee. You will need to pay the DC cost from your own wallet.`}
              />
            )}
            <p className="text-xs font-mono uppercase tracking-widest text-content-tertiary">Onboarding Mode</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { key: 'full', title: 'Full Onboard (PoC)', desc: 'Earns IOT rewards for wireless coverage.', cost: `${(fees.full.base + fees.full.location).toLocaleString()} DC ($${dcToUsd(fees.full.base + fees.full.location)})` },
                { key: 'data_only', title: 'Data-Only', desc: 'Eligible for data transfer rewards only.', cost: `${(fees.data_only.base + fees.data_only.location).toLocaleString()} DC ($${dcToUsd(fees.data_only.base + fees.data_only.location)})` },
              ].map(({ key, title, desc, cost }) => (
                <button
                  key={key}
                  onClick={() => setOnboardMode(key)}
                  className={`relative rounded-lg border p-4 text-left transition-all duration-150 space-y-1 ${
                    onboardMode === key
                      ? 'border-accent bg-accent/10 scale-[1.02] shadow-sm'
                      : 'border-border hover:border-accent'
                  }`}
                >
                  {onboardMode === key && (
                    <div className="absolute top-3 right-3">
                      <CheckCircleIcon className="h-5 w-5 text-accent" />
                    </div>
                  )}
                  <p className="text-sm font-medium text-content">{title}</p>
                  <p className="text-xs text-content-tertiary">{desc}</p>
                  <p className="pt-1 text-xs font-mono text-content-secondary">~{ONBOARD_SOL_COST} SOL + {cost}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Issue */}
        {step === 'issue' && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-content">
              {lookupData?.onchain?.issued ? 'Hotspot Already Issued' : 'Step 1: Issue Hotspot On-Chain'}
            </p>
            <p className="text-xs text-content-tertiary">
              Connect your wallet and sign a transaction to issue this Hotspot as a compressed NFT on Solana.
            </p>
            <div className="rounded-lg bg-surface-inset p-3 text-xs space-y-1">
              <div className="flex justify-between text-content-secondary">
                <span>Estimated cost</span>
                <span className="font-mono">~0.002 SOL</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <WalletMultiButton className="!rounded-lg !text-sm !h-9" />
              {connected && (
                <button
                  onClick={handleIssue}
                  disabled={loading || (!onboardMode && !lookupData?.maker?.dc_sufficient)}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {loading ? 'Issuing...' : 'Issue Hotspot'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step: Location */}
        {step === 'location' && (
          <div className="space-y-3">
            {lookupData?.onchain?.issued && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Hotspot issued on-chain
                </p>
              </div>
            )}
            <p className="text-sm font-medium text-content">
              {lookupData?.onchain?.onboarded ? 'Assert Location' : 'Step 3: Assert Location & Onboard'}
            </p>
            <p className="text-xs text-content-tertiary">
              Drag the map to position the pin. The highlighted hex is the H3 cell that will be asserted.
            </p>

            {/* Map */}
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
                    <Layer id="h3-hex-fill" type="fill" paint={{ 'fill-color': '#8b5cf6', 'fill-opacity': 0.25 }} />
                    <Layer id="h3-hex-outline" type="line" paint={{ 'line-color': '#8b5cf6', 'line-width': 2 }} />
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
                className="absolute top-2 right-2 rounded-md bg-surface-raised border border-border shadow-sm p-2 text-content-secondary hover:text-accent-text hover:border-accent transition disabled:opacity-50"
              >
                <ViewfinderCircleIcon className={`h-4 w-4 ${geolocating ? 'animate-pulse' : ''}`} />
              </button>
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
                <label className="text-xs font-medium text-content-secondary">Elevation (m)</label>
                <input type="text" value={elevation} onChange={(e) => setElevation(e.target.value)}
                  placeholder="above ground level" className={inputClass} />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary">Gain (dBi)</label>
                <input type="text" value={gain} onChange={(e) => setGain(e.target.value)}
                  placeholder="e.g. 1.2" className={inputClass} />
              </div>
            </div>

            {/* Cost card */}
            <div className="rounded-lg bg-surface-inset p-3 text-xs space-y-1.5">
              <p className="font-medium text-content">Onboarding costs</p>
              <div className="flex justify-between text-content-secondary">
                <span>Mode</span>
                <span className="font-mono">{onboardMode === 'full' ? 'Full (PoC eligible)' : 'Data-Only'}</span>
              </div>
              <div className="flex justify-between text-content-secondary">
                <span>Estimated cost</span>
                <span className="font-mono">
                  ~{ONBOARD_SOL_COST} SOL
                  {lookupData?.maker?.dc_sufficient
                    ? ' (maker pays DC)'
                    : ` + ${formatDcCost(onboardMode, fees)}`
                  }
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {!connected && <WalletMultiButton className="!rounded-lg !text-sm !h-9" />}
              <button
                onClick={handleOnboard}
                disabled={loading || !connected || !locationComplete}
                className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading ? 'Onboarding...' : 'Onboard & Assert Location'}
              </button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
              <CheckCircleIcon className="h-6 w-6 text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Hotspot onboarded successfully
                </p>
                <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                  Your Hotspot is now registered on the Helium IoT network.
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {txSignature && (
                <a
                  href={`https://solscan.io/tx/${txSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-lg border border-border p-3 text-sm text-content-secondary hover:border-accent hover:text-accent-text transition"
                >
                  <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0" />
                  View on Solscan
                </a>
              )}
              {ble.pubkey && (
                <>
                  <a
                    href={`https://world.helium.com/network/iot/hotspot/${ble.pubkey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 rounded-lg border border-border p-3 text-sm text-content-secondary hover:border-accent hover:text-accent-text transition"
                  >
                    <GlobeAltIcon className="h-4 w-4 shrink-0" />
                    Helium World
                  </a>
                  <a
                    href={`/hotspot-claimer?mode=hotspot&key=${encodeURIComponent(ble.pubkey)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 rounded-lg border border-border p-3 text-sm text-content-secondary hover:border-accent hover:text-accent-text transition"
                  >
                    <BoltIcon className="h-4 w-4 shrink-0" />
                    Claim Rewards
                  </a>
                  <a
                    href={`/hotspot-map?keys=${encodeURIComponent(ble.pubkey)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 rounded-lg border border-border p-3 text-sm text-content-secondary hover:border-accent hover:text-accent-text transition"
                  >
                    <MapPinIcon className="h-4 w-4 shrink-0" />
                    Hotspot Map
                  </a>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

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
            Hotspot Setup & Onboarding
          </h1>
          <p className="text-lg text-content-secondary">
            Connect to a Helium IoT Hotspot over Bluetooth to view diagnostics,
            configure WiFi, and onboard your Hotspot to the IoT network.
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
            {/* Connected header — compact bar with Hotspot identity */}
            <div className="rounded-xl border border-border bg-surface-raised px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <SignalIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-display font-semibold text-content leading-tight">
                    {ble.hotspotName || ble.device?.name || 'Helium Hotspot'}
                  </h2>
                  <p className="text-xs font-mono text-content-tertiary">
                    {ble.device?.name || 'Connected via Bluetooth'}
                  </p>
                </div>
              </div>
              <button
                onClick={ble.disconnect}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-inset transition"
              >
                Disconnect
              </button>
            </div>

            {/* Device & Network — side by side */}
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

            {/* On-chain onboarding — full width below */}
            <OnboardPanel ble={ble} />
          </div>
        )}
      </main>
    </div>
  );
}
