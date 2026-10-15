// OUI Notifier — two stat tickets staggered onto the sawtooth. The Days
// Remaining tile (front, ~1x) is the anchor; the Balance tile tucks behind its
// top-right corner; below, the 9/20–10/14 zoom of the 30-day history (burn,
// top-up spike, burn again, with the 9/24 tooltip) tilts clockwise so both
// burn-downs read as falling, and runs off the bottom-right corner. The tiles
// only overlap the chart's empty top-left. All three crops come from hero.png
// (light and dark are the same load, pixel-aligned). Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.network[0],
  prints: [
    { id: "chart", src: { file: "hero.png", rect: { x: 178, y: 250, w: 486, h: 164 } }, out: 780, x: 55, y: 75, w: 102, r: 3, z: 1 },
    { id: "balance", src: { file: "hero.png", rect: { x: 44, y: 50, w: 172, h: 104 } }, out: 300, x: 75, y: 22.5, w: 38, r: 6, z: 2 },
    { id: "days", src: { file: "hero.png", rect: { x: 368, y: 50, w: 172, h: 104 } }, out: 344, x: 31, y: 35, w: 52, r: -4, z: 3 },
  ],
};
