/**
 * A one-shot accent wash over its `relative` parent, replayed whenever
 * `flashKey` changes (0/absent: none). The parent stays mounted, so focus
 * and hover survive the replay. Reduced motion: none (`motion-safe:`). Keys
 * come from `useArrivalFlashes` (arrivalMotion.jsx): live arrivals only.
 */
export function ArrivalFlash({ flashKey }) {
  if (!flashKey) return null;
  return (
    <span
      key={flashKey}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] motion-safe:animate-pulse-once"
    />
  );
}

export default ArrivalFlash;
