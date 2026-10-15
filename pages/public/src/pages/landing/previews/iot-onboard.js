// IoT Hotspot Setup — the setup flow as two prints: the WiFi step's scanned
// networks (three rows of chips, Rooftop-Mesh-5G picked) as a sheet running off
// the right edge, and the paired Hotspot's Bluetooth identity bar laid across
// its lower half as the anchor (Electric Pewter Perch, ~1.3x). Both are dpr-3
// macros. Sources: scripts/tool-previews/capture/iot-onboard.mjs (mocked BLE).
// Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.hotspot[0],
  prints: [
    { id: "wifi", src: { file: "wifi-macro.png", rect: { x: 22, y: 224, w: 350, h: 136 } }, out: 760, x: 59, y: 36, w: 100, r: -2.5, z: 1 },
    { id: "hotspot", src: { file: "identity-macro.png", rect: { x: 24, y: 21, w: 240, h: 64 } }, out: 680, x: 49, y: 75, w: 88, r: 2, z: 2 },
  ],
};
