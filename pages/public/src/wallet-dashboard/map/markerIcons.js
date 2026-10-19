// The fleet map's dot sprites: one prebuilt atlas of every dot the map draws
// (mapEncoding's `dotOf` ids), painted once per color scheme from the
// dashboard's tokens so the canvas dots match the HTML ones (loupe, phone
// preview, legend) pixel for pixel. Rings and halos keep fixed pixel widths
// because each size is its own sprite. Colored sprites (not tinted masks):
// a dot can be two-tone, or a status mark with a white bar; deck's IconLayer
// still applies `getColor`'s alpha, which dims and fades them.
import { DOT_SIZE, HEALTH_SIZE } from "./mapEncoding.js";

const FILLS = ["mobile", "iot", "dual", "neutral", "hollow"];
const SIZES = [DOT_SIZE.quiet, DOT_SIZE.some, DOT_SIZE.base, DOT_SIZE.busy];
const RINGS = ["none", "caution", "critical", "checking"];
const SHAPES = ["critical", "caution", "quiet", "info", "unknown", "ok", "checking"];
// Each sprite leaves room for its widest decoration (a 3.5 px ring, a dashed
// outline 2.5 px out): logical size = dot + PAD.
const PAD = 10;
const HEALTH_BOX = 24;
/** The selection ring (34 px with raised halos both sides). */
export const SELECTED_ICON = "sel";
export const SELECTED_SIZE = 42;
const SCALE = 3; // sprite pixels per CSS pixel (crisp on 3x screens)
const ATLAS_W = 1024;

const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

function disc(ctx, r, color) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
function ring(ctx, r, width, color, dash) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.setLineDash(dash || []);
  ctx.stroke();
  ctx.setLineDash([]);
}
function poly(ctx, pts, color) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(w, h) / 2);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

// Network mode: fill = network, ring = status (the design's `.mp-mk` +
// `.mp-r-*`): a 1.5 px raised halo, a 2 px status ring outside it, or a
// dashed outline 2.5 px out while checking; hollow (not reported) is a raised
// dot with a 2 px inner ring.
function drawNetworkDot(ctx, c, fill, d, ringKind) {
  const r = d / 2;
  if (ringKind === "caution" || ringKind === "critical") disc(ctx, r + 3.5, rgb(c[ringKind]));
  disc(ctx, r + 1.5, rgb(c.raised));
  if (fill === "dual") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.fillStyle = rgb(c.iot);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.fillStyle = rgb(c.mobile);
    ctx.fill();
    ctx.restore();
  } else if (fill === "hollow") {
    disc(ctx, r, rgb(c.raised));
    ring(ctx, r - 1, 2, rgb(c.ink3));
  } else {
    disc(ctx, r, rgb(fill === "neutral" ? c.ink4 : c[fill]));
  }
  if (ringKind === "checking") ring(ctx, r + 3.25, 1.5, rgb(c.ink3), [3, 2.5]);
}

// Health mode: shape = tier (the status marks at 16 px).
function drawHealthDot(ctx, c, shape) {
  const r = HEALTH_SIZE / 2;
  const k = HEALTH_SIZE / 12;
  switch (shape) {
    case "critical":
      disc(ctx, r + 1.2 * k, rgb(c.raised));
      disc(ctx, r, rgb(c.critical));
      rect(ctx, -1 * k, -3.5 * k, 2 * k, 4.5 * k, "#fff");
      rect(ctx, -1 * k, 2 * k, 2 * k, 1.9 * k, "#fff");
      break;
    case "caution":
      poly(ctx, [[0, -11], [10.5, 8.6], [-10.5, 8.6]], rgb(c.raised));
      poly(ctx, [[0, -7.36], [8, 7.04], [-8, 7.04]], rgb(c.caution));
      break;
    case "quiet":
      disc(ctx, r + 1.2 * k, rgb(c.raised));
      ring(ctx, r - 0.75 * k, 1.5 * k, rgb(c.ink3));
      rect(ctx, -2 * k, -0.25 * k, 4 * k, 1.5 * k, rgb(c.ink3));
      break;
    case "info":
      disc(ctx, r + 1.2 * k, rgb(c.raised));
      ring(ctx, r - 0.75 * k, 1.5 * k, rgb(c.ink3));
      rect(ctx, -0.25 * k, -3 * k, 1.5 * k, 3.5 * k, rgb(c.ink3));
      rect(ctx, -0.25 * k, -0.75 * k, 3 * k, 1.5 * k, rgb(c.ink3));
      break;
    case "unknown":
      disc(ctx, r + 1.5, rgb(c.raised));
      ring(ctx, r - 1, 2, rgb(c.ink3));
      break;
    case "checking":
      disc(ctx, r, rgb(c.raised));
      ring(ctx, r + 1.75, 1.5, rgb(c.ink3), [3, 2.5]);
      break;
    default:
      disc(ctx, r + 1.5, rgb(c.raised));
      disc(ctx, r, rgb(c.ink3));
  }
}

function drawSelected(ctx, c) {
  ring(ctx, 16, 6, rgb(c.raised));
  ring(ctx, 16, 2, rgb(c.ink));
}

/**
 * Paint the atlas for one color scheme. `colors`: basemap.js `overlayColors()`
 * (`[r, g, b]` per token, read in a memo keyed on dark mode).
 * @returns {{ url: string, mapping: Record<string, {x, y, width, height, anchorX, anchorY, mask}>,
 *   size: Record<string, number> }}  `url` the atlas PNG (data URL) for deck's
 *   IconLayer, `size` each sprite's size in CSS px (its `getSize`).
 */
export function buildMarkerAtlas(colors) {
  const sprites = [];
  for (const fill of FILLS) {
    for (const d of SIZES) {
      for (const r of RINGS) sprites.push({ id: `${fill}-${d}-${r}`, box: d + PAD, draw: (ctx) => drawNetworkDot(ctx, colors, fill, d, r) });
    }
  }
  for (const shape of SHAPES) sprites.push({ id: `h-${shape}`, box: HEALTH_BOX, draw: (ctx) => drawHealthDot(ctx, colors, shape) });
  sprites.push({ id: SELECTED_ICON, box: SELECTED_SIZE, draw: (ctx) => drawSelected(ctx, colors) });

  // Shelf-pack in rows.
  const mapping = {};
  const size = {};
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const s of sprites) {
    const px = Math.ceil(s.box * SCALE) + 2;
    if (x + px > ATLAS_W) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    s.x = x;
    s.y = y;
    s.px = px;
    x += px;
    rowH = Math.max(rowH, px);
  }
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = y + rowH;
  const ctx = canvas.getContext("2d");
  for (const s of sprites) {
    const w = s.px - 2;
    ctx.save();
    ctx.translate(s.x + 1 + w / 2, s.y + 1 + w / 2);
    ctx.scale(SCALE, SCALE);
    s.draw(ctx);
    ctx.restore();
    mapping[s.id] = { x: s.x + 1, y: s.y + 1, width: w, height: w, anchorX: w / 2, anchorY: w / 2, mask: false };
    size[s.id] = s.box;
  }
  return { url: canvas.toDataURL("image/png"), mapping, size };
}
