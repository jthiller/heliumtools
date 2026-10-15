// Mobile WiFi Onboarding — the Manage tab's converted networks as a ledger
// (anchor: three names with their "Converted WiFi" pills, ~1x), running off the
// bottom edge, with the AP Setup Guide's three RadSec servers (:2083) as a mono
// ticket tucked behind its top-right corner. No map and no name chips: those are
// Update Location's and IoT Setup's motifs in the same row.
// Sources: scripts/tool-previews/capture/mobile-onboard.mjs. Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.hotspot[1],
  prints: [
    { id: "radsec", src: { file: "radsec-passpoint.png", rect: { x: 416, y: 62, w: 192, h: 102 } }, out: 384, x: 66, y: 24, w: 50, r: 4.5, z: 1, fr: 7.5 },
    { id: "list", src: { file: "network-list.png", rect: { x: 30, y: 130, w: 320, h: 200 } }, out: 640, x: 47, y: 75, w: 90, r: -3, z: 2, fy: -1.8 },
  ],
};
