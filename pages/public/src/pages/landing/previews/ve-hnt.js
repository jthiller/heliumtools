// veHNT Positions — a hero number over a sheet. The summary (30 HNT locked |
// 143.83 veHNT total voting power, the anchor) lies on top, wide and close to
// square, so it is the print that straightens and lifts on hover. Under it, the
// delegated position (01/02 · Delegated · MOBILE: 15 HNT Cliff, 126.07 veHNT,
// "Unlocks in 122d 16h" with its lockup bar) is the larger back sheet, turned
// the other way and running off the bottom and right edges, its header row
// tucked under the summary. Two prints, not
// three: the near-identical undelegated card only added small text.
//
// Both prints are dpr-3 macros shot at a 412px phone viewport, so the summary's
// two figures sit close together. From one page load, light then dark:
// `node scripts/tool-previews/capture/ve-hnt.mjs macros`. Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.holders[1],
  prints: [
    { id: "delegated", src: { file: "position-delegated-narrow.png", rect: { x: 22, y: 14, w: 360, h: 222 } }, out: 620, x: 63, y: 76, w: 80, r: 4, z: 1 },
    { id: "summary", src: { file: "summary-narrow.png", rect: { x: 22, y: 24, w: 360, h: 118 } }, out: 720, x: 46, y: 36.5, w: 88, r: -2.5, z: 2 },
  ],
};
