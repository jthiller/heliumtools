// Reward Claimer — a rewards receipt. The wallet's HNT column (its header, then
// 0.42 / <0.01 / 0.07 with their Claim links) stands as a ledger tape running
// off the bottom-left. Polite Burlap Crocodile's "14.61 Claimable" lies over it
// as a ticket that covers only the tape's Claim column, so every amount stays
// visible, and sits clear of the right edge. The tape's left frame is cut by
// the card edge along its whole height; the wallet's "Total HNT 23.67" band
// closes the receipt by bleeding off the bottom and hides the tape's 4th row.
// Anchor: 14.61, a dpr-4 macro shown at ~1.8x. The amounts are live at capture
// time; re-check the rects after re-running
// scripts/tool-previews/capture/hotspot-claimer.mjs. Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.hotspot[4],
  prints: [
    { id: "ledger", src: { file: "table-macro.png", rect: { x: 810, y: 70, w: 168, h: 380 } }, out: 340, x: 21.5, y: 73.5, w: 47.5, r: -3.5, z: 1, fx: 0.8, fr: -5 },
    { id: "total", src: { file: "list-macro.png", rect: { x: 18, y: 1179, w: 280, h: 42 } }, out: 600, x: 54, y: 95, w: 83, r: -0.5, z: 2, fx: 1, fy: 0, fr: -1 },
    { id: "claimable", src: { file: "pending-macro.png", rect: { x: 150, y: 142, w: 138, h: 36 } }, out: 500, x: 61, y: 54, w: 70, r: 3, z: 3, fx: 0.5, fy: -1 },
  ],
};
