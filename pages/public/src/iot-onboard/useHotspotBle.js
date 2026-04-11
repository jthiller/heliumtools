import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import animalHash from 'angry-purple-tiger';
import { SERVICE_UUID, Characteristic } from './bleTypes.js';
import {
  decodeDiagnostics,
  decodeWifiServices,
  encodeWifiConnect,
  decodeWifiConnect,
  encodeWifiRemove,
} from './bleProto.js';

const decoder = new TextDecoder();

function readString(dataView) {
  return decoder.decode(dataView.buffer);
}

export default function useHotspotBle() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [device, setDevice] = useState(null);
  const [pubkey, setPubkey] = useState(null);
  const [onboardingKey, setOnboardingKey] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [ethernetOnline, setEthernetOnline] = useState(null);
  const [wifiSsid, setWifiSsid] = useState(null);
  const [wifiNetworks, setWifiNetworks] = useState([]);
  const [wifiConfigured, setWifiConfigured] = useState([]);
  const [wifiConnectStatus, setWifiConnectStatus] = useState(null);
  const [activity, setActivity] = useState([]);

  const hotspotName = useMemo(() => pubkey ? animalHash(pubkey) : null, [pubkey]);

  const log = useCallback((msg) => {
    setActivity((prev) => [...prev, msg]);
  }, []);

  const serviceRef = useRef(null);
  const scanningRef = useRef(false);
  const disconnectHandlerRef = useRef(null);

  const readCharacteristic = useCallback(async (uuid) => {
    const char = await serviceRef.current.getCharacteristic(uuid);
    return char.readValue();
  }, []);

  const scan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setError(null);
    setActivity([]);
    setStatus('scanning');
    try {
      log('Requesting Bluetooth device...');
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
      });

      // Remove stale listener if re-scanning the same device
      if (disconnectHandlerRef.current) {
        dev.removeEventListener('gattserverdisconnected', disconnectHandlerRef.current);
      }
      disconnectHandlerRef.current = () => {
        serviceRef.current = null;
        setStatus('disconnected');
      };
      dev.addEventListener('gattserverdisconnected', disconnectHandlerRef.current);
      setDevice(dev);

      setStatus('connecting');
      log(`Device found: ${dev.name || 'Helium Hotspot'}`);
      log('Connecting to GATT server...');
      const server = await dev.gatt.connect();
      log('GATT connected');
      log('Discovering Helium service...');
      const svc = await server.getPrimaryService(SERVICE_UUID);
      log('Service discovered');
      serviceRef.current = svc;

      const safeRead = async (label, uuid) => {
        log(`Reading ${label}...`);
        try {
          const val = await readCharacteristic(uuid);
          log(`${label}: OK`);
          return val;
        } catch {
          log(`${label}: not available`);
          return null;
        }
      };

      const pkVal = await safeRead('Public key', Characteristic.PUBKEY);
      if (pkVal) {
        const pk = readString(pkVal);
        setPubkey(pk);
        log(`Hotspot: ${animalHash(pk)}`);
      }

      const okVal = await safeRead('Onboarding key', Characteristic.ONBOARDING_KEY);
      if (okVal) setOnboardingKey(readString(okVal));

      const diagVal = await safeRead('Diagnostics', Characteristic.DIAGNOSTICS);
      if (diagVal) setDiagnostics(decodeDiagnostics(diagVal.buffer));

      const ethVal = await safeRead('Ethernet status', Characteristic.ETHERNET_ONLINE);
      if (ethVal) setEthernetOnline(readString(ethVal) === 'true');

      const ssidVal = await safeRead('WiFi SSID', Characteristic.WIFI_SSID);
      if (ssidVal) setWifiSsid(readString(ssidVal));

      log('Ready');
      setStatus('connected');
    } catch (err) {
      if (err.name === 'NotFoundError' || err.code === 8) {
        setStatus('idle');
        return;
      }
      log(`Error: ${err.message}`);
      setError(err.message);
      setStatus('error');
    } finally {
      scanningRef.current = false;
    }
  }, [readCharacteristic]);

  const disconnect = useCallback(() => {
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }
  }, [device]);

  const refreshDiagnostics = useCallback(async () => {
    if (!serviceRef.current) return;
    const val = await readCharacteristic(Characteristic.DIAGNOSTICS);
    setDiagnostics(decodeDiagnostics(val.buffer));
  }, [readCharacteristic]);

  const refreshWifi = useCallback(async () => {
    if (!serviceRef.current) return;
    const availVal = await readCharacteristic(Characteristic.WIFI_SERVICES);
    setWifiNetworks(decodeWifiServices(availVal.buffer));

    const confVal = await readCharacteristic(Characteristic.WIFI_CONFIGURED);
    setWifiConfigured(decodeWifiServices(confVal.buffer));

    try {
      const ssidVal = await readCharacteristic(Characteristic.WIFI_SSID);
      setWifiSsid(readString(ssidVal));
    } catch {}
  }, [readCharacteristic]);

  const connectWifi = useCallback(async (ssid, password) => {
    if (!serviceRef.current) return;
    setWifiConnectStatus('connecting');
    let char;
    try {
      console.log('[BLE WiFi] Getting WIFI_CONNECT characteristic...');
      char = await serviceRef.current.getCharacteristic(Characteristic.WIFI_CONNECT);

      // Read current value before writing to see baseline state
      try {
        const cur = await char.readValue();
        console.log('[BLE WiFi] Current value before write:', readString(cur));
      } catch (e) {
        console.log('[BLE WiFi] Could not read current value:', e.message);
      }

      console.log('[BLE WiFi] Starting notifications...');
      await char.startNotifications();

      const TERMINAL = new Set(['connected', 'failed', 'timeout', 'invalid']);

      const resultPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          console.log('[BLE WiFi] 60s timeout reached, no terminal status received');
          char.removeEventListener('characteristicvaluechanged', handler);
          reject(new Error('WiFi connection timed out'));
        }, 60_000);

        function handler(event) {
          const raw = readString(event.target.value);
          const val = raw.trim().toLowerCase();
          console.log('[BLE WiFi] Notification received:', JSON.stringify(raw), '→', val);
          setWifiConnectStatus(val);
          if (TERMINAL.has(val)) {
            clearTimeout(timer);
            char.removeEventListener('characteristicvaluechanged', handler);
            resolve(val);
          }
        }
        char.addEventListener('characteristicvaluechanged', handler);
      });

      const encoded = encodeWifiConnect(ssid, password);
      const verified = decodeWifiConnect(encoded);
      console.log('[BLE WiFi] Encoded payload:', JSON.stringify(verified), '(', encoded.length, 'bytes, hex:', Array.from(encoded).map(b => b.toString(16).padStart(2, '0')).join(' '), ')');
      await char.writeValue(encoded);
      console.log('[BLE WiFi] Write complete, waiting for notifications...');

      const result = await resultPromise;
      console.log('[BLE WiFi] Terminal result:', result);

      await refreshWifi();
    } catch (err) {
      console.error('[BLE WiFi] Error:', err.message);
      setWifiConnectStatus(`error: ${err.message}`);
    } finally {
      try { await char?.stopNotifications(); } catch {}
    }
  }, [refreshWifi]);

  const removeWifi = useCallback(async (ssid) => {
    if (!serviceRef.current) return;
    const char = await serviceRef.current.getCharacteristic(Characteristic.WIFI_REMOVE);
    await char.writeValue(encodeWifiRemove(ssid));
    await refreshWifi();
  }, [refreshWifi]);

  const identifyLights = useCallback(async () => {
    if (!serviceRef.current) return;
    const char = await serviceRef.current.getCharacteristic(Characteristic.LIGHTS);
    await char.writeValue(new Uint8Array([1]));
  }, []);

  // Detect silent disconnects via periodic GATT liveness check
  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => {
      if (!device?.gatt?.connected) {
        serviceRef.current = null;
        setStatus('disconnected');
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [status, device]);

  return {
    status,
    error,
    activity,
    device,
    hotspotName,
    pubkey,
    onboardingKey,
    diagnostics,
    ethernetOnline,
    wifiSsid,
    wifiNetworks,
    wifiConfigured,
    wifiConnectStatus,
    scan,
    disconnect,
    refreshDiagnostics,
    refreshWifi,
    connectWifi,
    removeWifi,
    identifyLights,
  };
}
