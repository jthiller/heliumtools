// Mint Data Credits — the burn quote as a big ticket lying on the wallet sheet.
// The sheet is the wallet balance strip (HNT + DC, mono), cut below the purple
// Phantom pill so nothing outshouts the quote; it runs off the right edge. The ticket is the quote cut down to its two
// amounts (dpr-5 macro, shown at ~2.8x), crossing the sheet's lower edge and
// running off the bottom, where the card edge hides its rate line.
// Anchor: 2,103,700 DC. Sources: scripts/tool-previews/capture/dc-mint.mjs.
// Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.network[1],
  prints: [
    { id: "wallet", src: { file: "wallet-macro.png", rect: { x: 12, y: 70, w: 440, h: 72 } }, out: 760, x: 58, y: 31, w: 106, r: 3, z: 1, fx: 1.6, fr: 3.8 },
    { id: "quote", src: { file: "quote-macro.png", rect: { x: 270, y: 22, w: 99, h: 66 } }, out: 495, x: 50, y: 80, w: 76, r: -4, z: 2, fx: -0.6 },
  ],
};
