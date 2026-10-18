import { TIERS } from "../statusRegistry.js";

/**
 * A status tier's mark: shape and color together, never color alone
 * (`.wd-st-*`: critical filled circle with a bar, caution triangle, quiet ring
 * with a bar, info clock ring, unknown "?" ring, ok check, checking dashed
 * ring), plus the tier word for screen readers ("Check: "), since the glyph is
 * hidden. `mark` overrides the shape for one state (e.g. "x" for Couldn't
 * check, "none"); `word` overrides the spoken word; `sr={false}` drops it where
 * the surrounding text already names the tier.
 */
export function StatusMark({ tier, mark, word, sr = true, className = "" }) {
  const t = TIERS[tier] ?? TIERS.unknown;
  const spoken = word ?? t.word;
  return (
    <>
      <span aria-hidden="true" className={`wd-st wd-st-${mark ?? t.mark} ${className}`} />
      {sr && spoken ? <span className="sr-only">{spoken}: </span> : null}
    </>
  );
}

export default StatusMark;
