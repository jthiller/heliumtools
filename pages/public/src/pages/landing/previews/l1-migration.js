// L1 Migration — the derived address pair as two receipt strips cascading
// under the "Migration successful!" banner. The banner (cut to its icon and
// message) is tossed top right, its lower-left corner tucked under the Helium
// strip; the Helium and Solana rows of the derived-address card are cut apart
// from the dpr-3 macro and lie at opposing tilts, so they converge and overlap
// as they run off the right edge. The Solana strip is the biggest and on top.
// Anchor: the teal Solana address (~1.2x of its 14px mono). On hover the
// banner lifts away up-right, the Helium strip slides left and the Solana
// strip straightens. Light and dark are the same page state, pixel-aligned.
// Sources: scripts/tool-previews/capture/l1-migration.mjs. Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.holders[2],
  prints: [
    { id: "migrated", src: { file: "success-banner.png", rect: { x: 36, y: 29, w: 196, h: 40 } }, out: 392, x: 62, y: 17, w: 62, r: -3, z: 1, fx: 1.6, fy: -1, fr: -2 },
    { id: "helium", src: { file: "detail.png", rect: { x: 0, y: 3, w: 448, h: 60 } }, out: 960, x: 73, y: 44, w: 128, r: 4, z: 2, fx: -1.4, fy: 0.4, fr: 5.5 },
    { id: "solana", src: { file: "detail.png", rect: { x: 0, y: 80, w: 405, h: 63 } }, out: 1000, x: 73, y: 73, w: 136, r: -4.5, z: 3, fx: 1.2, fy: -0.8 },
  ],
};
