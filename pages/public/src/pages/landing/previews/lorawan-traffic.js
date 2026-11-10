// LoRaWAN Traffic Map — the Europe swarm as the poster (the anchor): every
// operator's dots in its own color, running off the bottom and right edges.
// Laid over its top is the operator picker's first rows at dpr 3, whose color
// dots are the map's legend: an operator by name or by OUI number, with its
// Hotspots and packets.
// Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.hotspot[6],
  prints: [
    { id: "map", src: { file: "map-europe.png", rect: { x: 200, y: 110, w: 640, h: 500 } }, out: 640, x: 58, y: 62, w: 98, r: -4, z: 1, q: 55 },
    { id: "operators", src: { file: "operators.png", rect: { x: 0, y: 128, w: 380, h: 129 } }, out: 620, x: 42, y: 26, w: 78, r: 3, z: 2 },
  ],
};
