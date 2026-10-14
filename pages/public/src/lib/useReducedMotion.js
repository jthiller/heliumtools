import { useEffect, useState } from "react";

// The one reduced-motion check for JS-driven motion (count-ups, map pulses,
// smooth scrolls). CSS motion uses Tailwind's `motion-safe:` variant or a
// `prefers-reduced-motion` media query instead.
const MQ = "(prefers-reduced-motion: reduce)";

/** Whether the viewer asked for reduced motion, read now (for event handlers). */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.(MQ).matches === true;
}

/** Whether the viewer asked for reduced motion, kept current as it changes. */
export default function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const mq = window.matchMedia?.(MQ);
    if (!mq) return undefined;
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
