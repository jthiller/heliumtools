import useMediaQuery, { matchesMedia } from "./useMediaQuery.js";

// The one reduced-motion check for JS-driven motion (count-ups, map pulses,
// smooth scrolls). CSS motion uses Tailwind's `motion-safe:` variant or a
// `prefers-reduced-motion` media query instead.
const MQ = "(prefers-reduced-motion: reduce)";

/** Whether the viewer asked for reduced motion, read now (for event handlers). */
export function prefersReducedMotion() {
  return matchesMedia(MQ);
}

/** Whether the viewer asked for reduced motion, kept current as it changes. */
export default function useReducedMotion() {
  return useMediaQuery(MQ);
}
