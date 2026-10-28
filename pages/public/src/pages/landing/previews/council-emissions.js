// Council Emissions — a hero number over a chart and a strip. The emissions
// timeline (five seat lanes: emission bars colored by where they went, transfers
// below) lies at the back across the top, tilted left; the five per-seat
// "Where it went" bars cross the lower left the other way; the "Emitted to seats" tile
// (203,350 HNT at capture, the anchor) sits on the lower right on top. On hover
// the timeline fans up, the bars splay left and the tile lifts and straightens.
// Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.governance[0],
  prints: [
    { id: "timeline", src: { file: "timeline.png", rect: { x: 10, y: 74, w: 900, h: 460 } }, out: 680, x: 52, y: 38, w: 94, r: -3, z: 1 },
    { id: "bars", src: { file: "fate-bars.png", rect: { x: 0, y: 0, w: 940, h: 404 } }, out: 460, x: 34, y: 75, w: 64, r: 2.5, z: 2 },
    { id: "emitted", src: { file: "stat-emitted.png", rect: { x: 0, y: 0, w: 203, h: 138 } }, out: 340, x: 74, y: 77, w: 44, r: -2, z: 3 },
  ],
};
