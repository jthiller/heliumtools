// Brand Guidelines — the logo-family sheet with a download ticket lying on it.
// The sheet is the page's own Logo family matrix (Helium, Helium Roundel and
// HeliumOS rows in their purple, black and white colorways, as the page renders
// them), tilted back and bleeding off the bottom, so the full Helium row and the
// whole purple column stay in view. The ticket is that purple roundel's own
// download rows from the dpr-3 macro (Purple #5F26FC, SVG 421x421 · 2.5 KB,
// PNG 841x841 px · 29.5 KB), laid over the black and white tiles of the lower
// rows and running off the right edge; its top edge sits on the gap above the
// roundel row, so no logo is cut by it at rest. Anchor: the SVG/PNG rows at
// ~1.17x of their 12px text on a phone card. Logos are never cropped out on
// their own or enlarged. On hover the ticket straightens and lifts and the
// sheet turns a little further back.
//
// Wide (the card has the whole Brand row): the same sheet and ticket, with the
// page's own "The mark" panel (the roundel on its 45° axis beside the text that
// explains it, never the roundel cut out on its own) as a third sheet at the
// back, top right, running off the right edge. Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.brand[0],
  prints: [
    { id: "family", src: { file: "hero.png", rect: { x: 28, y: 96, w: 968, h: 804 } }, out: 680, x: 45, y: 58, w: 90, r: -3.5, z: 1, fr: -5.5, q: 82 },
    { id: "files", src: { file: "detail.png", rect: { x: 8, y: 152, w: 235, h: 116 } }, out: 660, x: 70, y: 72.5, w: 80, r: 2.5, z: 2, fx: 2 },
  ],
  wide: [
    { id: "mark", src: { file: "mark.png", rect: { x: 29, y: 101, w: 958, h: 458 } }, out: 760, x: 75, y: 31, w: 54, r: 3, z: 1, q: 82 },
    { id: "family", x: 31, y: 63, w: 50, r: -3.5, z: 2, fr: -5 },
    { id: "files", x: 66, y: 75, w: 40, r: 2.5, z: 3 },
  ],
};
