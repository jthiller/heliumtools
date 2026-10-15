// navigator.bluetooth MOCK for the /iot-onboard captures (headless Chrome has no
// Web Bluetooth); used by capture/iot-onboard.mjs. requestDevice() resolves a fake
// Helium IoT Hotspot whose GATT server exposes the gateway-config service
// 0fda92b2-... with the characteristics the page reads (src/iot-onboard/bleTypes.js),
// returning values in the same wire formats the page decodes
// (src/iot-onboard/bleProto.js): plain ASCII strings for PUBKEY / ONBOARDING_KEY /
// ETHERNET_ONLINE / WIFI_SSID, protobuf `diagnostics_v1` (map<string,string> = 1) and
// `wifi_services_v1` (repeated string = 1).
// Writes are accepted and ignored, except ADD_GATEWAY, which always throws — this
// mock can never produce a signed onboarding transaction.
//
// Keys are freshly generated, checksum-valid Helium ecc_compact addresses that do
// not belong to any real Hotspot.
export const HOTSPOT = {
  deviceName: 'Helium Hotspot 3C72',
  pubkey: '11qeJ9tSe8qDpWs76VBss1P3bHtEP5a659SJZqVrFDTydy1cwgi', // animal name: Electric Pewter Perch
  onboardingKey: '112aFDt13GhnLTiRQmYD8kJBv5bv4PJeT563zYbCbULKiSe8XXCc',
  ethernet: 'true',
  ssid: 'Rooftop-Mesh',
  // gateway-config diagnostics_v1 keys (wire order).
  diagnostics: [
    ['fw', '2023.04.18.0'],
    ['eth', 'e4:5f:01:8a:3c:72'],
    ['wifi', 'e4:5f:01:8a:3c:73'],
    ['ip', '192.168.1.87'],
    ['connected', 'yes'],
    ['dialable', 'yes'],
    ['nat_type', 'none'],
  ],
  wifiServices: ['Rooftop-Mesh', 'Rooftop-Mesh-5G', 'Workshop', 'NETGEAR47', 'TP-Link_8C2A', 'Linksys-Guest', 'xfinitywifi', 'DIRECT-4F-HP OfficeJet'],
  // One saved network (the current one): the WiFi card then ends level with the Diagnostics
  // card, so neither carries blank space and the 960px viewport fold lands in the card gap.
  wifiConfigured: ['Rooftop-Mesh'],
};

export function bleMockScript(h = HOTSPOT) {
  return `(() => {
    const H = ${JSON.stringify(h)};
    const SERVICE = '0fda92b2-44a2-4af2-84f5-fa682baa2b8d';
    const C = {
      WIFI_SERVICES: 'd7515033-7e7b-45be-803f-c8737b171a29',
      WIFI_CONFIGURED: 'e125bda4-6fb8-11ea-bc55-0242ac130003',
      WIFI_SSID: '7731de63-bc6a-4100-8ab1-89b2356b038b',
      WIFI_CONNECT: '398168aa-0111-4ec0-b1fa-171671270608',
      WIFI_REMOVE: '8cc6e0b3-98c5-40cc-b1d8-692940e6994b',
      ETHERNET_ONLINE: 'e5866bd6-0288-4476-98ca-ef7da6b4d289',
      PUBKEY: '0a852c59-50d3-4492-bfd3-22fe58a24f01',
      ONBOARDING_KEY: 'd083b2bd-be16-4600-b397-61512ca2f5ad',
      ADD_GATEWAY: 'df3b16ca-c985-4da2-a6d2-9b9b9abdb858',
      ASSERT_LOC: 'd435f5de-01a4-4e7d-84ba-dfd347f60275',
      DIAGNOSTICS: 'b833d34f-d871-422c-bf9e-8e6ec117d57e',
      LIGHTS: '180efdef-7579-4b4a-b2df-72733b7fa2fe',
    };
    const te = new TextEncoder();
    const varint = (n) => { const out = []; while (n > 127) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); return out; };
    const lenField = (tag, bytes) => [tag, ...varint(bytes.length), ...bytes];
    const str = (s) => Array.from(te.encode(s));
    // diagnostics_v1: map<string,string> diagnostics = 1 -> repeated entry { key = 1; value = 2; }
    const encDiag = (pairs) => pairs.flatMap(([k, v]) => lenField(0x0a, [...lenField(0x0a, str(k)), ...lenField(0x12, str(v))]));
    // wifi_services_v1: repeated string services = 1
    const encServices = (list) => list.flatMap((s) => lenField(0x0a, str(s)));
    const view = (arr) => { const u = new Uint8Array(arr); return new DataView(u.buffer, u.byteOffset, u.byteLength); };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const values = {
      [C.PUBKEY]: () => str(H.pubkey),
      [C.ONBOARDING_KEY]: () => str(H.onboardingKey),
      [C.DIAGNOSTICS]: () => encDiag(H.diagnostics),
      [C.ETHERNET_ONLINE]: () => str(H.ethernet),
      [C.WIFI_SSID]: () => str(H.ssid),
      [C.WIFI_SERVICES]: () => encServices(H.wifiServices),
      [C.WIFI_CONFIGURED]: () => encServices(H.wifiConfigured),
    };
    function makeChar(uuid) {
      const ch = new EventTarget();
      ch.uuid = uuid;
      ch.readValue = async () => {
        await sleep(120);
        if (uuid === C.ADD_GATEWAY) throw new DOMException('preview mock: no signing', 'NotSupportedError');
        const f = values[uuid];
        if (!f) throw new DOMException('GATT operation failed for unknown reason.', 'NetworkError');
        return view(f());
      };
      ch.writeValue = async () => {
        await sleep(80);
        if (uuid === C.ADD_GATEWAY) throw new DOMException('preview mock: no signing', 'NotSupportedError');
      };
      ch.writeValueWithResponse = ch.writeValue;
      ch.startNotifications = async () => ch;
      ch.stopNotifications = async () => ch;
      return ch;
    }
    const device = new EventTarget();
    device.id = 'preview-mock-device';
    device.name = H.deviceName;
    const service = {
      uuid: SERVICE, isPrimary: true,
      getCharacteristic: async (uuid) => {
        await sleep(30);
        if (!Object.values(C).includes(uuid)) throw new DOMException('No Characteristics matching UUID found in Service.', 'NotFoundError');
        return makeChar(uuid);
      },
    };
    const gatt = {
      device, connected: false,
      connect: async () => { await sleep(350); gatt.connected = true; return gatt; },
      disconnect: () => { if (!gatt.connected) return; gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
      getPrimaryService: async (uuid) => { await sleep(200); if (uuid !== SERVICE) throw new DOMException('No Services matching UUID found in Device.', 'NotFoundError'); return service; },
    };
    device.gatt = gatt;
    const bluetooth = {
      getAvailability: async () => true,
      requestDevice: async () => { await sleep(500); return device; },
      getDevices: async () => [device],
      addEventListener() {}, removeEventListener() {},
    };
    Object.defineProperty(navigator, 'bluetooth', { value: bluetooth, configurable: true });
  })();`;
}
