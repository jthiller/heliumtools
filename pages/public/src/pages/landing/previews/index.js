// Landing tool-card previews: slug -> config. One file per tool, named by the
// tool's slug in Landing.jsx. Every tool on the landing page needs an entry
// (a missing one renders an empty stone card and warns in dev). Docs, a11y and
// hover contract: ../CLAUDE.md.
//
// Config shape (default export of each <slug>.js):
//   tone    the card ground, one step of a section family from ./tones.js
//           ({ light, dark } x { g1, g2, glow, ink, shade })
//   prints  0-3 framed snapshots cropped from REAL captures, back to front, on
//           the portrait stage (100 x 80 cqw, anchored to the card bottom):
//     id    file stem of the baked asset:
//           src/assets/previews/<slug>/<id>-<light|dark>.webp
//     src   { file, rect: { x, y, w, h }, dpr? }: the capture in
//           scripts/tool-previews/captures/<slug>/<theme>/<file> and the crop
//           in CSS px of that capture (dpr comes from its manifest; light and
//           dark share the rect)
//     out   baked width in px (~2x the print's largest displayed width)
//     x, y  print centre on the stage, % of its width / height (prints may
//           bleed off the sides and bottom, never into the text)
//     w     print width incl. frame, % of the stage width
//     r     rest tilt (deg); z stacking order (the highest z is the "top"
//           print that straightens and lifts on hover)
//     fx, fy, fr, fs  optional hover overrides (cqw, cqw, deg, scale);
//           derived from x/y/r by ./layout.js fan() when omitted
//     q     optional WebP quality (default 78)
//   wide    optional, only for the single tool of a section: prints for the
//           landscape stage (100 x 55 cqw, right of a text column) the card
//           uses once its full-row width allows. Same fields; a wide print with
//           no `src` reuses the portrait print of that `id` (same baked file,
//           placed anew), so size its `out` for the larger of the two. Wide
//           prints may bleed right or bottom, never left into the text; their
//           top edge keeps TOP_MARGIN like the portrait ones (the bake lints it).
//
// Composition rules: one anchor per card (a number, a chart shape or a map
// swarm) whose text renders >= 14 CSS px on a 358px phone card; 2 big prints
// beat 3 small ones for dense UIs; tell form-like tools as strips. Nothing is
// drawn or recolored — crop, scale, tilt and layer only. Bake with
// `node scripts/tool-previews/bake.mjs <slug>`; it lints the keep-out margin
// (layout.js) at rest and on hover, the byte budget and the tone contrast.
import walletDashboard from "./wallet-dashboard.js";
import ouiNotifier from "./oui-notifier.js";
import dcMint from "./dc-mint.js";
import dcPurchase from "./dc-purchase.js";
import iotOnboard from "./iot-onboard.js";
import mobileOnboard from "./mobile-onboard.js";
import updateLocation from "./update-location.js";
import multiGateway from "./multi-gateway.js";
import hotspotClaimer from "./hotspot-claimer.js";
import hotspotMap from "./hotspot-map.js";
import hntPrice from "./hnt-price.js";
import veHnt from "./ve-hnt.js";
import l1Migration from "./l1-migration.js";
import brand from "./brand.js";

export const PREVIEWS = {
  "wallet-dashboard": walletDashboard,
  "oui-notifier": ouiNotifier,
  "dc-mint": dcMint,
  "dc-purchase": dcPurchase,
  "iot-onboard": iotOnboard,
  "mobile-onboard": mobileOnboard,
  "update-location": updateLocation,
  "multi-gateway": multiGateway,
  "hotspot-claimer": hotspotClaimer,
  "hotspot-map": hotspotMap,
  "hnt-price": hntPrice,
  "ve-hnt": veHnt,
  "l1-migration": l1Migration,
  brand,
};
