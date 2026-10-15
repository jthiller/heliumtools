// Add a Hotspot — one device's amber RSSI band as a print up top (on the cool
// jade ground, so the band pops in both themes), bleeding off the left edge only
// and clear of the text; the live packet stream running off the bottom edge; and
// that device's hovered packet pinned between them. Anchor: the band.
// Featured (two columns wide): the band large across the top, the packet
// table's signal columns (RSSI, SNR, frequency, spreading factor) lying across
// the lower right, and the hovered packet pinned at the lower left.
// Schema: ./index.js.
// Sources: scripts/tool-previews/capture/multi-gateway.mjs.
import { TONES } from "./tones.js";

export default {
  tone: TONES.hotspot[3],
  prints: [
    { id: "signal", src: { file: "detail-band.png", rect: { x: 24, y: 126, w: 580, h: 186 } }, out: 720, x: 42, y: 30, w: 92, r: -3.5, z: 1, fx: -1, fr: -5 },
    { id: "stream", src: { file: "packet-table.png", rect: { x: 0, y: 0, w: 320, h: 300 } }, out: 460, x: 32, y: 85.1, w: 59, r: -2, z: 2 },
    { id: "packet", src: { file: "tooltip.png", rect: { x: 16, y: 15, w: 181, h: 140 } }, out: 300, x: 79, y: 67, w: 36, r: 3.5, z: 3, fy: -0.6 },
  ],
  featured: [
    { id: "signal", x: 38, y: 36, w: 64, r: -3, z: 1 },
    { id: "rf", src: { file: "packet-table.png", rect: { x: 686, y: 0, w: 418, h: 280 } }, out: 560, x: 78, y: 74, w: 40, r: 3, z: 2 },
    { id: "packet", x: 22, y: 76, w: 24, r: -2.5, z: 3 },
  ],
};
