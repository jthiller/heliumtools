const DOT = { iot: "bg-wd-iot", mobile: "bg-wd-mobile" };

/**
 * The 8 px network identity dot: IoT green or Mobile violet, nothing else
 * (never status, never money). `second` draws a dual-network Hotspot's other
 * network as an overlapping dot. Decorative: the text beside it names the
 * network. Renders nothing for an unknown network (CBRS, no network).
 */
export function NetDot({ net, second = null, className = "" }) {
  if (!DOT[net]) return null;
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center ${className}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${DOT[net]}`} />
      {DOT[second] && (
        <span className={`-ml-[3px] inline-block h-2 w-2 rounded-full ${DOT[second]}`} />
      )}
    </span>
  );
}

export default NetDot;
