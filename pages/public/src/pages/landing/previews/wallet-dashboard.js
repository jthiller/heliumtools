// Wallet Dashboard: money and earnings; not a street map (that's Hotspot
// Map's motif). The Earnings "HNT per day" sheet (the latest UTC day's
// readout over its 7 day bars, mobile-activity.png) lies at the back, top
// right; the Wallet value ticket (the Summary money band's first column, the
// anchor: $585.27 over its HNT, SOL, DC and legacy MOBILE split, hero.png)
// sits in front of its lower-left corner and runs off the bottom, leaving the
// last bars in view. Featured (two columns wide): the fleet as a regional
// poster (the Map section's site groups from Milwaukee to Washington,
// fleet-map.png) on the left, the earnings sheet on the right, the ticket
// across both.
// Sources: scripts/tool-previews/capture/wallet-dashboard.mjs. Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.wallet[0],
  prints: [
    { id: "activity", src: { file: "mobile-activity.png", rect: { x: 0, y: 0, w: 448, h: 346 } }, out: 540, x: 61, y: 42, w: 72, r: 3, z: 1 },
    { id: "value", src: { file: "hero.png", rect: { x: 20, y: 124, w: 380, h: 224 } }, out: 480, x: 35, y: 77, w: 62, r: -4, z: 2 },
  ],
  featured: [
    { id: "fleet", src: { file: "fleet-map.png", rect: { x: 290, y: 61, w: 690, h: 520 } }, out: 700, q: 64, x: 29, y: 62, w: 50, r: -2.5, z: 1 },
    { id: "activity", x: 81, y: 60, w: 37, r: 3.5, z: 2 },
    { id: "value", x: 40, y: 29, w: 32, r: -3, z: 3 },
  ],
};
