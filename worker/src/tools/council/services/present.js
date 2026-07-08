// Presentation helpers: derive a clean candidate name + body from a nomination's
// raw content. This lived in the frontend (Council.jsx); it's here so BOTH the
// /council page and the /council/cms feed (for Framer) show identical names/text —
// one source of truth. Pure functions, no I/O.

// A first line that's a greeting, not a name ("Iconic Afternoon", "Hey everyone").
const GREETING_WORDS = /\b(hi|hey|hello|hiya|yo|gm|greetings|welcome|morning|afternoon|evening|sup|howdy)\b/i;
// A first line that's a section title, not a person's name.
const TITLE_WORDS = /\b(nomination|application|candidacy|candidate|council|intro(?:duction)?)\b/i;
// A plausible person name: letters plus name punctuation only.
const NAME_LIKE = /^[\p{L}][\p{L} .,'-]{0,44}$/u;

const nameOk = (name) =>
  !!name && NAME_LIKE.test(name) && !GREETING_WORDS.test(name) && !TITLE_WORDS.test(name);

// Drop trailing emoji / symbols / whitespace ("Iconic Afternoon 🫡" → "Iconic Afternoon").
function trimTrailingSymbols(s) {
  return s.replace(/[\s\p{Extended_Pictographic}\p{So}\p{Sk}️‍]+$/u, "").trim();
}

// Lift the candidate's name. Returns { name, strip } — strip=true when the name was
// its own header line (drop it from the body), false when pulled from prose. null
// when nothing confidently found. Mirrors the frontend parser exactly.
function parseCandidateName(rawContent) {
  const content = rawContent || "";
  const nl = content.indexOf("\n");
  const firstLine = (nl === -1 ? content : content.slice(0, nl)).trim();

  if (firstLine) {
    const sep = firstLine.match(/^(.{2,44}?)\s*[-–—/|]\s*(?:<@[!&]?\d+>|@[\w.]+)\s*$/u);
    if (sep) {
      const name = trimTrailingSymbols(sep[1]);
      if (nameOk(name)) return { name, strip: true };
    }
    const bare = trimTrailingSymbols(firstLine);
    if (nameOk(bare) && bare.split(/\s+/).length <= 5 && !/[.!?]$/.test(bare)) {
      return { name: bare, strip: true };
    }
  }

  const intro = content
    .slice(0, 300)
    .match(
      /\b(?:I['’]?m|I am|My name is|This is)\s+([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){1,2})(?=[,.\n]|\s+(?:and|who|from|here|is)\b|$)/u,
    );
  if (intro && nameOk(intro[1].trim())) return { name: intro[1].trim(), strip: false };
  return null;
}

// Drop the first line (the lifted name header) plus any blank lines after it.
function stripNameHeader(content) {
  const nl = (content || "").indexOf("\n");
  if (nl === -1) return "";
  return content.slice(nl + 1).replace(/^\s+/, "");
}

/**
 * Given a nomination's raw content + Discord display name, return the presentation
 * name and the body with any redundant name-header line stripped.
 */
export function presentNomination(content, authorDisplayName) {
  const lifted = parseCandidateName(content || "");
  return {
    candidateName: (lifted && lifted.name) || authorDisplayName || null,
    body: lifted && lifted.strip ? stripNameHeader(content || "") : content || "",
  };
}
