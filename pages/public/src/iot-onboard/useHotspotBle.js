import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import animalHash from 'angry-purple-tiger';
import { SERVICE_UUID, Characteristic } from './bleTypes.js';
import {
  decodeDiagnostics,
  decodeWifiServices,
  encodeWifiConnect,
  encodeWifiRemove,
} from './bleProto.js';

const decoder = new TextDecoder();
const TERMINAL_WIFI_STATES = new Set(['connected', 'failed', 'timeout', 'invalid']);

function readString(dataView) {
  return decoder.decode(new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength));
}

function dataViewToBytes(dataView) {
  return new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
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
    setActivity((prev) => [...prev.slice(-99), msg]);
  }, []);

  const serviceRef = useRef(null);
  const scanningRef = useRef(false);
  const deviceRef = useRef(null);
  const disconnectHandlerRef = useRef(null);
  const intentionalDisconnectRef = useRef(false);

  const readCharacteristic = useCallback(async (uuid) => {
    const char = await serviceRef.current.getCharacteristic(uuid);
    return char.readValue();
  }, []);

  function clearConnectionState() {
    setPubkey(null);
    setOnboardingKey(null);
    setDiagnostics(null);
    setEthernetOnline(null);
    setWifiSsid(null);
    setWifiNetworks([]);
    setWifiConfigured([]);
    setWifiConnectStatus(null);
  }

  function cleanupDevice() {
    if (disconnectHandlerRef.current && deviceRef.current) {
      deviceRef.current.removeEventListener('gattserverdisconnected', disconnectHandlerRef.current);
      disconnectHandlerRef.current = null;
    }
  }

  const scan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    // Clean up previous device before opening picker
    cleanupDevice();
    intentionalDisconnectRef.current = false;
    setError(null);
    setActivity([]);
    clearConnectionState();
    setStatus('scanning');
    try {
      log('Requesting Bluetooth device...');
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
      });
      disconnectHandlerRef.current = () => {
        serviceRef.current = null;
        if (!intentionalDisconnectRef.current) {
          setStatus('disconnected');
        }
      };
      dev.addEventListener('gattserverdisconnected', disconnectHandlerRef.current);
      deviceRef.current = dev;
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
      if (diagVal) setDiagnostics(decodeDiagnostics(dataViewToBytes(diagVal)));

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
      // Clean up GATT if connection succeeded but a later step failed
      cleanupDevice();
      try { deviceRef.current?.gatt?.disconnect(); } catch {}
      log(`Error: ${err.message}`);
      setError(err.message);
      setStatus('error');
    } finally {
      scanningRef.current = false;
    }
  }, [readCharacteristic, log]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    serviceRef.current = null;
    clearConnectionState();
    setActivity([]);
    setStatus('idle');
    try { deviceRef.current?.gatt?.disconnect(); } catch {}
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    if (!serviceRef.current) return;
    try {
      const val = await readCharacteristic(Characteristic.DIAGNOSTICS);
      setDiagnostics(decodeDiagnostics(dataViewToBytes(val)));
    } catch {}
  }, [readCharacteristic]);

  const refreshWifi = useCallback(async () => {
    if (!serviceRef.current) return;
    try {
      const availVal = await readCharacteristic(Characteristic.WIFI_SERVICES);
      setWifiNetworks(decodeWifiServices(dataViewToBytes(availVal)));
    } catch {}

    try {
      const confVal = await readCharacteristic(Characteristic.WIFI_CONFIGURED);
      setWifiConfigured(decodeWifiServices(dataViewToBytes(confVal)));
    } catch {}

    try {
      const ssidVal = await readCharacteristic(Characteristic.WIFI_SSID);
      setWifiSsid(readString(ssidVal));
    } catch {}
  }, [readCharacteristic]);

  const connectWifi = useCallback(async (ssid, password) => {
    if (!serviceRef.current) return;
    setWifiConnectStatus('connecting');
    let char;
    let timer;
    let handler;
    try {
      char = await serviceRef.current.getCharacteristic(Characteristic.WIFI_CONNECT);
      await char.startNotifications();


      const resultPromise = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          char.removeEventListener('characteristicvaluechanged', handler);
          reject(new Error('WiFi connection timed out'));
        }, 60_000);

        handler = (event) => {
          const val = readString(event.target.value).trim().toLowerCase();
          setWifiConnectStatus(val);
          if (TERMINAL_WIFI_STATES.has(val) || val.startsWith('error')) {
            clearTimeout(timer);
            char.removeEventListener('characteristicvaluechanged', handler);
            resolve(val);
          }
        };
        char.addEventListener('characteristicvaluechanged', handler);
      });

      await char.writeValue(encodeWifiConnect(ssid, password));
      await resultPromise;

      await refreshWifi();
    } catch (err) {
      setWifiConnectStatus(`error: ${err.message}`);
    } finally {
      if (timer) clearTimeout(timer);
      if (handler && char) char.removeEventListener('characteristicvaluechanged', handler);
      try { await char?.stopNotifications(); } catch {}
    }
  }, [refreshWifi]);

  const removeWifi = useCallback(async (ssid) => {
    if (!serviceRef.current) return;
    try {
      const char = await serviceRef.current.getCharacteristic(Characteristic.WIFI_REMOVE);
      await char.writeValue(encodeWifiRemove(ssid));
      await refreshWifi();
    } catch {}
  }, [refreshWifi]);

  const identifyLights = useCallback(async () => {
    if (!serviceRef.current) return;
    try {
      const char = await serviceRef.current.getCharacteristic(Characteristic.LIGHTS);
      await char.writeValue(new Uint8Array([1]));
    } catch {}
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupDevice();
      try { deviceRef.current?.gatt?.disconnect(); } catch {}
    };
  }, []);

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
