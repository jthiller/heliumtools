/**
 * Placeholder block in the final shape of what's loading: a well-colored
 * block that pulses only under `prefers-reduced-motion: no-preference`
 * (`.wd-skel`). Decorative, so hidden from assistive tech: the region around
 * it carries `aria-busy` and a `Pending` word. `w` / `h` take any CSS length
 * (numbers are px).
 */
export function Skeleton({ w, h, className = "", style }) {
  return (
    <span
      aria-hidden="true"
      className={`wd-skel ${className}`}
      style={{ width: w, height: h, ...style }}
    />
  );
}

export default Skeleton;
