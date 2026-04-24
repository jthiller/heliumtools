// Reads Tailwind design tokens from CSS custom properties (stored as RGB
// channels) and converts them to hex — recharts axis/grid/tooltip stroke
// props take hex strings, not Tailwind classes. Use inside a `useMemo`
// keyed on the dark-mode flag so values refresh on theme toggle.
export function readChartColors() {
  if (typeof document === "undefined") return null;
  const style = getComputedStyle(document.documentElement);
  const hex = (name) => {
    const parts = style.getPropertyValue(name).trim().split(/\s+/).map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return "#999999";
    const [r, g, b] = parts;
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
