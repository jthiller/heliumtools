// The dashboard's map base, shared by the fleet map and the detail's mini
// map: Carto Positron / Dark Matter styles, their attribution, and the
// overlay colors read from the dashboard's `--wd-*` tokens (RGB channel
// triplets, so they follow dark mode; read them in a memo keyed on it).

export const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
export const ATTRIBUTION = "© OpenStreetMap © CARTO";

/** The basemap style URL for the color scheme. */
export const basemapStyle = (dark) => (dark ? BASEMAP_DARK : BASEMAP_LIGHT);

// Light-mode values, for a read before the stylesheet applies.
const FALLBACK = {
  iot: [5, 150, 105],
  mobile: [124, 58, 237],
  critical: [225, 29, 72],
  caution: [217, 119, 6],
  ink: [28, 25, 23],
  ink2: [87, 83, 78],
  ink3: [120, 113, 108],
  ink4: [168, 162, 158],
  raised: [255, 255, 255],
  canvas: [250, 250, 248],
};
const TOKEN = {
  iot: "--wd-iot",
  mobile: "--wd-mobile",
  critical: "--wd-critical",
  caution: "--wd-caution",
  ink: "--wd-ink",
  ink2: "--wd-ink-2",
  ink3: "--wd-ink-3",
  ink4: "--wd-ink-4",
  raised: "--color-surface-raised",
  canvas: "--wd-canvas",
};

/** A `--wd-*` (or app) color token's current RGB channels, `[r, g, b]`; null when unset. */
export function readWdColor(name) {
  if (typeof document === "undefined") return null;
  const parts = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return parts.length === 3 && !parts.some((n) => Number.isNaN(n)) ? parts : null;
}

/** The overlay colors as `[r, g, b]`: iot, mobile, critical, caution, ink…ink4, raised, canvas. */
export function overlayColors() {
  return Object.fromEntries(Object.entries(TOKEN).map(([k, name]) => [k, readWdColor(name) ?? FALLBACK[k]]));
}
