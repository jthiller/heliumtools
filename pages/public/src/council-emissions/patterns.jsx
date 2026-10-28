import { FATE, fateColor } from "./format.js";

// One fill pattern per fate, drawn over its color, so no chart or legend
// relies on color alone. Defined once per page and referenced by id.
export function PatternDefs({ dark }) {
  const ink = dark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.65)";
  return (
    <defs>
      <pattern id="ce-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="2.2" height="6" fill={ink} />
      </pattern>
      <pattern id="ce-rstripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="2.2" height="6" fill={ink} />
      </pattern>
      <pattern id="ce-vstripes" width="5" height="5" patternUnits="userSpaceOnUse">
        <rect width="1.6" height="5" fill={ink} />
      </pattern>
      <pattern id="ce-hstripes" width="5" height="5" patternUnits="userSpaceOnUse">
        <rect width="5" height="1.6" fill={ink} />
      </pattern>
      <pattern id="ce-dots" width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="1.2" fill={ink} />
      </pattern>
      <pattern id="ce-bigdots" width="9" height="9" patternUnits="userSpaceOnUse">
        <circle cx="4.5" cy="4.5" r="2.4" fill={ink} />
      </pattern>
      <pattern id="ce-grid" width="6" height="6" patternUnits="userSpaceOnUse">
        <path d="M6 0H0V6" fill="none" stroke={ink} strokeWidth="1.2" />
      </pattern>
      <pattern id="ce-cross" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1.2" height="6" fill={ink} />
        <rect width="6" height="1.2" fill={ink} />
      </pattern>
      <pattern id="ce-checker" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill={ink} />
        <rect x="4" y="4" width="4" height="4" fill={ink} />
      </pattern>
    </defs>
  );
}

/** A hidden SVG carrying the pattern definitions; render once near the top of a page section. */
export function PatternSheet({ dark }) {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <PatternDefs dark={dark} />
    </svg>
  );
}

/** A fate's color plus its pattern (a <g> of two rects). */
export function FateFill({ kind, dark, ...rect }) {
  const pattern = FATE[kind]?.pattern;
  return (
    <g>
      <rect {...rect} fill={fateColor(kind, dark)} />
      {pattern && pattern !== "solid" && <rect {...rect} fill={`url(#ce-${pattern})`} />}
    </g>
  );
}

export function Swatch({ kind, dark, size = 12 }) {
  return (
    <svg width={size} height={size} className="shrink-0 rounded-sm" aria-hidden="true">
      <FateFill kind={kind} dark={dark} width={size} height={size} />
    </svg>
  );
}
