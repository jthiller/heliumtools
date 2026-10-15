// Update Hotspot Location — a portrait of the location picker (the pin on its
// res-12 hex, the anchor shape, in the top third) with the tool's own
// Latitude / Longitude row laid across it like a caption, so the card reads as a
// cross: the cell, and the coordinates it asserts. The map crop starts low enough
// that "Lincoln Avenue" peeks out above the row (a real street map, not a block
// field). The row clears the card's left edge by ~18px at rest (~12px on hover)
// and bleeds decisively through the Longitude input on the right, never a
// near-tangent. Both come from one page state (scripts/tool-previews/capture/update-location.mjs,
// dpr 4): "Huge Lava Raccoon" with a new location typed in, never submitted.
// Schema: ./index.js.
import { TONES } from "./tones.js";

export default {
  tone: TONES.hotspot[2],
  prints: [
    { id: "map", src: { file: "map-macro.png", rect: { x: 0, y: 30, w: 216, h: 252 } }, out: 500, x: 53, y: 58, w: 70, r: -4, z: 1, fr: -7 },
    { id: "coords", src: { file: "fields-macro.png", rect: { x: 4, y: 12, w: 334, h: 72 } }, out: 820, x: 57, y: 74, w: 104, r: 2.5, z: 2, fy: 0 },
  ],
};
