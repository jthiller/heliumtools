// Stage geometry shared by ToolPreview.jsx (the hover fan) and
// scripts/tool-previews/bake.mjs (the keep-out lint), so both measure a print
// the same way. Pure functions, no DOM.
//
// Units: x and w are % of the stage width; y is % of the stage height; the hover
// offsets fx/fy are cqw of the stage container (.tc-table), i.e. % of the stage
// width. A stage is 100 wide and 100 * ratio tall in those units.

// Stage height / width (landing.css: .tc-table::before padding and .tc-stage height).
export const STAGE_RATIO = { portrait: 0.8, wide: 0.55 };
// % of the stage height a print's top edge keeps clear of the card text (portrait)
// or the card's top edge (wide), at rest and on hover.
export const TOP_MARGIN = 3;
// Frame thickness, % of the stage width (landing.css clamp(4px, 1.7cqw, 7px) on a
// ~380px card; on wider stages the clamp makes it thinner, so this is conservative).
const FRAME = 1.7;
const HOVER_SCALE = 1.035; // the top print's hover scale

const round = (n) => Math.round(n * 100) / 100;

// Print height incl. frame, in stage-width units.
function printHeight(p) {
  const { w, h } = p.src.rect;
  return (p.w - 2 * FRAME) * (h / w) + 2 * FRAME;
}

// The highest point of a print's on-card outline (the part between x 0 and 100;
// what bleeds off a side can't reach the text), as % of the stage height, for a
// pose { fx, fy, fr, fs }. Rest pose: { fx: 0, fy: 0, fr: p.r, fs: 1 }.
export function topEdge(p, ratio, { fx = 0, fy = 0, fr = p.r, fs = 1 } = {}) {
  const cx = p.x + fx;
  const cy = p.y * ratio + fy;
  const hw = (p.w / 2) * fs;
  const hh = (printHeight(p) / 2) * fs;
  const t = (fr * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const pts = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
  let top = Infinity;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % 4];
    if (x1 >= 0 && x1 <= 100) top = Math.min(top, y1);
    for (const edge of [0, 100]) {
      if ((x1 - edge) * (x2 - edge) < 0) top = Math.min(top, y1 + ((edge - x1) / (x2 - x1)) * (y2 - y1));
    }
  }
  return (top / (100 * ratio)) * 100;
}

// Hover/focus fan. The top print straightens a little, lifts and scales up; the
// ones under it splay away from the stage centre with their tilt exaggerated,
// damped when the print already bleeds off that edge. A derived lift never takes
// a print's tilted, scaled top edge above TOP_MARGIN: it is cut short, or turned
// into a drop, by exactly the overshoot. Any value can be overridden per print
// (fx, fy in cqw; fr in deg; fs scale); overrides are taken as given and checked
// by the bake lint instead.
export function fan(p, isTop, ratio) {
  let pose;
  let lift; // the derived fy before the keep-out clamp
  if (isTop) {
    pose = { fx: p.fx ?? 0, fr: p.fr ?? round(p.r * 0.25), fs: p.fs ?? HOVER_SCALE };
    lift = -3;
  } else {
    const half = p.w / 2;
    const bleedsRight = p.x + half > 97;
    const bleedsLeft = p.x - half < 3;
    let fx = (p.x - 50) * 0.13;
    if ((bleedsRight && fx > 0) || (bleedsLeft && fx < 0)) fx *= 0.15;
    pose = { fx: p.fx ?? round(fx), fr: p.fr ?? round(p.r * 1.75 + Math.sign(p.r || 1)), fs: p.fs ?? 1 };
    lift = (p.y < 50 ? -2.2 : 1.2) + (p.y - 50) * 0.02;
  }
  if (p.fy !== undefined) return { ...pose, fy: p.fy };
  // Room above the pose's top edge, in cqw (negative: it already overshoots).
  const room = ((topEdge(p, ratio, { ...pose, fy: 0 }) - TOP_MARGIN) / 100) * 100 * ratio;
  return { ...pose, fy: round(Math.max(lift, -room)) };
}
