// Reads Tailwind design tokens from CSS custom properties (stored as RGB
// channels) for props that take colors, not Tailwind classes (recharts
// axis/grid/tooltip strokes, deck.gl layers). Use inside a `useMemo` keyed on
// the dark-mode flag so values refresh on theme toggle.

/** A token's current RGB channels, `[r, g, b]`; null when it isn't set. */
export function readTokenRgb(name) {
  if (typeof document === "undefined") return null;
  const parts = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return parts.length === 3 && !parts.some((n) => Number.isNaN(n)) ? parts : null;
}

export function readChartColors() {
  if (typeof document === "undefined") return null;
  const hex = (name) => {
    const rgb = readTokenRgb(name);
    if (!rgb) return "#999999";
    const [r, g, b] = rgb;
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  };
  return {
    stroke: hex("--color-accent-text"),
    grid: hex("--color-border"),
    tickText: hex("--color-content-tertiary"),
    tooltipBorder: hex("--color-border"),
    tooltipBg: hex("--color-surface-raised"),
    tooltipText: hex("--color-content"),
  };
}
