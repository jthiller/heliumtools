const WORDS = { loading: "Loading", checking: "Checking" };

/**
 * The one "…" renderer: the glyph is hidden from assistive tech and a
 * screen-reader word stands in ("Loading" or "Checking"), so a value that
 * hasn't arrived is never read as "dot dot dot". `label` overrides the word.
 * The region around it sets `aria-busy` (Card / Section `busy`).
 */
export function Pending({ kind = "loading", label, className = "" }) {
  return (
    <>
      <span aria-hidden="true" className={className}>
        …
      </span>
      <span className="sr-only">{label ?? WORDS[kind] ?? WORDS.loading}</span>
    </>
  );
}

export default Pending;
