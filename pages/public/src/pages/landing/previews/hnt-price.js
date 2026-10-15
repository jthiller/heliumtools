// HNT Price API — a hero number over a sheet. The tall /current endpoint card
// (curl, Try /current and the real JSON response, its "usd": 0.4228… lines
// whole) lies at the back, tilted left and running off the bottom edge; the live
// market price ticket ($0.4229, the anchor) sits on its lower-right corner,
// tilted the other way. On hover the sheet fans left while the ticket lifts and
// straightens. Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.holders[0],
  prints: [
    { id: "current", src: { file: "current-json-response.png", rect: { x: 42, y: 44, w: 300, h: 340 } }, out: 520, x: 37, y: 61, w: 63, r: -4, z: 1, fx: -2, fr: -6.5 },
    { id: "price", src: { file: "detail.png", rect: { x: 4, y: 2, w: 199, h: 132 } }, out: 480, x: 69.5, y: 71, w: 56, r: 2.5, z: 2 },
  ],
};
