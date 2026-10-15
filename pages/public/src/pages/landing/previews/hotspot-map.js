// Hotspot Map — the pitched New York swarm as the poster (the anchor), running
// off the bottom and right edges, with the map's own hover tooltip (a dpr-3
// macro, the hovered dot at its left) laid over the poster's empty New Jersey
// corner, so it names one Hotspot without hiding any of the swarm.
// Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.hotspot[5],
  prints: [
    { id: "map", src: { file: "map-perspective.png", rect: { x: 150, y: 112, w: 620, h: 476 } }, out: 660, x: 61, y: 62, w: 96, r: -5, z: 1, q: 60, fr: -6.5 },
    { id: "hover", src: { file: "detail.png", rect: { x: 140, y: 89, w: 298, h: 86 } }, out: 500, x: 30, y: 19, w: 64, r: 3, z: 2 },
  ],
};
