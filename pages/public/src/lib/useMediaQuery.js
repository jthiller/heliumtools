import { useEffect, useState } from "react";

/** Whether a CSS media query matches, read now (for event handlers). */
export function matchesMedia(query) {
  return typeof window !== "undefined" && window.matchMedia?.(query).matches === true;
}

/** Whether a CSS media query matches, kept current as it changes. */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => matchesMedia(query));

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    setMatches(mq.matches);
    const handler = (e) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
