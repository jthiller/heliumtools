// Shared vote UI primitives — used by both the vote detail page (Vote.jsx) and
// the votes index (VotesIndex.jsx). Formatting, status pills, and the choice
// color system live here so the two pages can't drift apart.

// ─── formatting ──────────────────────────────────────────────────────────────

export function fmtVeHnt(n, { compact = true } = {}) {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (compact && v >= 1_000_000) {
    return (v / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M";
  }
  if (compact && v >= 10_000) {
    const k = Math.round(v / 1000);
    return k >= 1000
      ? (k / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M"
      : k.toLocaleString() + "k";
  }
  if (v < 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtDate(unixSec) {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function relTime(unixSec) {
  if (!unixSec) return "—";
  const diff = Math.floor(Date.now() / 1000 - unixSec);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(unixSec);
}

// ─── status ──────────────────────────────────────────────────────────────────

const STATUS_META = {
  active:    { label: "Voting open", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", pulse: true },
  passed:    { label: "Passed",      dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  failed:    { label: "Failed",      dot: "bg-rose-500",    text: "text-rose-600 dark:text-rose-400" },
  completed: { label: "Resolved",    dot: "bg-violet-500",  text: "text-violet-600 dark:text-violet-400" },
  cancelled: { label: "Cancelled",   dot: "bg-content-tertiary", text: "text-content-tertiary" },
  draft:     { label: "Draft",       dot: "bg-amber-400",   text: "text-amber-600 dark:text-amber-400" },
  unknown:   { label: "Unknown",     dot: "bg-content-tertiary", text: "text-content-tertiary" },
};

/** A vote that can no longer change (resolved or cancelled). */
export function isFinalStatus(status) {
  return ["passed", "failed", "completed", "cancelled"].includes(status);
}

/** A vote with an on-chain outcome — resolved, not merely over (cancelled has
 * no outcome: no winners, no pass/fail verdict). */
export function hasOutcome(status) {
  return ["passed", "failed", "completed"].includes(status);
}

/** Ballots may back more than one choice, so the proposal's per-choice weight
 * sum overcounts participation — counting rules must use the roster instead. */
export function isMultiChoice(proposal) {
  return (proposal?.maxChoicesPerVoter || 1) > 1;
}

/** Distinct participating veHNT from the roster (each position counted once),
 * or null while the roster hasn't loaded / was unavailable that cycle. */
export function participatingVeHnt(votes) {
  return votes && !votes.unavailable ? votes.totalVeHnt : null;
}

/** An election: a seat count deciding among more than two candidates. */
export function isElection(proposal) {
  return !!proposal?.seats && (proposal?.choices || []).length > 2;
}

export function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em]">
      <span className={`relative flex h-2 w-2`}>
        {meta.pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${meta.dot} opacity-60`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
      </span>
      <span className={meta.text}>{meta.label}</span>
    </span>
  );
}

// ─── choice colors ────────────────────────────────────────────────────────────
// Semantic colors are reserved: For/Yes → emerald, Against/No → rose. Everything
// else (election candidates) draws from a fixed 8-hue categorical order chosen
// to maximize the minimum adjacent-pair color-vision-deficiency ΔE (validated
// with the dataviz palette checker: light ≥47, dark ≥46, both pass; the darker
// dark-mode steps keep every hue inside the dark lightness band at ≥3:1 on the
// raised surface). Assign by choice index — the hue follows the candidate, not
// its rank. Beyond 8 the cycle repeats; surfaces that rely on color alone (the
// trend chart) must fold the tail into "Others" instead of cycling.

const NEUTRAL_TONES = [
  { text: "text-sky-600 dark:text-sky-400",         bar: "bg-sky-500 dark:bg-sky-600" },
  { text: "text-amber-600 dark:text-amber-400",     bar: "bg-amber-500 dark:bg-amber-600" },
  { text: "text-violet-600 dark:text-violet-400",   bar: "bg-violet-500" },
  { text: "text-pink-600 dark:text-pink-400",       bar: "bg-pink-500" },
  { text: "text-indigo-600 dark:text-indigo-400",   bar: "bg-indigo-500" },
  { text: "text-orange-600 dark:text-orange-400",   bar: "bg-orange-500 dark:bg-orange-600" },
  { text: "text-teal-600 dark:text-teal-400",       bar: "bg-teal-500 dark:bg-teal-600" },
  { text: "text-fuchsia-600 dark:text-fuchsia-400", bar: "bg-fuchsia-500" },
];

export function choiceTone(name, index) {
  const n = (name || "").toLowerCase();
  if (n.startsWith("for") || n.startsWith("yes")) {
    return { text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" };
  }
  if (n.startsWith("against") || n.startsWith("no")) {
    return { text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500" };
  }
  return NEUTRAL_TONES[index % NEUTRAL_TONES.length];
}

// recharts strokes take hex, not Tailwind classes — same fixed order as
// NEUTRAL_TONES, with dark-mode steps validated against the dark surface.
const NEUTRAL_HEX_LIGHT = ["#0ea5e9", "#f59e0b", "#8b5cf6", "#ec4899", "#6366f1", "#f97316", "#14b8a6", "#d946ef"];
const NEUTRAL_HEX_DARK  = ["#0284c7", "#d97706", "#8b5cf6", "#ec4899", "#6366f1", "#ea580c", "#0d9488", "#d946ef"];

export function choiceHex(name, index, dark = false) {
  const n = (name || "").toLowerCase();
  if (n.startsWith("for") || n.startsWith("yes")) return dark ? "#059669" : "#10b981";
  if (n.startsWith("against") || n.startsWith("no")) return dark ? "#e11d48" : "#f43f5e";
  const hexes = dark ? NEUTRAL_HEX_DARK : NEUTRAL_HEX_LIGHT;
  return hexes[index % hexes.length];
}

/** How many distinct neutral hues exist before the cycle repeats. */
export const NEUTRAL_HUE_COUNT = NEUTRAL_HEX_LIGHT.length;
