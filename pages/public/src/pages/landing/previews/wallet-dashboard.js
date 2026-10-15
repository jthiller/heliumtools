// Wallet Dashboard — money and activity; not a street map (that's
// Hotspot Map's motif). The Mobile activity sheet (473.99 HNT over its 7-day
// bars) lies at the back, top right; the portfolio ticket ($586.11,
// the anchor) sits in front of its lower-left corner and runs off the bottom,
// leaving the last bars in view.
// Sources: scripts/tool-previews/capture/wallet-dashboard.mjs. Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.wallet[0],
  prints: [
    { id: "activity", src: { file: "mobile-activity.png", rect: { x: 0, y: 0, w: 344, h: 262 } }, out: 540, x: 61, y: 42, w: 72, r: 3, z: 1 },
    { id: "value", src: { file: "hero.png", rect: { x: 28, y: 36, w: 248, h: 146 } }, out: 496, x: 35, y: 77, w: 62, r: -4, z: 2 },
  ],
};
