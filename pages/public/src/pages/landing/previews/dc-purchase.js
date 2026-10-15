// Buy Data Credits (disabled, Coming soon) — pay by card, then the order
// tracker: the upright Progress slip (Minting DC, Delegating to OUI) with the
// amount + "Continue to Coinbase" checkout strip laid over its edge, running
// off the right side. Anchor: $250. Schema: ./index.js.
// The card is not a link, so landing.css never fans its stack.
import { TONES } from "./tones.js";

export default {
  tone: TONES.network[2],
  prints: [
    { id: "progress", src: { file: "order-progress.png", rect: { x: 26, y: 30, w: 186, h: 270 } }, out: 320, x: 23, y: 45, w: 38, r: -4, z: 1, q: 82 },
    { id: "checkout", src: { file: "hero.png", rect: { x: 28, y: 246, w: 356, h: 194 } }, out: 640, x: 78.5, y: 64.5, w: 78, r: 3, z: 2, q: 82 },
  ],
};
